import { COMMANDS, GLOBAL_FLAGS } from "@fortrip/agent-contract";

import { unwrap } from "./api.ts";
import { authorizedRequest, login, logout, whoami } from "./auth.ts";
import { parseCommand, parseOptions } from "./commands.ts";
import { resolveApiUrl } from "./credentials.ts";
import { CliError, EXIT, type ExitCode, notices, usageError } from "./errors.ts";
import { readGuide } from "./guide.ts";
import { commandHelp, overallHelp } from "./help.ts";
import { VERSION } from "./version.ts";

/** A global flag as typed: `--help` and `-h`. */
function globalFlag(name: string): string[] {
  const option = GLOBAL_FLAGS.find((candidate) => candidate.flag === name);
  return option ? [`--${option.flag}`, ...(option.short ? [`-${option.short}`] : [])] : [];
}

const HELP_FLAGS = globalFlag("help");
const VERSION_FLAGS = globalFlag("version");

async function run(argv: string[]): Promise<unknown> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || HELP_FLAGS.includes(command)) {
    process.stdout.write(overallHelp());
    return undefined;
  }
  if (VERSION_FLAGS.includes(command)) {
    process.stdout.write(`${VERSION}\n`);
    return undefined;
  }
  const spec = COMMANDS.find((candidate) => candidate.name === command);
  if (!spec) {
    throw usageError(`Unknown command "${command}". Run \`fortrip --help\`.`);
  }
  if (wantsHelp(rest)) {
    process.stdout.write(commandHelp(spec));
    return undefined;
  }
  if (spec.name === "guide") {
    const { positionals } = parseOptions(spec, rest);
    process.stdout.write(await readGuide(positionals.join(" ") || undefined));
    return undefined;
  }
  if (spec.name === "mcp") throw usageError("mcp is not available yet");

  const apiUrl = resolveApiUrl();
  const log = (line: string) => process.stderr.write(`${line}\n`);
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
    default: {
      const { body, path } = parseCommand(spec, rest, process.env);
      return call(apiUrl, body ? "POST" : "GET", path, body);
    }
  }
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
