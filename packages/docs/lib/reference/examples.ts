import cancelBody from "../../examples/bodies/cancel.json" with { type: "json" };
import offersBody from "../../examples/bodies/offers.json" with { type: "json" };
import orderBody from "../../examples/bodies/order.json" with { type: "json" };
import payTokenBody from "../../examples/bodies/pay-token.json" with { type: "json" };
import priceMatchBody from "../../examples/bodies/price-match.json" with { type: "json" };
import searchBody from "../../examples/bodies/search.json" with { type: "json" };
import { EXAMPLE_IDS, type OperationId } from "./responses.ts";

/** An example request: its name, a title, the path and query values it
 *  sends, and its JSON body (`examples/bodies/<name>.json`). */
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
  request_price_match: [{ name: "price-match", title: "Request price match", body: priceMatchBody }],
  get_price_match: [{ name: "get-price-match", title: "Get price match", params: { claimId: EXAMPLE_IDS.claimId } }],
  create_order: [{ name: "order", title: "Create order", body: orderBody }],
  get_order: [{ name: "get-order", title: "Get order", params: { orderId: EXAMPLE_IDS.orderId } }],
  list_orders: [{ name: "list-orders", title: "List orders", params: { limit: 10 } }],
  cancel_order: [{ name: "cancel", title: "Cancel order", params: { orderId: EXAMPLE_IDS.orderId }, body: cancelBody }],
  pay_order: [{ name: "pay-token", title: "Link token", params: { orderId: EXAMPLE_IDS.orderId }, body: payTokenBody }],
  me: [{ name: "me", title: "Account" }],
  auth_config: [{ name: "device-login", title: "OAuth sign-in settings" }],
};
