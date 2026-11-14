import type { ToolName } from "./tools.ts";

/** The tools that are HTTP endpoints: every tool. */
export type HttpToolName = ToolName;

export interface HttpRoute {
  method: "GET" | "POST";
  /** An OpenAPI path template, e.g. `/v1/orders/{orderId}/pay`. */
  path: string;
  /** Input fields that fill the template's `{braces}`. */
  pathFields: readonly string[];
  /** Input fields a request carries in its query, in this order. A POST
   *  sends every other field as its body. */
  queryFields: readonly string[];
}

const route = (
  method: HttpRoute["method"],
  path: string,
  queryFields: readonly string[] = [],
): HttpRoute => ({
  method,
  path,
  pathFields: [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string),
  queryFields,
});

/** Where each tool's request goes. */
export const HTTP_ROUTES: Record<HttpToolName, HttpRoute> = {
  search_hotels: route("POST", "/v1/hotels/search"),
  get_hotel: route("GET", "/v1/hotels/{hotelId}", ["include", "locale"]),
  get_hotel_offers: route("POST", "/v1/hotels/offers"),
  create_order: route("POST", "/v1/orders"),
  get_order: route("GET", "/v1/orders/{orderId}", ["locale"]),
  list_orders: route("GET", "/v1/orders", ["cursor", "limit", "locale"]),
  cancel_order: route("POST", "/v1/orders/{orderId}/cancel"),
  pay_order: route("POST", "/v1/orders/{orderId}/pay"),
};

/** The two endpoints that are not tools: who the caller is, and how to sign in. */
export const ACCOUNT_ROUTES: { me: HttpRoute; authConfig: HttpRoute } = {
  me: route("GET", "/v1/me"),
  authConfig: route("GET", "/v1/auth/config"),
};

/** The request path for `input`: path fields filled in (URL-encoded), then
 *  the query fields that are set. */
export function routePath(route: HttpRoute, input: Record<string, unknown>): string {
  const path = route.path.replace(/\{(\w+)\}/g, (_, field: string) =>
    encodeURIComponent(String(input[field])),
  );
  const query = new URLSearchParams();
  for (const field of route.queryFields) {
    if (input[field] !== undefined) query.set(field, String(input[field]));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
