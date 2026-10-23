import {
  COMMAND_GROUPS,
  COMMANDS,
  type CommandGroupSpec,
  commandInvocation,
  type CommandSpec,
  GLOBAL_FLAGS,
} from "@fortrip/agent-contract";

import { unwrap } from "./api.ts";
import { authorizedRequest, login, logout, whoami } from "./auth.ts";
import { parseCommand, parseOptions } from "./commands.ts";
import { resolveApiUrl } from "./credentials.ts";
import { CliError, EXIT, type ExitCode, notices, usageError } from "./errors.ts";
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

/** 1.x commands that 2.0 renamed, not only moved into a group, and what each
 *  became. One that kept its name in a group (`search`, now `hotels search`)
 *  is found without an entry. */
const RENAMED = new Map<string, Pick<CommandSpec, "group" | "name">>([
  ["hotel", { group: "hotels", name: "get" }],
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
      throw usageError(
        `Unknown command "${group.name} ${name}". Run \`fortrip ${group.name} --help\`.`,
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

async function run(argv: string[]): Promise<unknown> {
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
        return login({ apiUrl, openBrowser: !values["no-browser"], log });
      }
      case "logout":
        parseOptions(spec, rest);
        return logout(apiUrl);
      case "whoami":
        parseOptions(spec, rest);
        return whoami(apiUrl);
      case "mcp": {
        parseOptions(spec, rest);
        // Loaded only here: the other commands needn't pay for the MCP SDK.
        const { runMcpBridge } = await import("./mcp-bridge.ts");
        return runMcpBridge(apiUrl);
      }
    }
  }
  const { body, path } = parseCommand(spec, rest, process.env);
  return call(apiUrl, body ? "POST" : "GET", path, body);
}

async function call(
  apiUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  return unwrap(await authorizedRequest(apiUrl, path, { method, body }));
}

/** `--help` or `-h` anywhere before `--`. */
function wantsHelp(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--") return false;
    if (HELP_FLAGS.includes(arg)) return true;
  }
  return false;
}

async function main(): Promise<ExitCode> {
  try {
    const result = await run(process.argv.slice(2));
    if (result !== undefined) {
      const output =
        result && typeof result === "object" && !Array.isArray(result)
          ? { ...result, ...notices }
          : result;
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    }
    return EXIT.ok;
  } catch (error) {
    const failure =
      error instanceof CliError
        ? error
        : new CliError((error as Error)?.message ?? String(error), EXIT.error);
    process.stderr.write(
      `${JSON.stringify({ error: failure.message, exitCode: failure.exitCode, ...failure.details, ...notices }, null, 2)}\n`,
    );
    return failure.exitCode;
  }
}

process.exitCode = await main();
