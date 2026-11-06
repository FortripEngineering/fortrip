import { COMMANDS, commandInvocation, MCP_SERVER_URL, PUBLIC_ORIGINS } from "@fortrip/agent-contract";

/** The commands that take `--display-currency`: `hotels search and hotels offers`. */
const CURRENCY_COMMANDS = COMMANDS.filter((spec) =>
  spec.flags.some((flag) => flag.field === "displayCurrency"),
)
  .map((spec) => commandInvocation(spec).slice("fortrip ".length))
  .join(" and ");

/**
 * The environment variables the CLI reads, each with its line in
 * `fortrip --help`, which lists them all. `internal` marks one that only
 * Fortrip's own development sets: the docs leave it out.
 */
export const ENVIRONMENT = [
  {
    name: "FORTRIP_TOKEN",
    help: "Use this token instead of the saved login (a remote agent environment or a CI run)",
    internal: false,
  },
  { name: "FORTRIP_API_URL", help: `API base URL (default ${PUBLIC_ORIGINS.api})`, internal: true },
  {
    name: "FORTRIP_MCP_URL",
    help: `MCP server URL for fortrip mcp (default ${MCP_SERVER_URL})`,
    internal: true,
  },
  {
    name: "FORTRIP_DISPLAY_CURRENCY",
    help: `Default --display-currency for ${CURRENCY_COMMANDS}`,
    internal: false,
  },
] as const satisfies readonly { name: `FORTRIP_${string}`; help: string; internal: boolean }[];

export type EnvVar = (typeof ENVIRONMENT)[number];
