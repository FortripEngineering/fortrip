import { readFileSync } from "node:fs";
import { join } from "node:path";

import cancelBody from "../../examples/bodies/cancel.json" with { type: "json" };
import offersBody from "../../examples/bodies/offers.json" with { type: "json" };
import orderBody from "../../examples/bodies/order.json" with { type: "json" };
import payTokenBody from "../../examples/bodies/pay-token.json" with { type: "json" };
import searchBody from "../../examples/bodies/search.json" with { type: "json" };
import { EXAMPLE_IDS, type OperationId } from "./responses.ts";

/** The languages each example is written in: its tab, folder, extension and highlighting. */
export const EXAMPLE_LANGUAGES = [
  { label: "curl", dir: "curl", ext: "sh", lang: "bash" },
  { label: "TypeScript", dir: "ts", ext: "ts", lang: "ts" },
  { label: "Python", dir: "py", ext: "py", lang: "python" },
] as const;

/** An example's code in one language, read from `examples/` at build time.
 *  The files are what the examples test holds to the contract. */
export function exampleCode(name: string, language: (typeof EXAMPLE_LANGUAGES)[number]): string {
  return readFileSync(join(process.cwd(), "examples", language.dir, `${name}.${language.ext}`), "utf8").trimEnd();
}

/** An example request: its name under `examples/`, a title, the path and
 *  query values it sends, and its JSON body. */
export interface ExampleRequest {
  name: string;
  title: string;
  params?: Record<string, string | number>;
  body?: unknown;
}

/** Each operation's example requests, by its OpenAPI id: what the examples
 *  send, which the API reference sends too. */
export const EXAMPLE_REQUESTS: Record<OperationId, ExampleRequest[]> = {
  search_hotels: [{ name: "search", title: "Search hotels", body: searchBody }],
  get_hotel: [{ name: "get-hotel", title: "Hotel details", params: { hotelId: EXAMPLE_IDS.hotelId } }],
  get_hotel_offers: [{ name: "offers", title: "Live offers", body: offersBody }],
  create_order: [{ name: "order", title: "Create order", body: orderBody }],
  get_order: [{ name: "get-order", title: "Get order", params: { orderId: EXAMPLE_IDS.orderId } }],
  list_orders: [{ name: "list-orders", title: "List orders", params: { limit: 10 } }],
  cancel_order: [{ name: "cancel", title: "Cancel order", params: { orderId: EXAMPLE_IDS.orderId }, body: cancelBody }],
  pay_order: [{ name: "pay-token", title: "Link token", params: { orderId: EXAMPLE_IDS.orderId }, body: payTokenBody }],
  me: [{ name: "me", title: "Account" }],
  auth_config: [{ name: "device-login", title: "OAuth sign-in settings" }],
};
