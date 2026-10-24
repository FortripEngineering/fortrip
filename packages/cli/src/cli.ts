import {
  COMMAND_GROUPS,
  COMMANDS,
  type CommandGroupSpec,
  commandInvocation,
  type CommandSpec,
  GLOBAL_FLAGS,
  type RenderedTool,
  renderToolResult,
} from "@fortrip/agent-contract";

import { unwrap } from "./api.ts";
import { authorizedRequest, login, logout, whoami } from "./auth.ts";
import { parseCommand, parseOptions } from "./commands.ts";
import { resolveApiUrl, resolveMcpUrl } from "./credentials.ts";
import {
  CliError,
  EXIT,
  type ExitCode,
  fieldLines,
  formatError,
  notices,
  usageError,
} from "./errors.ts";
import { readGuide } from "./guide.ts";
import { commandHelp, groupHelp, overallHelp } from "./help.ts";
import { VERSION } from "./version.ts";

/** A global flag as typed: `--help` and `-h`. */
function globalFlag(name: string): string[] {
  const option = GLOBAL_FLAGS.find((candidate) => candidate.flag === name);
  return option ? [`--${option.flag}`, ...(option.short ? [`-${option.short}`] : [])] : [];
}

const HELP_FLAGS = globalFlag("help");
const VERSION_FLAGS = globalFlag("version");
const JSON_FLAG = "--json";

/** Commands of earlier versions that were renamed, not only moved into a
 *  group, and what each became: 1.x's, typed on their own, and 2.x's, typed
 *  after their group. One that kept its name in a group (1.x `search`, now
 *  `hotels search`) is found without an entry. */
const RENAMED = new Map<string, Pick<CommandSpec, "group" | "name">>([
  ["hotel", { group: "hotels", name: "get" }],
  ["rates", { group: "hotels", name: "offers" }],
  ["hotels rates", { group: "hotels", name: "offers" }],
]);

/** The command `argv` names and the arguments after its name, or the group
 *  whose help it asks for. A group's commands are typed after it
 *  (`hotels search`); a command without a group on its own (`login`). */
function findCommand(
  argv: string[],
): { spec: CommandSpec; rest: string[] } | { groupHelp: CommandGroupSpec } {
  const [word, ...afterWord] = argv;
  const group = COMMAND_GROUPS.find((candidate) => candidate.name === word);
  if (group) {
    const [name, ...rest] = afterWord;
    if (!name || name === "help" || HELP_FLAGS.includes(name)) {
      return { groupHelp: group };
    }
    const spec = COMMANDS.find(
      (candidate) => candidate.group === group.name && candidate.name === name,
    );
    if (!spec) {
      const renamed = RENAMED.get(`${group.name} ${name}`);
      throw usageError(
        renamed
          ? `Unknown command "${group.name} ${name}". Did you mean \`${commandInvocation(renamed)}\`?`
          : `Unknown command "${group.name} ${name}". Run \`fortrip ${group.name} --help\`.`,
      );
    }
    return { spec, rest };
  }
  const spec = COMMANDS.find(
    (candidate) => candidate.group === null && candidate.name === word,
  );
  if (spec) return { spec, rest: afterWord };
  // A group's command typed without its group (`search` for
  // `hotels search`), or under its 1.x name (`hotel` for `hotels get`).
  const renamed = RENAMED.get(word ?? "");
  const meant = [
    ...COMMANDS.filter((candidate) => candidate.group !== null && candidate.name === word),
    ...(renamed ? [renamed] : []),
  ].map((candidate) => `\`${commandInvocation(candidate)}\``);
  throw usageError(
    meant.length
      ? `Unknown command "${word}". Did you mean ${meant.join(" or ")}?`
      : `Unknown command "${word}". Run \`fortrip --help\`.`,
  );
}

/** What a command printed or answers: text it wrote itself, or an answer
 *  to print as text, or as JSON with `--json`. */
type Answer = { data: unknown; text: string } | undefined;

async function run(argv: string[]): Promise<Answer> {
  const [command] = argv;
  if (!command || command === "help" || HELP_FLAGS.includes(command)) {
    process.stdout.write(overallHelp());
    return undefined;
  }
  if (VERSION_FLAGS.includes(command)) {
    process.stdout.write(`${VERSION}\n`);
    return undefined;
  }
  const found = findCommand(argv);
  if ("groupHelp" in found) {
    process.stdout.write(groupHelp(found.groupHelp));
    return undefined;
  }
  const { spec, rest } = found;
  if (wantsHelp(rest)) {
    process.stdout.write(commandHelp(spec));
    return undefined;
  }
  if (spec.group === null && spec.name === "guide") {
    const { positionals } = parseOptions(spec, rest);
    const topic = positionals.join(" ");
    if (topic !== "" && topic !== "planning") {
      throw usageError("Usage: fortrip guide [planning]");
    }
    process.stdout.write(readGuide(topic || "main"));
    return undefined;
  }

  const apiUrl = resolveApiUrl();
  const log = (line: string) => process.stderr.write(`${line}\n`);
  if (spec.group === null) {
    switch (spec.name) {
      case "login": {
        const { values } = parseOptions(spec, rest);
        if (process.env.FORTRIP_TOKEN) {
          log("Note: FORTRIP_TOKEN is set and takes precedence over this login.");
        }
        return account(await login({ apiUrl, openBrowser: !values["no-browser"], log }));
      }
      case "logout": {
        parseOptions(spec, rest);
        const data = await logout(apiUrl);
        return { data, text: `Logged out of ${apiUrl}.` };
      }
      case "whoami":
        parseOptions(spec, rest);
        return account(await whoami(apiUrl));
      case "mcp": {
        parseOptions(spec, rest);
        // Loaded only here: the other commands needn't pay for the MCP SDK.
        const mcpUrl = resolveMcpUrl(apiUrl);
        const { runMcpBridge } = await import("./mcp-bridge.ts");
        await runMcpBridge(mcpUrl, apiUrl);
        return undefined;
      }
    }
  }
  const { method, path, body } = parseCommand(spec, rest, process.env);
  const data = unwrap(await authorizedRequest(apiUrl, path, { method, body }));
  return { data, text: renderToolResult(spec.tool as RenderedTool, data) };
}

/** `whoami`, and `login` once signed in: the account as 2.0 printed it,
 *  `{ userId, email, name, apiUrl }`. */
function account(data: unknown): Answer {
  const { apiUrl, userId, email, name } = data as Record<string, unknown>;
  const given = (value: unknown) => value ?? "not given";
  return {
    data,
    text: [
      `Signed in to ${apiUrl}.`,
      ...fieldLines({ userId, email: given(email), name: given(name) }),
    ].join("\n"),
  };
}

/** `--help` or `-h` anywhere before `--`. */
function wantsHelp(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--") return false;
    if (HELP_FLAGS.includes(arg)) return true;
  }
  return false;
}

/** `argv` without `--json`, which any command takes anywhere before `--`,
 *  and whether it was there. */
function takeJson(argv: string[]): { json: boolean; argv: string[] } {
  const end = argv.indexOf("--");
  const before = end === -1 ? argv : argv.slice(0, end);
  const after = end === -1 ? [] : argv.slice(end);
  const kept = before.filter((arg) => arg !== JSON_FLAG);
  return { json: kept.length < before.length, argv: [...kept, ...after] };
}

async function main(): Promise<ExitCode> {
  const { json, argv } = takeJson(process.argv.slice(2));
  try {
    const answer = await run(argv);
    if (answer !== undefined) {
      const { data, text } = answer;
      if (json) {
        const output =
          data && typeof data === "object" && !Array.isArray(data) ? { ...data, ...notices } : data;
        process.stdout.write(`${JSON.stringify(output)}\n`);
      } else {
        process.stdout.write(`${[text, ...fieldLines(notices)].join("\n")}\n`);
      }
    }
    return EXIT.ok;
  } catch (error) {
    const failure =
      error instanceof CliError
        ? error
        : new CliError((error as Error)?.message ?? String(error), EXIT.error);
    process.stderr.write(`${formatError(failure, json)}\n`);
    return failure.exitCode;
  }
}

process.exitCode = await main();
