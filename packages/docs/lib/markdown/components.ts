// The data components MDX pages use, as the Markdown trees they expand into
// at compile time (`lib/remark-components.ts`). The page, its search records
// and its Markdown text are all made from these trees.
import {
  DISPLAY_CURRENCIES,
  type ErrorCode,
  FILTERABLE_AMENITIES,
  GLOBAL_FLAGS,
  LIMITS,
  MCP_SERVER_URL,
  ORDER_STATUSES,
  PAY_INPUT_WAYS,
  PAY_WAYS,
  PAYMENT_STATUSES,
  TOOLS,
} from "@fortrip/agent-contract";
import type { PhrasingContent } from "mdast";

import { CLIENT_IDS, CLIENT_SETUP, MCP_REGISTRY } from "../prose/clients.ts";
import { PRE_RELEASE_POLICY, PRE_RELEASE_POLICY_ON_CHANGELOG } from "../prose/compatibility.ts";
import { contentSentence } from "../prose/mcp-content.ts";
import { ORDER_STATUS_DOCS, PAYMENT_STATUS_DOCS } from "../prose/order-statuses.ts";
import { PAY_WAY_DOCS } from "../prose/pay-ways.ts";
import { ENDPOINTS } from "../reference/api-docs.ts";
import { CLI_COMMANDS, RAW_BODY_EXAMPLE } from "../reference/cli-commands.ts";
import { ENVIRONMENT_ROWS } from "../reference/environment.ts";
import { ERROR_ROWS } from "../reference/error-docs.ts";
import { EXIT_ROWS } from "../reference/exit-codes.ts";
import { failClosedClause, limitRows, OPERATION_NAMES, rateLimitRows } from "../reference/limits.ts";
import { MCP_TOOLS } from "../reference/mcp-tools.ts";
import { regionGroups } from "../reference/regions.ts";
import { RESPONSE_DOCS, responseDocFor, responseDocForCommand, schemaHref } from "../reference/response-docs.ts";
import {
  type Block,
  code,
  codeBlock,
  codeList,
  heading,
  inline,
  joined,
  lineBreak,
  link,
  list,
  paragraph,
  strong,
  table,
  text,
} from "./mdast.ts";
import { fields } from "./widgets.ts";

type Props = Record<string, string>;

/** A table of statuses in the contract's order, each with what it means. */
function statusTable<S extends string>(statuses: readonly S[], docs: Record<S, string>): Block[] {
  return [table(["Status", "Meaning"], statuses.map((s) => ({ cells: [[code(s)], inline(docs[s])] })))];
}

/** The tools whose MCP answer carries `nextStep` (the response docs' flag,
 *  which response-docs.test.ts checks against the contract's MCP outputs). */
const nextStepTools = () =>
  TOOLS.filter((tool) => responseDocFor(tool.name)?.mcpNextStep === true).map((tool) => tool.name);

/** What a call answers when the rate limiter is down and refuses it. */
const serviceUnavailable = (() => {
  const row = ERROR_ROWS.find((r) => r.code === ("service_unavailable" satisfies ErrorCode));
  if (!row) throw new Error("no service_unavailable error row");
  return row;
})();

/** Components that stand on their own line, by name. */
export const BLOCKS: Record<string, (props: Props) => Block[]> = {
  /** The ways to pay an order, in the contract's order: a line each
   *  (`summary`), or a section each with when it applies, when it charges
   *  and how (`full`). */
  PayWays: ({ variant }) => {
    if (variant === "summary") {
      return [list(PAY_WAYS.map((way) => [strong(text(PAY_WAY_DOCS[way].title)), text(": "), ...inline(PAY_WAY_DOCS[way].charge)]))];
    }
    if (variant !== "full") throw new Error(`<PayWays> variant must be "summary" or "full", not ${variant}`);
    return PAY_WAYS.flatMap((way) => {
      const doc = PAY_WAY_DOCS[way];
      return [
        heading(3, [text(doc.title)], `pay-${way.replaceAll("_", "-")}`),
        paragraph(inline(doc.when)),
        paragraph([strong(text("Charged:")), text(" "), ...inline(doc.charge)]),
        paragraph(inline(doc.body)),
      ];
    });
  },

  /** Setup for each client, a section each, in `CLIENT_IDS` order. */
  ClientSetup: () =>
    CLIENT_IDS.flatMap((id) => {
      const client = CLIENT_SETUP[id];
      return [
        heading(3, [text(client.name)], id),
        ...(client.code ? [codeBlock(client.code.lang, client.code.text)] : []),
        list(client.steps.map(inline), true),
        ...(client.note ? [paragraph(inline(client.note))] : []),
      ];
    }),

  /** How the remote server is reached, and where it is listed. */
  RemoteMcpTable: () => [
    list([
      [strong(text("Endpoint")), text(": "), code(MCP_SERVER_URL)],
      [strong(text("Transport")), text(": Streamable HTTP")],
      [strong(text("Authentication")), text(": OAuth sign-in with a Fortrip account. No API key.")],
      [
        strong(text("Listed in")),
        text(": the "),
        link(MCP_REGISTRY.url, text("MCP Registry")),
        text(" as "),
        code(MCP_REGISTRY.name),
        text(", and "),
        link(MCP_REGISTRY.glamaUrl, text("Glama")),
      ],
    ]),
  ],

  /** The pre-release compatibility policy, with its links. */
  /** `page="changelog"` on the changelog itself, which doesn't link to itself. */
  PreReleasePolicy: (props) => [
    paragraph(inline(props.page === "changelog" ? PRE_RELEASE_POLICY_ON_CHANGELOG : PRE_RELEASE_POLICY)),
  ],

  /** The order's `status`, each with what it means, in the contract's order. */
  OrderStatuses: () => statusTable(ORDER_STATUSES, ORDER_STATUS_DOCS),

  /** The order's `payment.status`, each with what it means. */
  PaymentStatuses: () => statusTable(PAYMENT_STATUSES, PAYMENT_STATUS_DOCS),

  /** The tools, each linking to its page. */
  ToolList: () => [
    table(
      ["Tool", "Description", "Access"],
      MCP_TOOLS.map((tool) => ({
        cells: [[link(`/mcp/${tool.slug}`, code(tool.name))], [text(tool.title)], [text(tool.access)]],
      })),
    ),
  ],

  /** Each tool's successful `content`, block by block. */
  McpContentTable: () => [
    table(["Tool", "content"], TOOLS.map((tool) => ({ cells: [[code(tool.name)], inline(contentSentence(tool.name))] }))),
  ],

  /** The commands, each linking to its page. */
  CommandList: () => [
    table(
      ["Command", "Description"],
      CLI_COMMANDS.map((command) => ({
        cells: [[link(`/cli/${command.slug}`, code(command.invocation))], [text(command.title)]],
      })),
    ),
  ],

  /** The options of the CLI itself. */
  GlobalFlags: () => [
    table(
      ["Flag", "Description"],
      GLOBAL_FLAGS.map((option) => ({
        cells: [[code(`${option.short ? `-${option.short}, ` : ""}--${option.flag}`)], [text(option.description)]],
      })),
    ),
  ],

  /** The environment variables a reader sets, from the CLI's own list. */
  EnvironmentTable: () => [
    table(
      ["Variable", "Meaning"],
      ENVIRONMENT_ROWS.map((row) => ({ cells: [[code(row.name)], inline(row.meaning)] })),
    ),
  ],

  RawBodyExample: () => [codeBlock("sh", `fortrip hotels search --body '${JSON.stringify(RAW_BODY_EXAMPLE)}'`)],

  /** The v1 endpoints, with the input, the answer and the matching tool and command. */
  EndpointTable: () => [
    table(
      ["Endpoint", "Input", "Answer", "MCP / CLI"],
      ENDPOINTS.map((endpoint) => {
        const tool = MCP_TOOLS.find((t) => t.name === endpoint.tool);
        const response = responseDocForCommand(endpoint.cliSlug);
        const input: PhrasingContent[] =
          endpoint.input === "none"
            ? [text("None")]
            : tool
              ? [link(`/mcp/${tool.slug}#input`, text(endpoint.input === "body" ? "JSON body" : "Path and query"))]
              : [];
        return {
          cells: [
            [code(`${endpoint.method} ${endpoint.path}`), lineBreak(), text(endpoint.title)],
            input,
            [response ? link(schemaHref(response), text(response.title)) : text("OAuth settings")],
            [...(tool ? [code(tool.name), lineBreak()] : []), link(`/cli/${endpoint.cliSlug}`, text("CLI"))],
          ],
        };
      }),
    ),
  ],

  /** Every response object, a section each. */
  SchemaTables: () =>
    RESPONSE_DOCS.flatMap((doc) => {
      const tools = MCP_TOOLS.filter((tool) => doc.tools.includes(tool.name));
      const commands = CLI_COMMANDS.filter((c) => doc.cliSlugs.includes(c.slug));
      const where = [
        ...doc.http.map((endpoint) => [code(endpoint)]),
        ...tools.map((tool) => [link(`/mcp/${tool.slug}`, code(tool.name))]),
        ...commands.map((command) => [link(`/cli/${command.slug}`, code(command.invocation))]),
      ];
      return [
        heading(2, [text(doc.title)], doc.id),
        paragraph(joined(where, " · ")),
        ...(doc.mcpNextStep
          ? [
              paragraph([
                text("Over MCP the object also carries "),
                code("nextStep"),
                text(": what to show the user and ask before giving them "),
                code("payment.url"),
                text("."),
              ]),
            ]
          : []),
        fields(`response:${doc.id}`),
      ];
    }),

  ErrorCodes: () => [
    table(
      ["Code", "Status", "Retry", "Meaning and details"],
      ERROR_ROWS.map((row) => ({
        id: `code-${row.code}`,
        cells: [
          [code(row.code)],
          [text(String(row.status))],
          [text(row.retryable ? "Yes" : "No")],
          [...inline(row.meaning), ...(row.details ? [lineBreak(), code(`details: ${row.details}`)] : [])],
        ],
      })),
    ),
  ],

  /** The CLI's exit codes, from the CLI, each with what it means. */
  ExitCodes: () => [
    table(
      ["Code", "Meaning"],
      EXIT_ROWS.map((row) => ({ cells: [[code(String(row.code))], inline(row.meaning)] })),
    ),
  ],

  /** The rate limits, then which calls the limiter refuses while it is down. */
  RateLimitsTable: () => [
    table(
      ["Scope", "Calls", "Per minute"],
      rateLimitRows().map((row) => ({
        cells: [
          [code(row.scope)],
          [
            text(
              row.operations
                .map((name) => OPERATION_NAMES[name])
                .join(", ")
                .replace(/^./, (c) => c.toUpperCase()),
            ),
          ],
          [text(String(row.perMinute))],
        ],
      })),
    ),
    paragraph([
      ...inline(`If the rate limiter itself is down, calls go through, except ${failClosedClause()} `),
      code(`${serviceUnavailable.status} ${serviceUnavailable.code}`),
      text(" instead."),
    ]),
  ],

  LimitsTable: () => [
    table(
      ["Limit", "Value", "Applies to"],
      limitRows(LIMITS).map(([name, value, description]) => ({ cells: [[text(name)], inline(value), inline(description)] })),
    ),
  ],

  /** The enabled regions by country, with their count. */
  RegionList: () => {
    const groups = regionGroups();
    const total = groups.reduce((sum, group) => sum + group.regions.length, 0);
    return [
      paragraph([
        text(`${total} regions in ${groups.length} ${groups.length === 1 ? "country" : "countries"}. Search one by name with its `),
        code("countryCode"),
        text(", or as "),
        code('{ kind: "place", placeId }'),
        text("."),
      ]),
      ...groups.flatMap((group) => [
        heading(3, [text(`${group.country} `), code(group.countryCode)]),
        table(["Region", "placeId"], group.regions.map((region) => ({ cells: [[text(region.name)], [code(region.placeId)]] }))),
      ]),
    ];
  },

  /** The destination kinds of a search, from the contract's input schema. */
  DestinationFields: () => [fields("destination")],
};

/** Components that stand inside a sentence, by name. */
export const INLINE: Record<string, (props: Props) => PhrasingContent[]> = {
  /** The fields of the pay input, one of which a call sends. */
  PayInputs: () => codeList(Object.keys(PAY_INPUT_WAYS)),
  /** The amenity codes a search can filter by. */
  FilterableAmenities: () => joined(FILTERABLE_AMENITIES.map((c) => [code(c)]), ", "),
  /** The currencies a price can also be shown in, besides USD. */
  OtherDisplayCurrencies: () => {
    const others = DISPLAY_CURRENCIES.filter((c) => c !== "USD");
    return [text(others.length > 1 ? `${others.slice(0, -1).join(", ")} or ${others.at(-1)}` : others.join(""))];
  },
  NextStepTools: () => codeList(nextStepTools()),
};
