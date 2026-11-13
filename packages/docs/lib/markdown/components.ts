// The data components MDX pages use, as the Markdown trees they expand into
// at compile time (`lib/remark-components.ts`). The page, its search records
// and its Markdown text are all made from these trees.
import {
  ACCOUNT_ROUTES,
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
  ORDER_STATUSES,
  PAY_WAYS,
  PAYMENT_STATUSES,
  PUBLIC_ORIGINS,
  type RenderedTool,
  type ToolName,
  renderError,
  renderToolResult,
  TOOLS,
} from "@fortrip/agent-contract";
import type { PhrasingContent } from "mdast";

import { CLIENT_IDS, CLIENT_SETUP, MCP_REGISTRY } from "../prose/clients.ts";
import { PRE_RELEASE_POLICY } from "../prose/compatibility.ts";
import { MCP_TEXT_RULES, RULE_DOCS } from "../prose/mcp-content.ts";
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
import { failClosedClause, limitRows, OPERATION_NAMES, rateLimitRows } from "../reference/limits.ts";
import { MCP_TOOLS } from "../reference/mcp-tools.ts";
import { regionGroups } from "../reference/regions.ts";
import { EXAMPLE_LANGUAGES, EXAMPLE_REQUESTS, exampleCode } from "../reference/examples.ts";
import { abridgedAnswer, ERRORS, EXAMPLE_IDS, type OperationId, RESPONSES } from "../reference/responses.ts";
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

/** What a call answers when the rate limiter is down and refuses it. */
const serviceUnavailable = (() => {
  const row = ERROR_ROWS.find((r) => r.code === ("service_unavailable" satisfies ErrorCode));
  if (!row) throw new Error("no service_unavailable error row");
  return row;
})();

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

/** The jq filters the quickstart's calls read their ids with: the first
 *  hotel found, and the first offer of any hotel offered, which is where
 *  `EXAMPLE_IDS` takes them from the example answers. */
export const END_TO_END_IDS = {
  hotel: { file: "search.json", path: ".data[0].hotelId", none: "No hotel found: search another place or other dates." },
  offer: { file: "offers.json", path: "[.hotels[].offers[]][0].offerId", none: "No offer matches: pick another hotel from step 2." },
} as const;

/** Reads an id into a shell variable with `jq -e`, which fails on `null`;
 *  when there is none it says so and fails too, without leaving the shell. */
const readId = (name: string, { file, path, none }: (typeof END_TO_END_IDS)[keyof typeof END_TO_END_IDS]) =>
  `${name}=$(jq -re '${path}' ${file}) || { echo "${none}" >&2; false; }`;

/** The curl sign-in script, as the quickstart's first step saves it: the
 *  example file without its `#!` line. */
function signInScript(): string {
  const curl = EXAMPLE_LANGUAGES.find((language) => language.dir === "curl");
  if (!curl) throw new Error("no curl examples");
  return exampleCode("device-login", curl).replace(/^#!.*\n/, "").trimEnd();
}

/** One call of the quickstart in curl: its example's body and time limit,
 *  with the ids an earlier call gave as shell variables, and its answer
 *  saved to `file`. */
function endToEndCall(op: "search_hotels" | "get_hotel_offers" | "create_order", file: string): string {
  const route = HTTP_ROUTES[op];
  const example = EXAMPLE_REQUESTS[op][0];
  const curl = EXAMPLE_LANGUAGES.find((language) => language.dir === "curl");
  const maxTime = curl && example && /--max-time (\d+)/.exec(exampleCode(example.name, curl))?.[1];
  if (!maxTime) throw new Error(`no curl time limit for ${op}`);
  const body = JSON.stringify(example?.body, null, 2)
    // An id an earlier step didn't find stops the call before it is sent.
    .replaceAll(`"${EXAMPLE_IDS.hotelId}"`, '"${hotel:?no hotelId: run step 2 first}"')
    .replaceAll(`"${EXAMPLE_IDS.offerId}"`, '"${offer:?no offerId: run step 3 first}"');
  return [
    `curl -sS --fail-with-body --max-time ${maxTime} -X ${route.method} "${PUBLIC_ORIGINS.api}${route.path}" \\`,
    `  -H "Authorization: Bearer $FORTRIP_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  --data @- > ${file} <<JSON`,
    body,
    "JSON",
  ].join("\n");
}

/** The answer under a step, abridged. */
const abridged = (name: string): Block[] => [
  paragraph([text("The answer, abridged:")]),
  codeBlock("json", json(abridgedAnswer(name))),
];

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

  /** The API quickstart's five steps in curl, each step's answer abridged
   *  under it. */
  EndToEnd: () => {
    const order = RESPONSES.create_order as { payment: { url: string } };
    const { hotel, offer } = END_TO_END_IDS;
    return [
      heading(3, [text("1. Sign in")], "step-sign-in"),
      paragraph([
        text("Run this, then approve the sign-in in your browser. It saves the sign-in script as "),
        code("device-login.sh"),
        text(" and runs it, keeping the access token and the refresh token in "),
        code("token.json"),
        text(". "),
        link("#sign-in", text("Sign in")),
        text(" explains the flow."),
      ]),
      codeBlock(
        "sh",
        [
          "umask 077 # token.json and the files after it are readable by you only",
          "cat > device-login.sh <<'SH'",
          signInScript(),
          "SH",
          "bash device-login.sh > token.json",
          "export FORTRIP_TOKEN=$(jq -r .access_token token.json)",
        ].join("\n"),
      ),
      heading(3, [text("2. Search")], "step-search"),
      paragraph([text("Search a city for the stay, and take the first hotel's "), code("hotelId"), text(".")]),
      codeBlock("sh", `${endToEndCall("search_hotels", hotel.file)}\n${readId("hotel", hotel)}`),
      ...abridged("search"),
      heading(3, [text("3. Get offers")], "step-offers"),
      paragraph([text("Get live offers for that hotel, and take the first offer's "), code("offerId"), text(".")]),
      codeBlock("sh", `${endToEndCall("get_hotel_offers", offer.file)}\n${readId("offer", offer)}`),
      ...abridged("offers"),
      heading(3, [text("4. Create the order")], "step-order"),
      paragraph([
        text("Order the offer with the guests and a contact. Nothing is charged. It can take a couple of minutes, so allow at least three."),
      ]),
      codeBlock("sh", endToEndCall("create_order", "order.json")),
      ...abridged("order"),
      paragraph(
        inline(
          "If the price or terms changed, the answer is `409 offer_changed` instead, and `order.json` holds the error. Show the user `error.details.changes`; if they agree, order `error.details.offer.offerId` the same way. See [When the offer changed](/payments#offer-changed).",
        ),
      ),
      heading(3, [text("5. Give the user the payment link")], "step-pay"),
      paragraph([
        text("Show the user the total and every term, and wait for a clear yes. Then give them "),
        code("payment.url"),
        text(", where they pay."),
      ]),
      codeBlock("sh", "jq -r .payment.url order.json"),
      codeBlock("text", order.payment.url),
    ];
  },

  /** Renewing the access token with the refresh token the sign-in kept,
   *  in curl, after the sign-in script's `token.json`, which a failed
   *  refresh leaves as it was. */
  RefreshTokenExample: () => [
    codeBlock(
      "sh",
      [
        "umask 077 # the new token.json is readable by you only",
        `config=$(curl -sS --fail-with-body "${PUBLIC_ORIGINS.api}${ACCOUNT_ROUTES.authConfig.path}")`,
        "refresh_token=$(jq -r .refresh_token token.json)",
        'curl -sS --fail-with-body "$(jq -r .tokenEndpoint <<<"$config")" \\',
        "  -d grant_type=refresh_token \\",
        '  -d refresh_token="$refresh_token" \\',
        '  -d client_id="$(jq -r .clientId <<<"$config")" > token.new.json && mv token.new.json token.json',
        "export FORTRIP_TOKEN=$(jq -r .access_token token.json)",
      ].join("\n"),
    ),
  ],

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
   *  one statement of it, on the API and MCP pages. */
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

  /** The tools, each linking to its page. */
  ToolList: () => [
    table(
      ["Tool", "Title", "Access"],
      MCP_TOOLS.map((tool) => ({
        cells: [[link(`/mcp/${tool.slug}`, code(tool.name))], [text(tool.title)], [text(tool.access)]],
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

  /** An example's answer as JSON, abridged to the fields the next step reads
   *  (`name` is the example's, as `<Example>` takes it). */
  ResponseExample: ({ name = "" }) => [codeBlock("json", json(abridgedAnswer(name)))],

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
