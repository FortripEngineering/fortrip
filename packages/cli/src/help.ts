import {
  COMMAND_GROUPS,
  COMMANDS,
  type CommandGroupSpec,
  commandInvocation,
  type CommandSpec,
  type FlagSpec,
  GLOBAL_FLAGS,
  type OptionSpec,
} from "@fortrip/agent-contract";

import { DEFAULT_API_URL } from "./credentials.ts";
import { VERSION } from "./version.ts";

/*
 * `fortrip --help`, `fortrip <group> --help` and `fortrip <command> --help`,
 * rendered from the contract's command specs, so the help can't say what the
 * parser doesn't do.
 */

const WIDTH = 78;

/** Word-wraps `text` to the help width, every line indented by `indent`. */
function wrap(text: string, indent: number): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && indent + line.length + 1 + word.length > WIDTH) {
      lines.push(pad + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(pad + line);
  return lines;
}

/** `<hotelId>`, `[topic]`: a command's positionals as they are typed. */
function positionals(spec: CommandSpec): string[] {
  return (spec.positionals ?? []).map(({ name, optional }) =>
    optional ? `[${name}]` : `<${name}>`,
  );
}

/** `get <hotelId>`, `guide [topic]`: a command in its group's list, or in
 *  the CLI's. */
function label(spec: CommandSpec): string {
  return [spec.name, ...positionals(spec)].join(" ");
}

/** `fortrip hotels get <hotelId> [options]`. */
export function usageLine(spec: CommandSpec): string {
  return [commandInvocation(spec), ...positionals(spec), "[options]"].join(" ");
}

/** `-q, --query <text>`; a flag without a short name is indented to line up. */
function names(option: FlagSpec | OptionSpec, aligned: boolean): string {
  const short = "short" in option && option.short ? `-${option.short}, ` : aligned ? "    " : "";
  const placeholder = option.placeholder ? ` ${option.placeholder}` : "";
  const repeats = "multiple" in option && option.multiple ? "..." : "";
  return `${short}--${option.flag}${placeholder}${repeats}`;
}

function optionList(options: readonly (FlagSpec | OptionSpec)[]): string {
  const aligned = options.some((option) => "short" in option && option.short);
  return options
    .map((option) =>
      [`  ${names(option, aligned)}`, ...wrap(option.description, 8)].join("\n"),
    )
    .join("\n");
}

const HELP_FLAG = GLOBAL_FLAGS.filter((option) => option.flag === "help");

/** `fortrip <command> --help`. */
export function commandHelp(spec: CommandSpec): string {
  const options = [...spec.flags, ...(spec.options ?? []), ...HELP_FLAG];
  return `Usage: ${usageLine(spec)}

${wrap(spec.summary, 0).join("\n")}

Options:
${optionList(options)}
`;
}

/** What to type and what it does, in two columns. */
function commandList(rows: readonly (readonly [string, string])[]): string {
  const column = 2 + Math.max(...rows.map(([name]) => name.length)) + 2;
  return rows
    .map(([name, summary]) => {
      const [first = "", ...rest] = wrap(summary, column);
      return [`  ${name}`.padEnd(column) + first.slice(column), ...rest].join("\n");
    })
    .join("\n");
}

/** `fortrip hotels --help`. */
export function groupHelp(group: CommandGroupSpec): string {
  const usage = `fortrip ${group.name} <command>`;
  const commands = COMMANDS.filter((spec) => spec.group === group.name);
  return `Usage: ${usage} [options]
       ${usage} --help

${wrap(group.summary, 0).join("\n")}

Commands:
${commandList(commands.map((spec) => [label(spec), spec.summary]))}

Options:
${optionList(HELP_FLAG)}
`;
}

/** The commands that take `--display-currency`: `hotels search and hotels offers`. */
const CURRENCY_COMMANDS = COMMANDS.filter((spec) =>
  spec.flags.some((flag) => flag.field === "displayCurrency"),
)
  .map((spec) => commandInvocation(spec).slice("fortrip ".length))
  .join(" and ");

/** `fortrip --help`: the groups, then the commands typed on their own. */
export function overallHelp(): string {
  const rows = [
    ...COMMAND_GROUPS.map((group) => [`${group.name} <command>`, group.summary] as const),
    ...COMMANDS.filter((spec) => spec.group === null).map(
      (spec) => [label(spec), spec.summary] as const,
    ),
  ];
  return `fortrip ${VERSION} — search, price and book Fortrip hotels

Usage: fortrip <command> [options]
       fortrip <command> --help

Commands:
${commandList(rows)}

Options:
${optionList(GLOBAL_FLAGS)}

Output is compact text on stdout; --json prints it as one line of JSON.
Errors go to stderr, as text or, with --json, as JSON.
Exit codes: 0 ok, 1 error (retry once when the error says it is retryable),
2 invalid arguments, 3 not logged in, 4 rate limited.

Environment:
  FORTRIP_TOKEN             Use this token instead of the saved login (CI, sandboxes)
  FORTRIP_API_URL           API base URL (default ${DEFAULT_API_URL})
  FORTRIP_DISPLAY_CURRENCY  Default --display-currency for ${CURRENCY_COMMANDS}
`;
}
