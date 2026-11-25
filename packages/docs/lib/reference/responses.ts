import offerChanged from "./fixtures/error-offer-changed.json" with { type: "json" };
import authConfig from "./fixtures/auth-config.json" with { type: "json" };
import hotel from "./fixtures/get-hotel.json" with { type: "json" };
import offers from "./fixtures/get-hotel-offers.json" with { type: "json" };
import me from "./fixtures/me.json" with { type: "json" };
import order from "./fixtures/order-awaiting-payment.json" with { type: "json" };
import cancelling from "./fixtures/order-cancelling.json" with { type: "json" };
import paidByToken from "./fixtures/order-paid-by-token.json" with { type: "json" };
import priceMatchChecking from "./fixtures/price-match-checking.json" with { type: "json" };
import priceMatchMatched from "./fixtures/price-match-matched.json" with { type: "json" };
import priceMatchNotLower from "./fixtures/price-match-declined-not-lower.json" with { type: "json" };
import priceMatchNotOffered from "./fixtures/price-match-declined-not-offered.json" with { type: "json" };
import priceMatchPartial from "./fixtures/price-match-partial.json" with { type: "json" };
import priceMatchUnreadable from "./fixtures/price-match-declined-unreadable.json" with { type: "json" };
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
  claimId: priceMatchChecking.claimId,
} as const;

/** The answer of each operation (by its OpenAPI id) to its example request. */
export const RESPONSES = {
  search_hotels: search,
  get_hotel: hotel,
  get_hotel_offers: offers,
  request_price_match: priceMatchChecking,
  get_price_match: priceMatchMatched,
  create_order: order,
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

/** The price match answers by state, as both of its operations give them: the
 *  first is what a request answers, and each of the rest is a state a read
 *  answers once the check is over. */
export const PRICE_MATCH_RESPONSES = {
  checking: priceMatchChecking,
  matched: priceMatchMatched,
  partial: priceMatchPartial,
  "declined-not-lower": priceMatchNotLower,
  "declined-not-offered": priceMatchNotOffered,
  "declined-site-unreadable": priceMatchUnreadable,
} as const;

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
  if (id === "create_order") return "offer_changed";
  return id === "auth_config" ? "service_unavailable" : "unauthenticated";
}
