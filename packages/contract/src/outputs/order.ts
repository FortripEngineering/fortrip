import { z } from "zod";

import { hotelId, orderId } from "../conventions/ids.ts";
import { money } from "../conventions/money.ts";
import { openEnum, openObject, openUnion, protocolObject } from "../conventions/open.ts";
import { instant, localDate } from "../conventions/time.ts";
import { LIMITS } from "../limits.ts";
import { names, stayEcho } from "./common.ts";
import { roomType } from "./hotel.ts";
import { cancellation, confirmation, meals, payAtProperty } from "./offer.ts";

/* Orders (spec §10.2, §10.3). */

export const ORDER_STATUSES = [
  "awaiting_payment",
  "expired",
  "confirming",
  "confirmed",
  "failed",
  "cancelling",
  "cancelled",
  "needs_attention",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "unpaid",
  "authorized",
  "paid",
  "released",
  "refund_pending",
  "refunded",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** What `cancel_order` can do to an order now: `cancel` a paid one under
 *  its terms (with `maximumPenalty`), or `close` an unpaid one (with
 *  `close: true`). */
export const CANCEL_ACTIONS = ["cancel", "close"] as const;

export type CancelAction = (typeof CANCEL_ACTIONS)[number];

/** What keeps an order from being cancelled or closed now, one situation
 *  each. `payment_in_progress`: unpaid, with a payment under way.
 *  `website_checkout`: unpaid, on the Fortrip website's own checkout.
 *  `expired`: unpaid, its time to pay ran out. `closed`: unpaid, closed at
 *  the caller's request. `failed`: no stay was booked. `confirming`: paid or
 *  held, the booking still with the hotel. `cancelling`: a cancellation is
 *  under way. `non_refundable`: the hotel takes no cancellation for the
 *  order at all, even one that keeps the whole total (a rate that only
 *  keeps the whole total can still be cancelled: action `cancel`).
 *  `refused`: the hotel refused a cancellation, the booking standing as it
 *  was. `support_only`: a sound booking that `cancel_order` can't cancel;
 *  Fortrip's support can. `needs_attention`: the order's status is
 *  `needs_attention`. */
export const CANCEL_BLOCKERS = [
  "payment_in_progress",
  "website_checkout",
  "expired",
  "closed",
  "failed",
  "confirming",
  "cancelling",
  "already_cancelled",
  "stay_started",
  "non_refundable",
  "refused",
  "terms_unknown",
  "support_only",
  "needs_attention",
] as const;

export type CancelBlocker = (typeof CANCEL_BLOCKERS)[number];

/** Why a failed order booked no stay. `rate_unavailable`: the rate could no
 *  longer be booked when the hotel was asked. `hotel_refused`: the hotel's
 *  booking system refused this order, as it would the same order again. */
export const FAILURE_REASONS = ["rate_unavailable", "hotel_refused", "unknown"] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

/** Why a shared payment token can't pay an order. */
export const CREDENTIAL_INVALID_REASONS = [
  "not_found",
  "currency",
  "amount",
  "expired",
  "deactivated",
  "used",
  "other_seller",
] as const;

export type CredentialInvalidReason = (typeof CREDENTIAL_INVALID_REASONS)[number];

/** Why `pay_order` takes no token for an order, whatever the token.
 *  `payment_open_on_page`: the user has a payment open on the order's
 *  payment page. `token_not_offered`: the order's `payment.token` is null.
 *  `charge_refused`: the charge was refused for a reason a new token
 *  wouldn't fix. */
export const PAYMENT_METHOD_UNAVAILABLE_REASONS = [
  "payment_open_on_page",
  "token_not_offered",
  "charge_refused",
] as const;

export type PaymentMethodUnavailableReason = (typeof PAYMENT_METHOD_UNAVAILABLE_REASONS)[number];

/** The handler a shared payment token is requested for: one of the
 *  Universal Commerce Protocol's payment handlers, its fields named as UCP
 *  and Stripe name them (snake case). `type` names it
 *  (`com.stripe.payments`, which takes a Stripe shared payment token);
 *  `version`, `spec` and `schema` the handler specification it follows;
 *  `available_instruments` the instruments it takes; `config` its settings,
 *  whose `business_profile` is the seller's id the token is granted for
 *  (Stripe's business profile). */
export const paymentHandler = openObject({
  id: z.string(),
  type: z.string(),
  version: z.string(),
  spec: z.string(),
  schema: z.string(),
  available_instruments: z.array(
    openObject({ type: z.string(), config: protocolObject().optional() }),
  ),
  config: openObject({
    environment: openEnum(["livemode", "testmode"]),
    business_profile: z.string(),
  }),
});

export type PaymentHandler = z.infer<typeof paymentHandler>;

/** The Unix seconds an instant of ours can be: ten digits, 2001 to 2286. The
 *  same instant in milliseconds is past the range. */
const UNIX_SECONDS = { min: 1_000_000_000, max: 9_999_999_999 } as const;

/** What a shared payment token for an order must allow: Stripe's usage
 *  limits, named and valued as Stripe takes them (snake case), like
 *  `paymentHandler`. */
export const tokenUsageLimits = openObject({
  max_amount: z
    .number()
    .int()
    .describe(
      "The order's total in the currency's minor unit (cents for usd); a token that allows less can't pay.",
    ),
  currency: z.string().describe("The token's currency, lowercase as Stripe takes it: usd."),
  expires_at: z
    .number()
    .int()
    .min(UNIX_SECONDS.min)
    .max(UNIX_SECONDS.max)
    .describe("When the order's time to pay ends, in Unix seconds; the order can't be paid after it."),
});

export type TokenUsageLimits = z.infer<typeof tokenUsageLimits>;

/** `order.cancel`, and what `order_not_cancellable` carries: what
 *  `cancel_order` can do to the order now. For the actions this build knows:
 *  `cancel` comes with `penalty` and `refund`, `close` with neither, and no
 *  action (null) with `blockedBy`. An action it does not know is not held to
 *  any of that, so a later one still reads. */
export const orderCancel = openObject({
  action: openEnum(CANCEL_ACTIONS)
    .nullable()
    .describe(
      "cancel: a paid order that can be cancelled now under its terms, keeping penalty and returning refund; cancel_order takes maximumPenalty. close: an unpaid order that can be closed, with nothing charged; cancel_order takes close: true. null: neither applies, and blockedBy says why.",
    ),
  blockedBy: openEnum(CANCEL_BLOCKERS)
    .nullable()
    .describe(
      "Why the order can be neither cancelled nor closed now; null when action is set. payment_in_progress: unpaid, a payment is under way. website_checkout: unpaid, on the Fortrip website's own checkout, where it expires unpaid. expired: unpaid, its time to pay ran out. closed: unpaid, closed at the caller's request. failed: no stay was booked. confirming: the booking is still with the hotel. cancelling: a cancellation is under way. already_cancelled. stay_started. non_refundable: the hotel takes no cancellation for this order at all, even one that keeps the whole total; a rate that only keeps the whole total has action cancel instead. refused: the hotel refused a cancellation and the booking stands. terms_unknown: the cancellation terms are not on record. support_only: the booking stands and cancel_order can't cancel it; Fortrip's support can. needs_attention: the order's status is needs_attention, and a person at Fortrip has to resolve it.",
    ),
  penalty: money
    .nullable()
    .describe(
      "What a cancellation now keeps, under the accepted terms, in the total's currency; past the free deadline it can be the whole total. null unless action is cancel.",
    ),
  refund: money
    .nullable()
    .describe(
      "What a cancellation now returns: what was paid less the penalty, in the total's currency; 0 when the penalty is the whole total. null unless action is cancel.",
    ),
})
  .refine(
    (c) => {
      const figures = c.penalty !== null || c.refund !== null;
      if (c.action === "cancel") return c.blockedBy === null && c.penalty !== null && c.refund !== null;
      if (c.action === "close") return c.blockedBy === null && !figures;
      if (c.action === null) return c.blockedBy !== null && !figures;
      return true;
    },
    {
      error:
        "cancel comes with penalty and refund, close with neither, and both without blockedBy; a null action comes with blockedBy alone",
    },
  )
  .describe("What cancel_order can do to the order now: cancel it for a penalty and a refund, close it, or neither.");

export type OrderCancel = z.infer<typeof orderCancel>;

/** `FT-` and six characters with no 0, 1, I or O. */
export const orderReference = z.string().regex(/^FT-[2-9A-HJ-NP-Z]{6}$/);

/** A room of the order: its party, the guests named for it, and the room
 *  type and meals booked for it. */
const orderRoom = stayEcho.shape.rooms.element.extend({
  guests: z
    .array(openObject({ firstName: z.string(), lastName: z.string() }))
    .nullable()
    .describe(
      "The guests the order names for this room, as given when ordering. null when none are on record yet: an order started on the Fortrip website names them at checkout.",
    ),
  roomType: roomType.describe(
    "The room type booked for this room, as its offer gave it; a fact not on record is null.",
  ),
  meals,
});

const hotelItem = openObject({
  type: z.literal("hotel"),
  hotel: openObject({
    hotelId: hotelId.nullable(),
    name: z.string(),
    names,
    checkIn: localDate,
    checkOut: localDate,
    timeZone: z.string().nullable(),
    rooms: z.array(orderRoom).min(1),
    specialRequests: z
      .string()
      .nullable()
      .describe("The requests for the hotel, as given when ordering; null when none were given. Not guaranteed."),
    cancellation: cancellation.describe(
      "The cancellation terms the order was made on, read at readAt; cancel says what can be done now.",
    ),
    confirmation: confirmation
      .nullable()
      .describe("How the hotel confirms the booking, as the order's offer gave it; null when not on record."),
    payAtProperty,
    confirmationNumber: z.string().nullable(),
  }),
});

/** What to request a shared payment token with, for `pay_order`. */
export const paymentToken = openObject({
  handler: paymentHandler.describe("The com.stripe.payments handler, which takes the token."),
  usageLimits: tokenUsageLimits.describe(
    "Stripe's usage limits for the token: copy these values as they are into the token request.",
  ),
});

/** What a cancellation kept and returned. */
export const orderCancelled = openObject({
  at: instant.describe("When the order was cancelled."),
  penalty: money.describe("What the cancellation kept, in the total's currency."),
  refund: money.describe("What the cancellation returned; payment.status says whether it has been."),
});

/** Why a failed order booked no stay. */
export const orderFailure = openObject({
  reason: openEnum(FAILURE_REASONS).describe(
    "rate_unavailable: the rate could no longer be booked when the hotel was asked; read offers again. hotel_refused: the hotel's booking system refused this order; ordering the same again will be refused too. unknown: not on record.",
  ),
});

export const order = openObject({
  orderId,
  reference: orderReference,
  status: openEnum(ORDER_STATUSES).describe(
    "awaiting_payment: not paid yet (a payment just made may still be settling); payable until payment.expiresAt. expired: not paid, and nothing charged; the time to pay ran out or the order was closed, and cancel.blockedBy says which. confirming: paid or held, the booking is with the hotel. confirmed: the hotel confirmed and the payment is charged. failed: no stay was booked; failure says why and payment.status what became of the money. cancelling, then cancelled: a cancellation under the terms; cancelled says what it kept and returned. needs_attention: a person at Fortrip has to resolve it.",
  ),
  createdAt: instant,
  updatedAt: instant,
  contact: openObject({
    name: z.string().describe("The contact's full name, as given when ordering."),
    email: z
      .string()
      .nullable()
      .describe("Where the confirmation is sent; null when none is on record."),
    phone: z.string().nullable().describe("The contact's phone number; null when none is on record."),
  })
    .nullable()
    .describe(
      "Who the hotel and the confirmation reach, as given when ordering. null when none is on record yet: an order started on the Fortrip website gives it at checkout.",
    ),
  items: z.array(openUnion("type", [hotelItem])).min(1),
  total: money.describe(
    "The whole stay for all rooms: what paying charges, or once paid what was charged. In USD or CNY, the currency of the offer the order was made from; an order made on the Fortrip website may be in another currency. Fees payable at the property are not in it.",
  ),
  payment: openObject({
    status: openEnum(PAYMENT_STATUSES),
    url: z
      .string()
      .nullable()
      .describe(
        "The payment page, on fortrip.ai; it continues to the payment provider. With requiresSignIn false anyone holding it can pay; with requiresSignIn true (an order started on the Fortrip website) it continues to the Fortrip booking page, where only the signed-in owner can pay. null while a payment is held (authorized) or when the order isn't awaiting payment, or, while it is and its payment is unpaid, while a payment is being processed: read the order again shortly, and don't give an earlier link.",
      ),
    requiresSignIn: z.boolean(),
    expiresAt: instant
      .nullable()
      .describe(
        "When the time to pay ends: an order unpaid by then expires, with nothing charged. null unless status is awaiting_payment.",
      ),
    localCurrencyAtCheckout: z
      .boolean()
      .describe(
        "Whether paying by url may charge the card in its own currency, converted by Stripe; false once paid by token, or by Alipay or WeChat Pay on the payment page; always false on a CNY order.",
      ),
    localCharge: money
      .nullable()
      .describe(
        "What the card was charged in its own currency, when Stripe converted the total; otherwise null. Always null on a CNY order.",
      ),
    token: paymentToken
      .nullable()
      .describe(
        `What to request a Stripe shared payment token with, for pay_order. null when no token can pay this order: a CNY order, an order from the Fortrip website's own checkout, a total over $${LIMITS.tokenPaymentMaxUsd}, or when none can be taken now (too little time left to pay, the order's limit of tokens reached, or a payment open on its payment page); then the user pays by url.`,
      ),
  }),
  cancel: orderCancel,
  cancelled: orderCancelled
    .nullable()
    .describe(
      "What a cancellation kept and returned. null unless status is cancelled, and on a cancelled order whose figures are not on record.",
    ),
  failure: orderFailure
    .nullable()
    .describe(
      "Why no stay was booked: always set on a failed order, its reason unknown when not on record. null unless status is failed.",
    ),
  manageUrl: z.string(),
}).refine((o) => o.status !== "failed" || o.failure !== null, {
  error: "a failed order says why: failure is set, with the reason unknown when it is not on record",
});

export type Order = z.infer<typeof order>;

/** `GET /v1/orders`: newest first. */
export const orderList = openObject({
  data: z.array(order),
  nextCursor: z
    .string()
    .nullable()
    .describe("Pass it back as cursor for the next page; null on the last page."),
});

export type OrderList = z.infer<typeof orderList>;

function change<F extends string, V extends z.ZodType>(field: F, value: V) {
  return openObject({
    field: z.literal(field),
    previous: value,
    current: value,
    worse: z.boolean(),
  });
}

/** One difference between an offer and the supplier's verify (§10.3);
 *  `field` is the offer's key that changed. */
export const offerChange = openUnion("field", [
  change("total", money),
  change("meals", meals),
  change("cancellation", cancellation),
  change("confirmation", confirmation),
  change("payAtProperty", payAtProperty),
]);

export type OfferChange = z.infer<typeof offerChange>;
