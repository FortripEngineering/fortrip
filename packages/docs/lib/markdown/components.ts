// The data components MDX pages use, as the Markdown trees they expand into
// at compile time (`lib/remark-components.ts`). The page, its search records
// and its Markdown text are all made from these trees.
import {
  CANCEL_BLOCKERS,
  type Destination,
  destination,
  CURRENCIES,
  type ErrorCode,
  FAILURE_REASONS,
  FILTERABLE_AMENITIES,
  GLOBAL_FLAGS,
  HTTP_ROUTES,
  LIMITS,
  MCP_SERVER_URL,
  META_KEYS,
  ORDER_STATUSES,
  PAY_WAYS,
  PAYMENT_STATUSES,
  type RenderedTool,
  type ToolName,
  renderError,
  renderToolResult,
  TOOLS,
} from "@fortrip/agent-contract";
import type { PhrasingContent } from "mdast";

import { CLIENT_IDS, CLIENT_SETUP, MCP_REGISTRY } from "../prose/clients.ts";
import { PRE_RELEASE_POLICY } from "../prose/compatibility.ts";
import { MCP_TEXT_RULES, META_KEY_DOCS, RULE_DOCS } from "../prose/mcp-content.ts";
import {
  CANCEL_BLOCKER_DOCS,
  FAILURE_REASON_DOCS,
  ORDER_STATUS_DOCS,
  PAYMENT_STATUS_DOCS,
} from "../prose/order-statuses.ts";
import { PAY_WAY_DOCS } from "../prose/pay-ways.ts";
import { PAY_AFTER_TIMEOUT, RETRY_DOCS, RETRY_WAYS } from "../prose/retries.ts";
import { ENDPOINTS, inputAnchor, referenceHref } from "../reference/api-docs.ts";
import { CLI_COMMANDS, RAW_BODY_EXAMPLE } from "../reference/cli-commands.ts";
import { ENVIRONMENT_ROWS } from "../reference/environment.ts";
import { ERROR_ROWS } from "../reference/error-docs.ts";
import { EXIT_ROWS } from "../reference/exit-codes.ts";
import { limitRows, OPERATION_NAMES, rateLimitRows } from "../reference/limits.ts";
import { MCP_TOOLS } from "../reference/mcp-tools.ts";
import { regionGroups } from "../reference/regions.ts";
import { ERRORS, type OperationId, RESPONSES } from "../reference/responses.ts";
import {
  RESPONSE_DOCS,
  type ResponseDoc,
  responseDoc,
  responseDocFor,
  responseDocForCommand,
  schemaHref,
  schemaTitle,
} from "../reference/response-docs.ts";
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

/** A table of an enum's values in the contract's order, each with what it means. */
function statusTable<S extends string>(statuses: readonly S[], docs: Record<S, string>, head = "Status"): Block[] {
  return [table([head, "Meaning"], statuses.map((s) => ({ cells: [[code(s)], inline(docs[s])] })))];
}


/** A response's section body: its fields; for an answer that is another
 *  object, a line pointing there; for a list, its own fields, `data` linking
 *  to the object it lists. */
function responseBody(doc: ResponseDoc): Block[] {
  if (doc.sameAs) {
    const same = responseDoc(doc.sameAs);
    return [paragraph([text("The answer is the "), link(`#${same.id}`, text(same.title)), text(".")])];
  }
  if (doc.listOf) {
    const item = responseDoc(doc.listOf);
    return [
      list(
        doc.rows
          .filter((row) => row.depth === 0)
          .map((row) =>
            row.path === "data"
              ? [code(row.path), text(" ("), link(`#${item.id}`, text(item.title)), text("[]): newest first.")]
              : [code(row.path), text(" ("), code(row.type), text(")"), ...(row.description ? [text(": "), ...inline(row.description)] : [])],
          ),
      ),
    ];
  }
  return [fields(`response:${doc.id}`)];
}

/** Components that stand on their own line, by name. */
export const BLOCKS: Record<string, (props: Props) => Block[]> = {
  /** The ways to pay an order, in the contract's order: named in one
   *  sentence (`sentence`), or a section each with when it applies, when it
   *  charges and how (`full`). */
  PayWays: ({ variant }) => {
    if (variant === "sentence") {
      const names = PAY_WAYS.map((way) => PAY_WAY_DOCS[way].short);
      return [
        paragraph(
          inline(
            `The user pays in one of these ways: ${names.slice(0, -1).join(", ")}, or ${names.at(-1)}. Nothing is charged before that.`,
          ),
        ),
      ];
    }
    if (variant !== "full") throw new Error(`<PayWays> variant must be "sentence" or "full", not ${variant}`);
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

  /** What sending each call again does, for the HTTP API and the MCP tools. */
  RetryTable: () => [
    table(
      ["Call", "Sending it again"],
      RETRY_DOCS.map((doc) => ({
        cells: [
          doc.reads
            ? [text("Reads: "), ...codeList([...doc.tools])]
            : doc.tools.flatMap((tool) => {
                const route = HTTP_ROUTES[tool as keyof typeof HTTP_ROUTES];
                return [code(`${route.method} ${route.path}`), lineBreak(), code(tool)];
              }),
          inline(doc.again),
        ],
      })),
    ),
  ],

  /** What to do after each code a retry can help, from `RETRY_WAYS`: the
   *  one statement of it, on the API page. */
  RetryCodes: () => {
    const codes = (names: readonly string[]) => codeList(names);
    const after = [code("retryAfterSeconds")];
    return [
      paragraph([
        text("Retry "),
        ...codes(RETRY_WAYS.once),
        text(" once, with the same details, after "),
        ...after,
        text(". "),
        ...codes(RETRY_WAYS.untilAnswered),
        text(": send the same call again after "),
        ...after,
        text(" until it answers. "),
        ...codes(RETRY_WAYS.readOrder),
        text(": read the order after "),
        ...after,
        text(". Other codes need a change first: the "),
        link("/errors#codes", text("error codes")),
        text(" say what to do."),
      ]),
    ];
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

  /** The pre-release compatibility policy, as the changelog states it. */
  PreReleasePolicy: () => [paragraph(inline(PRE_RELEASE_POLICY))],

  /** The order's `status`, each with what it means, in the contract's order. */
  OrderStatuses: () => statusTable(ORDER_STATUSES, ORDER_STATUS_DOCS),

  /** The order's `payment.status`, each with what it means. */
  PaymentStatuses: () => statusTable(PAYMENT_STATUSES, PAYMENT_STATUS_DOCS),

  /** The values of an order's `cancel.blockedBy`, each with what it means. */
  CancelBlockers: () => statusTable(CANCEL_BLOCKERS, CANCEL_BLOCKER_DOCS, "blockedBy"),

  /** The values of a failed order's `failure.reason`, each with what it means. */
  FailureReasons: () => statusTable(FAILURE_REASONS, FAILURE_REASON_DOCS, "reason"),

  /** The tools, each linking to its section of its operation's page. */
  ToolList: () => [
    table(
      ["Tool", "Title", "Access"],
      MCP_TOOLS.map((tool) => ({
        cells: [[link(tool.href, code(tool.name))], [text(tool.title)], [text(tool.access)]],
      })),
    ),
  ],

  /** The rules that end a result's text after its data, each with the tools
   *  that carry it and when, from `MCP_TEXT_RULES`. */
  ResultRules: () => {
    const rules = Object.keys(RULE_DOCS) as Array<keyof typeof RULE_DOCS>;
    return [
      list(
        rules.map((rule) => {
          const { name, when, says } = RULE_DOCS[rule];
          const tools = TOOLS.filter((tool) => MCP_TEXT_RULES[tool.name].includes(rule)).map((tool) => tool.name);
          return [
            ...codeList(tools),
            ...inline(` end with ${name}${when ? `, when ${when}` : ""}: ${says}.`),
          ];
        }),
      ),
    ];
  },

  /** The tools with their annotations, as an MCP client is told them. */
  ToolAnnotations: () => [
    table(
      ["Tool", "Reads only", "Destructive", "Idempotent", "Open world"],
      TOOLS.map((tool) => ({
        cells: [
          [code(tool.name)],
          ...[
            tool.annotations.readOnlyHint,
            tool.annotations.destructiveHint,
            tool.annotations.idempotentHint,
            tool.annotations.openWorldHint,
          ].map((hint) => [text(hint ? "Yes" : "No")]),
        ],
      })),
    ),
  ],

  /** The commands, each linking to where it is documented. */
  CommandList: () => [
    table(
      ["Command", "Description"],
      CLI_COMMANDS.map((command) => ({
        cells: [[link(command.href, code(command.invocation))], [text(command.title)]],
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
        const command = CLI_COMMANDS.find((c) => c.slug === endpoint.cliSlug);
        const response = responseDocForCommand(endpoint.cliSlug);
        const input: PhrasingContent[] =
          endpoint.input === "none"
            ? [text("None")]
            : endpoint.tool
              ? [
                  link(
                    `${referenceHref(endpoint.tool)}#${inputAnchor(HTTP_ROUTES[endpoint.tool])}`,
                    text(endpoint.input === "body" ? "JSON body" : "Path and query"),
                  ),
                ]
              : [];
        return {
          cells: [
            [code(`${endpoint.method} ${endpoint.path}`), lineBreak(), text(endpoint.title)],
            input,
            [response ? link(schemaHref(response), text(schemaTitle(response))) : text("OAuth sign-in settings")],
            [
              ...(tool ? [link(tool.href, code(tool.name)), lineBreak()] : []),
              ...(command ? [link(command.href, code(command.invocation))] : []),
            ],
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
        ...tools.map((tool) => [link(tool.href, code(tool.name))]),
        ...commands.map((command) => [link(command.href, code(command.invocation))]),
      ];
      return [
        heading(2, [text(doc.title)], doc.id),
        paragraph(joined(where, " · ")),
        ...responseBody(doc),
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
          [
            ...inline(row.meaning),
            ...(row.details ? [lineBreak(), code("details"), text(":"), ...row.details.flatMap((line) => [lineBreak(), ...inline(line)])] : []),
          ],
        ],
      })),
    ),
  ],

  /** The `_meta` keys of an MCP result, from the contract's `META_KEYS`. */
  MetaKeys: () => [
    table(
      ["Key", "On", "Value"],
      (Object.keys(META_KEYS) as (keyof typeof META_KEYS)[]).map((name) => ({
        cells: [[code(META_KEYS[name])], inline(META_KEY_DOCS[name].on), inline(META_KEY_DOCS[name].value)],
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

  RateLimitsTable: () => [
    table(
      ["Rate limit", "Calls", "Per minute"],
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

  /** The destination kinds of a search, each with what it is for, from the
   *  contract's input schema, and an example; the fields are on the
   *  operation's reference page. */
  DestinationKinds: () => [
    table(
      ["Kind", "Use it for", "Example"],
      destination.options.map((option) => {
        const kind = option.shape.kind.value;
        return { cells: [[code(kind)], inline(option.shape.kind.description ?? ""), [code(DESTINATION_EXAMPLES[kind])]] };
      }),
    ),
    paragraph([
      text("Every field: "),
      link(`${referenceHref("search_hotels")}#${inputAnchor(HTTP_ROUTES.search_hotels)}`, code("search_hotels"), text(" input")),
      text("."),
    ]),
  ],

  /** An error envelope the reference shows, as JSON: the whole envelope, or
   *  with `part="details"` its `details`. */
  ErrorExample: ({ code: errorCode = "", part }) => {
    const { envelope } = errorExample(errorCode);
    if (part !== undefined && part !== "details") throw new Error(`<ErrorExample> part must be "details", not ${part}`);
    return [codeBlock("json", json(part === "details" ? (envelope.error as { details?: unknown }).details : envelope))];
  },

  /** A tool's result for its example answer: the one text block the
   *  contract's `renderToolResult` writes, as the MCP server sends it. */
  ToolResultSample: ({ tool = "" }) => {
    if (!(tool in RESPONSES) || !TOOLS.some((t) => t.name === tool)) throw new Error(`<ToolResultSample> has no answer of ${tool}`);
    return [codeBlock("text", renderToolResult(tool as RenderedTool, RESPONSES[tool as OperationId], "mcp"))];
  },

  /** An error's result: the one text block the contract's `renderError`
   *  writes, with no HTTP status, as the MCP server sends it. */
  ToolErrorSample: ({ code: errorCode = "" }) => {
    const { envelope } = errorExample(errorCode);
    return [codeBlock("text", renderError(envelope, undefined, "mcp"))];
  },
};

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** A destination of each kind, as a search sends it. */
const DESTINATION_EXAMPLES: Record<Destination["kind"], string> = {
  place_name: '{ kind: "place_name", name: "Kyoto", countryCode: "JP" }',
  place: '{ kind: "place", placeId: "plc_…" }',
  point: '{ kind: "point", location: { lat: 35.0116, lng: 135.7681 } }',
  country: '{ kind: "country", countryCode: "JP" }',
  locality: '{ kind: "locality", placeId: "plc_…" }',
};

function errorExample(errorCode: string) {
  if (!Object.hasOwn(ERRORS, errorCode)) throw new Error(`no example of the error ${errorCode}`);
  return ERRORS[errorCode as keyof typeof ERRORS];
}

/** Components that stand inside a sentence, by name. */
export const INLINE: Record<string, (props: Props) => PhrasingContent[]> = {
  /** The amenity codes a search can filter by. */
  FilterableAmenities: () => joined(FILTERABLE_AMENITIES.map((c) => [code(c)]), ", "),
  /** The currencies a request can ask for, besides USD. */
  OtherCurrencies: () => {
    const others = CURRENCIES.filter((c) => c !== "USD");
    return [text(others.length > 1 ? `${others.slice(0, -1).join(", ")} or ${others.at(-1)}` : others.join(""))];
  },
  /** What to do after a pay call timed out, as the retry table says it. */
  PayAfterTimeout: () => inline(PAY_AFTER_TIMEOUT),
};
