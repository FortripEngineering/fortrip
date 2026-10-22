import {
  COMMANDS,
  type CommandSpec,
  type FlagSpec,
  GLOBAL_FLAGS,
  type OptionSpec,
} from "@fortrip/agent-contract";

import { VERSION } from "./version.ts";

/*
 * `fortrip --help` and `fortrip <command> --help`, rendered from the
 * contract's command specs, so the help can't say what the parser doesn't do.
 */

const WIDTH = 78;

/** Positionals the command can do without. */
const OPTIONAL_POSITIONALS = new Set(["topic"]);

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

/** `hotel <hotelId>`, `guide [topic]`: a command as it is typed. */
function invocation(spec: CommandSpec): string {
  const positionals = (spec.positionals ?? []).map((name) =>
    OPTIONAL_POSITIONALS.has(name) ? `[${name}]` : `<${name}>`,
  );
  return ["fortrip", spec.name, ...positionals].join(" ");
}

/** `fortrip hotel <hotelId> [options]`. */
export function usageLine(spec: CommandSpec): string {
  return `${invocation(spec)} [options]`;
}

/** `-q, --query <text>`; a flag without a short name is indented to line up. */
function names(option: FlagSpec | OptionSpec, aligned: boolean): string {
  const short = option.short ? `-${option.short}, ` : aligned ? "    " : "";
  const placeholder = option.placeholder ? ` ${option.placeholder}` : "";
  const repeats = "multiple" in option && option.multiple ? "..." : "";
  return `${short}--${option.flag}${placeholder}${repeats}`;
}

function optionList(options: readonly (FlagSpec | OptionSpec)[]): string {
  const aligned = options.some((option) => option.short);
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

function commandList(): string {
  const labels = COMMANDS.map((spec) => invocation(spec).slice("fortrip ".length));
  const column = 2 + Math.max(...labels.map((label) => label.length)) + 2;
  return COMMANDS.map((spec, n) => {
    const [first = "", ...rest] = wrap(spec.summary, column);
    const label = `  ${labels[n]}`.padEnd(column);
    return [label + first.slice(column), ...rest].join("\n");
  }).join("\n");
}

/** `fortrip --help`. */
export function overallHelp(): string {
  return `fortrip ${VERSION} — search, price and book Fortrip hotels

Usage: fortrip <command> [options]
       fortrip <command> --help

Commands:
${commandList()}

Options:
${optionList(GLOBAL_FLAGS)}

Output is JSON on stdout; errors are JSON on stderr.
Exit codes: 0 ok, 1 error (retry once when stderr has "retryable": true),
2 invalid arguments, 3 not logged in, 4 rate limited.

Environment:
  FORTRIP_TOKEN    Use this token instead of the saved login (CI, sandboxes)
  FORTRIP_API_URL  API base URL (default https://fortrip.ai)
  FORTRIP_CURRENCY Default --currency for search and rates
`;
}
