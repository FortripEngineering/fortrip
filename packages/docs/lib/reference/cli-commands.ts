import {
  COMMANDS,
  type CommandSpec,
  commandInvocation,
  type FlagSpec,
  type OptionSpec,
  type PositionalSpec,
  TOOLS,
} from "@fortrip/agent-contract";
import { responseDocForCommand, schemaHref } from "./response-docs.ts";
import { toJsonSchema } from "./schema-rows.ts";

/** A table row: how the flag is typed, the input field it sets (empty for
 *  an option of the CLI itself), what it does. */
export type CliFlag = [flag: string, field: string, description: string];

export interface CliCommand {
  /** The page slug: the group and name, `hotels-search`, or the name alone. */
  slug: string;
  /** The command as typed, `fortrip hotels search`, without its arguments. */
  invocation: string;
  title: string;
  group: string;
  usage: string;
  summary: string;
  /** Paragraphs for a command that needs more than its summary. */
  how?: string[];
  flags?: CliFlag[];
  /** What it prints. */
  output: string;
  /** The response it prints with `--json`: its title and schemas anchor. */
  schema?: { title: string; href: string };
  /** Slug of the matching MCP tool page. */
  mcp?: string;
}

/** What a command that calls the API prints. */
const DATA_OUTPUT =
  "Compact text on stdout: one line per hotel, offer or order, with its ids, and every note. With `--json`, the response as JSON on one line.";

/** What the contract doesn't say about a command: where the docs list it,
 *  and what a command without a response prints. Keyed by page slug and in
 *  docs order; `docs-data.test.ts` fails when the contract gains a command
 *  that isn't listed. */
const DOCS: Record<string, { title: string; group: string; output?: string }> =
  {
    "hotels-search": { title: "Search hotels", group: "Hotels" },
    "hotels-get": { title: "Hotel details", group: "Hotels" },
    "hotels-offers": { title: "Live offers", group: "Hotels" },
    "hotels-book": { title: "Create order", group: "Orders" },
    "orders-get": { title: "Get order", group: "Orders" },
    "orders-list": { title: "List orders", group: "Orders" },
    "orders-cancel": { title: "Cancel order", group: "Orders" },
    "orders-pay": { title: "Pay order", group: "Orders" },
    login: {
      title: "Sign in",
      group: "Account",
      output:
        "Prints a sign-in link and a code, opens the browser, and waits until you approve. The sign-in is saved for later commands.",
    },
    logout: {
      title: "Sign out",
      group: "Account",
      output: "Revokes the saved sign-in on this machine and forgets it.",
    },
    whoami: {
      title: "Account",
      group: "Account",
      output:
        "The signed-in account on stdout. With `--json`, the response as JSON on one line.",
    },
    guide: {
      title: "Agent guide",
      group: "Guides",
      output: "Markdown on stdout.",
    },
    mcp: {
      title: "Local MCP server",
      group: "Local MCP",
      output:
        "Speaks MCP over stdin and stdout, forwarding every call to the hosted server with the saved sign-in.",
    },
  };

/** The `--body` example on the CLI overview; a test parses it with the
 *  contract's search input. */
export const RAW_BODY_EXAMPLE = {
  destination: { kind: "place_name", name: "Bangkok", countryCode: "TH" },
  filters: { stars: { min: 5 } },
  sort: "stars_desc",
};

/** The docs page of a command: `hotels-search`, `login`. */
export function commandSlug(spec: Pick<CommandSpec, "group" | "name">): string {
  return spec.group === null ? spec.name : `${spec.group}-${spec.name}`;
}

/** What follows the flag name: `<n>`, `YYYY-MM-DD`, `"First Last[:roomNo]"`;
 *  `...` when it can be repeated. */
function flagSyntax(option: FlagSpec | OptionSpec): string {
  const placeholder = option.placeholder ? ` ${option.placeholder}` : "";
  const repeats = "multiple" in option && option.multiple ? "..." : "";
  return `--${option.flag}${placeholder}${repeats}`;
}

function positional({ name, optional }: PositionalSpec): string {
  return optional ? `[${name}]` : `<${name}>`;
}

/** `fortrip hotels offers --hotel <htl_>... --check-in YYYY-MM-DD ... [options]`: the
 *  positionals and the flags of required fields (in brackets when the command
 *  runs without one), then `[options]` when more can be given. */
function usageOf(spec: CommandSpec): string {
  const tool = TOOLS.find((candidate) => candidate.name === spec.tool);
  const required = new Set(
    tool?.input ? (toJsonSchema(tool.input).required ?? []) : [],
  );
  const mandatory = spec.flags.filter((flag) => required.has(flag.field));
  const more =
    spec.flags.length + (spec.options?.length ?? 0) > mandatory.length;
  return [
    commandInvocation(spec),
    ...(spec.positionals ?? []).map(positional),
    ...mandatory.map((flag) => (flag.optional ? `[${flagSyntax(flag)}]` : flagSyntax(flag))),
    ...(more ? ["[options]"] : []),
  ].join(" ");
}

function flagRows(spec: CommandSpec): CliFlag[] {
  return [
    ...(spec.positionals ?? []).map(
      (item): CliFlag => [positional(item), item.field ?? "", item.description],
    ),
    ...spec.flags.map(
      (flag): CliFlag => [flagSyntax(flag), flag.field, flag.description],
    ),
    ...(spec.options ?? []).map(
      (option): CliFlag => [
        `${option.short ? `-${option.short}, ` : ""}${flagSyntax(option)}`,
        "",
        option.description,
      ],
    ),
  ];
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

export const CLI_COMMANDS: CliCommand[] = Object.entries(DOCS).map(
  ([slug, { title, group, output = DATA_OUTPUT }]) => {
    const spec = COMMANDS.find((candidate) => commandSlug(candidate) === slug);
    if (!spec) throw new Error(`${slug} is not in the contract's COMMANDS`);
    const flags = flagRows(spec);
    const response = responseDocForCommand(slug);
    return {
      slug,
      invocation: commandInvocation(spec),
      title,
      group,
      usage: usageOf(spec),
      summary: sentence(spec.summary),
      flags: flags.length > 0 ? flags : undefined,
      output,
      schema: response
        ? { title: response.title, href: schemaHref(response) }
        : undefined,
      mcp: spec.tool?.replaceAll("_", "-"),
    };
  },
);
