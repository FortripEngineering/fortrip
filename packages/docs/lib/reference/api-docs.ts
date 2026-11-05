import {
  ACCOUNT_ROUTES,
  HTTP_ROUTES,
  type HttpRoute,
  type HttpToolName,
  PUBLIC_ORIGINS,
} from "@fortrip/agent-contract";

/** `https://api.fortrip.ai/v1`: the contract's paths all start with `/v1`. */
export const API_BASE_URL = `${PUBLIC_ORIGINS.api}/v1`;

export interface Endpoint {
  method: HttpRoute["method"];
  /** From the contract's routes, `{name}` for a path parameter. */
  path: string;
  title: string;
  /** The MCP tool that takes the same input, if any. */
  tool: HttpToolName | null;
  /** The page slug of the CLI command that calls it. */
  cliSlug: string;
  /** Where the input is read. */
  input: "body" | "query" | "none";
  /** Sign-in needed: every endpoint but the OAuth sign-in settings. */
  auth: boolean;
}

type Docs = Pick<Endpoint, "title" | "cliSlug" | "input" | "auth">;

/** What the routes don't say, by tool, in docs order; a tool the contract
 *  routes fails the typecheck until it is listed. */
const TOOL_ENDPOINTS: Record<HttpToolName, Docs> = {
  search_hotels: { title: "Search hotels", cliSlug: "hotels-search", input: "body", auth: true },
  get_hotel: { title: "Hotel details", cliSlug: "hotels-get", input: "query", auth: true },
  get_hotel_offers: { title: "Live offers", cliSlug: "hotels-offers", input: "body", auth: true },
  book_hotel: { title: "Create order", cliSlug: "hotels-book", input: "body", auth: true },
  get_order: { title: "Get order", cliSlug: "orders-get", input: "query", auth: true },
  list_orders: { title: "List orders", cliSlug: "orders-list", input: "query", auth: true },
  cancel_order: { title: "Cancel order", cliSlug: "orders-cancel", input: "body", auth: true },
  pay_order: { title: "Pay order", cliSlug: "orders-pay", input: "body", auth: true },
};

const ACCOUNT_ENDPOINTS: Record<keyof typeof ACCOUNT_ROUTES, Docs> = {
  me: { title: "Account", cliSlug: "whoami", input: "none", auth: true },
  authConfig: { title: "OAuth sign-in settings", cliSlug: "login", input: "none", auth: false },
};

/** The v1 endpoints (spec §6), in docs order. */
export const ENDPOINTS: Endpoint[] = [
  ...(Object.keys(TOOL_ENDPOINTS) as HttpToolName[]).map((tool) => ({
    method: HTTP_ROUTES[tool].method,
    path: HTTP_ROUTES[tool].path,
    tool,
    ...TOOL_ENDPOINTS[tool],
  })),
  ...(Object.keys(ACCOUNT_ENDPOINTS) as Array<keyof typeof ACCOUNT_ROUTES>).map((name) => ({
    method: ACCOUNT_ROUTES[name].method,
    path: ACCOUNT_ROUTES[name].path,
    tool: null,
    ...ACCOUNT_ENDPOINTS[name],
  })),
];

/** The API reference page of an endpoint with a tool: `/api/reference/<tool>`. */
export const referenceHref = (tool: HttpToolName) => `/api/reference/${tool}`;

/** Where the reference page's input starts, as Fumadocs OpenAPI names its
 *  sections: the JSON body of a POST, else the path or query parameters. */
export function inputAnchor(route: HttpRoute): string {
  if (route.method === "POST") return "request-body";
  return route.pathFields.length > 0 ? "parameters-path" : "parameters-query";
}
