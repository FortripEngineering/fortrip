import offerChanged from "./fixtures/error-offer-changed.json" with { type: "json" };
import authConfig from "./fixtures/auth-config.json" with { type: "json" };
import hotel from "./fixtures/get-hotel.json" with { type: "json" };
import offers from "./fixtures/get-hotel-offers.json" with { type: "json" };
import me from "./fixtures/me.json" with { type: "json" };
import order from "./fixtures/order-awaiting-payment.json" with { type: "json" };
import cancelling from "./fixtures/order-cancelling.json" with { type: "json" };
import paidByToken from "./fixtures/order-paid-by-token.json" with { type: "json" };
import search from "./fixtures/search-hotels.json" with { type: "json" };

/*
 * Example answers: one per operation, the pay answer of its request, and
 * the errors the reference shows. They chain as the examples' requests do:
 * the search finds the hotel the offers are for, and the order is of the
 * first offer. `responses.test.ts` parses each with the contract's strict
 * output schema, so none can drift from it.
 */

/** The ids the examples' requests send and these answers carry. */
export const EXAMPLE_IDS = {
  hotelId: search.data[0]!.hotelId,
  offerId: offers.hotels[0]!.offers[0]!.offerId,
  orderId: order.orderId,
} as const;

/** The answer of each operation (by its OpenAPI id) to its example request. */
export const RESPONSES = {
  search_hotels: search,
  get_hotel: hotel,
  get_hotel_offers: offers,
  book_hotel: order,
  get_order: order,
  list_orders: { data: [order], nextCursor: null },
  cancel_order: cancelling,
  pay_order: paidByToken,
  me,
  auth_config: authConfig,
} as const;

export type OperationId = keyof typeof RESPONSES;

/** `pay_order`'s answer to each pay example: a token pays the order. */
export const PAY_RESPONSES = { "pay-token": paidByToken } as const;

/** Error envelopes, with the HTTP status each is answered with. */
export const ERRORS = {
  /** The 409 `POST /v1/orders` answers when the price or terms changed. */
  offer_changed: { status: 409, envelope: offerChanged },
  unauthenticated: {
    status: 401,
    envelope: {
      error: {
        code: "unauthenticated",
        message: "Send a valid OAuth access token as `Authorization: Bearer <token>`.",
        retryable: false,
        requestId: "req_Jd2wF8kQ5nX1vT7mR4pB",
      },
    },
  },
  service_unavailable: {
    status: 503,
    envelope: {
      error: {
        code: "service_unavailable",
        message: "A service this request needs is unavailable right now; try again shortly.",
        retryable: true,
        retryAfterSeconds: 5,
        requestId: "req_Bq6tY3cL0wZ9hN5sK8xD",
      },
    },
  },
} as const;

/** The error an operation's reference page shows: the one its callers meet
 *  first that the endpoint answers. */
export function errorExampleFor(id: OperationId): keyof typeof ERRORS {
  if (id === "book_hotel") return "offer_changed";
  return id === "auth_config" ? "service_unavailable" : "unauthenticated";
}

/** A path's steps: `data[0].name` is `data`, `[0]`, `name`; `[]` is every item. */
const steps = (path: string): string[] =>
  path.split(".").flatMap((part) => part.match(/[^[\]]+|\[\d*\]/g) ?? []);

/** Whether `steps` lead to a value in `node` (through every item, for `[]`). */
function resolves(node: unknown, [step, ...rest]: string[]): boolean {
  if (step === undefined) return true;
  if (step.startsWith("[")) {
    if (!Array.isArray(node)) return false;
    const items = step === "[]" ? node : [node[Number(step.slice(1, -1))]];
    return items.length > 0 && items.every((item) => item !== undefined && resolves(item, rest));
  }
  return typeof node === "object" && node !== null && Object.hasOwn(node, step) && resolves((node as Record<string, unknown>)[step], rest);
}

/** `value` with only the listed paths kept (`data[0].hotelId`,
 *  `hotels[].offers[0].total`), in its own key order: an abridged answer that
 *  is still the real one. A path that leads nowhere throws. */
export function abridge(value: unknown, paths: readonly string[]): unknown {
  for (const path of paths) if (!resolves(value, steps(path))) throw new Error(`abridge: no ${path}`);
  const pick = (node: unknown, rest: string[][]): unknown => {
    if (rest.some((p) => p.length === 0)) return node;
    if (Array.isArray(node)) {
      return node.flatMap((item, i) => {
        const next = rest.filter(([s]) => s === "[]" || s === `[${i}]`).map((p) => p.slice(1));
        return next.length > 0 ? [pick(item, next)] : [];
      });
    }
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).flatMap(([key, child]) => {
        const next = rest.filter(([s]) => s === key).map((p) => p.slice(1));
        return next.length > 0 ? [[key, pick(child, next)]] : [];
      }),
    );
  };
  return pick(value, paths.map(steps));
}

/** Each example's answer, by the example's name under `examples/`, abridged
 *  to the fields the next step reads: the real answer, cut down. */
export const ABRIDGED: Record<string, { answer: unknown; paths: readonly string[] }> = {
  "device-login": { answer: authConfig, paths: ["clientId", "scopes", "deviceAuthorizationEndpoint", "tokenEndpoint"] },
  search: {
    answer: search,
    paths: ["destination.place.placeId", "destination.place.name", "data[0].hotelId", "data[0].name", "data[0].indicativePrice.fromPerRoomStay", "nextCursor"],
  },
  offers: {
    answer: offers,
    paths: [
      "hotels[0].hotelId",
      "hotels[0].offers[0].offerId",
      "hotels[0].offers[0].expiresAt",
      "hotels[0].offers[0].total",
      "hotels[0].offers[0].cancellation.status",
      "hotels[0].offers[0].cancellation.freeCancellationEndsAt",
      "hotels[0].offers[0].confirmation.mode",
    ],
  },
  order: { answer: order, paths: ["orderId", "reference", "status", "price.total", "payment.url", "payment.expiresAt"] },
  "get-order": { answer: order, paths: ["orderId", "status", "payment.status", "payment.url"] },
  "pay-token": { answer: paidByToken, paths: ["orderId", "status", "payment.status", "payment.url"] },
  "list-orders": { answer: RESPONSES.list_orders, paths: ["data[].orderId", "data[].reference", "data[].status", "nextCursor"] },
  cancel: { answer: cancelling, paths: ["orderId", "status", "cancel"] },
};

/** An example's answer, abridged (`ABRIDGED`). */
export function abridgedAnswer(name: string): unknown {
  const entry = ABRIDGED[name];
  if (!entry) throw new Error(`no answer for the example ${name}`);
  return abridge(entry.answer, entry.paths);
}
