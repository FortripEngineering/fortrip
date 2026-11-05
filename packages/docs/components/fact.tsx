import {
  ACCOUNT_ROUTES,
  API,
  CONTRACT_VERSION,
  DOCS_ORIGIN,
  HTTP_ROUTES,
  LIMITS,
  MCP_PATH,
  MCP_SERVER_URL,
  ME_SCOPES,
  ORDER_HTTP,
  ORDER_NEXT_STEP,
  PUBLIC_ORIGINS,
  RATE_LIMITS,
  REPOSITORY_URL,
  SEARCH_RULES,
  SKILL_INSTALL_COMMAND,
  SUPPORT_EMAIL,
} from "@fortrip/agent-contract";

import cli from "../../cli/package.json" with { type: "json" };
import { EXIT as CLI_EXIT } from "../../cli/src/exit-codes.ts";
import { API_BASE_URL } from "../lib/reference/api-docs.ts";
import { ADAPTIVE_PRICING } from "../lib/prose/guide-copy.ts";

/** The oldest Node.js major the CLI runs on, from its `engines.node` (`>=22`). */
const nodeRange = /^>=(\d+)$/.exec(cli.engines.node);
if (!nodeRange) throw new Error(`Unexpected engines.node in the CLI package: ${cli.engines.node}`);

/** Each endpoint as "POST /v1/orders/{orderId}/pay", by tool or account route name. */
const ROUTES = Object.fromEntries(
  Object.entries({ ...HTTP_ROUTES, ...ACCOUNT_ROUTES }).map(([name, route]) => [name, `${route.method} ${route.path}`]),
) as Record<keyof typeof HTTP_ROUTES | keyof typeof ACCOUNT_ROUTES, string>;

/** The contract values the docs may state, by the name the contract exports;
 *  a few derived from them (`ROUTES`, `API_BASE_URL`, `GUIDE_SENTENCES`, the
 *  contract guide's own words); the CLI's Node.js floor from its published
 *  package metadata; and the CLI's exit codes from its source. */
const FACTS = {
  CLI_NODE_MAJOR: Number(nodeRange[1]),
  CLI_EXIT,
  API_BASE_URL,
  ROUTES,
  GUIDE_SENTENCES: { adaptivePricing: ADAPTIVE_PRICING },
  ORDER_NEXT_STEP,
  ME_SCOPES,
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
