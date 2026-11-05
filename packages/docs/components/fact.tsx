import {
  API,
  CONTRACT_VERSION,
  DOCS_ORIGIN,
  LIMITS,
  MCP_PATH,
  MCP_SERVER_URL,
  ORDER_HTTP,
  PUBLIC_ORIGINS,
  RATE_LIMITS,
  REPOSITORY_URL,
  SEARCH_RULES,
  SKILL_INSTALL_COMMAND,
  SUPPORT_EMAIL,
} from "@fortrip/agent-contract";

import cli from "../../cli/package.json" with { type: "json" };

/** The oldest Node.js major the CLI runs on, from its `engines.node` (`>=22`). */
const nodeRange = /^>=(\d+)$/.exec(cli.engines.node);
if (!nodeRange) throw new Error(`Unexpected engines.node in the CLI package: ${cli.engines.node}`);

/** The contract values the docs may state, by the name the contract exports,
 *  and the CLI's Node.js floor from its published package metadata. */
const FACTS = {
  CLI_NODE_MAJOR: Number(nodeRange[1]),
  LIMITS,
  RATE_LIMITS,
  SEARCH_RULES,
  ORDER_HTTP,
  PUBLIC_ORIGINS,
  API,
  MCP_PATH,
  MCP_SERVER_URL,
  SKILL_INSTALL_COMMAND,
  REPOSITORY_URL,
  DOCS_ORIGIN,
  SUPPORT_EMAIL,
  CONTRACT_VERSION,
};

/** The dotted paths to the string and number leaves of `T`, prefixed by `P`. */
type Leaves<T, P extends string> = T extends string | number
  ? P
  : T extends object
    ? { [K in keyof T & string]: Leaves<T[K], `${P}.${K}`> }[keyof T & string]
    : never;

/** A contract fact, e.g. "LIMITS.rooms", "RATE_LIMITS.search.limit" or "MCP_SERVER_URL". */
export type FactPath = {
  [K in keyof typeof FACTS]: Leaves<(typeof FACTS)[K], K>;
}[keyof typeof FACTS];

/**
 * The contract's value at `path`, as text (numbers as "80,000"); throws so a
 * build fails on a stale path. MDX states facts with `<Fact path="…" />`,
 * which `lib/remark-facts.ts` replaces with this text at compile time.
 */
export function fact(path: FactPath): string {
  let value: unknown = FACTS;
  for (const key of path.split(".")) {
    value =
      typeof value === "object" && value !== null && Object.hasOwn(value, key)
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`Unknown fact: ${path}`);
  }
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}
