import { z } from "zod";

import { hotelId, orderId } from "../conventions/ids.ts";
import { money } from "../conventions/money.ts";
import { openEnum, openObject, openUnion, protocolObject } from "../conventions/open.ts";
import { instant, localDate } from "../conventions/time.ts";
import { LIMITS } from "../limits.ts";
import { localizedText, names, stayEcho } from "./common.ts";
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

/** Why an order can or can't be cancelled now: `cancellable` when a paid
 *  order can, `unpaid` when an unpaid one can be closed instead, else the
 *  first reason that holds. `non_refundable` is a rate the hotel takes no
 *  cancellation for; `refused`, a cancellation the hotel refused, the
 *  booking standing as it was. */
export const CANCEL_REASONS = [
  "cancellable",
  "unpaid",
  "already_cancelled",
  "in_progress",
  "not_confirmed",
  "stay_started",
  "non_refundable",
  "refused",
  "terms_unknown",
  "needs_attention",
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

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

/** A way to pay an order other than its link: one of the Universal
 *  Commerce Protocol's payment handlers, its fields named as UCP and Stripe
 *  name them (snake case). `type` names it (`com.stripe.payments`, which
 *  takes a Stripe shared payment token); `version`, `spec` and `schema` the
 *  handler specification it follows; `available_instruments` the
 *  instruments it takes; `config` its settings, whose `business_profile`
 *  is the seller's id a wallet grants the token for (Stripe's business
 *  profile). */
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

/** The ids of `payment.methods`: the ways `pay_order` can pay an order. */
export const PAYMENT_METHOD_IDS = ["stripe_shared_payment_token", "stripe_alipay_wechat_pay"] as const;

export type PaymentMethodId = (typeof PAYMENT_METHOD_IDS)[number];

/** A way `pay_order` can pay an order other than its link, by `id`: an
 *  open union, so a later method is an entry with a new id. */
export const paymentMethod = openUnion("id", [
  openObject({
    id: z.literal("stripe_shared_payment_token"),
    handler: paymentHandler.describe("The com.stripe.payments handler, which takes the token."),
    limits: openObject({
      maxAmount: z
        .number()
        .int()
        .describe("Request the token for at least this amount, in cents; a token that allows less can't pay."),
      currency: z.string().describe("The token's currency, lowercase as Stripe takes it: usd."),
      expiresAt: instant.describe(
        "Request the token valid until at least this time; the order can't be paid after it.",
      ),
    }).describe("What the shared payment token for pay_order must allow."),
  }).describe(
    `A Stripe shared payment token, through pay_order's sharedPaymentToken or payment. The entry is absent when a token can't pay this order (for example over $${LIMITS.tokenPaymentMaxUsd}, not charged in USD, or started on the Fortrip website); then give payment.url or use another entry.`,
  ),
  openObject({
    id: z.literal("stripe_alipay_wechat_pay"),
    open: z.boolean().describe("Whether pay_order has opened an Alipay or WeChat Pay payment on this order."),
    current: openEnum(["wechat_pay", "alipay"])
      .nullable()
      .describe("Which of the two the payment is on now; null until it is open."),
    wechatPay: openObject({
      qrData: z
        .string()
        .nullable()
        .describe(
          "The WeChat Pay code's content, to draw as a QR code; null when there is no live code (open wechatPay.url for one).",
        ),
      qrImageUrl: z.string().nullable().describe("A 480 px PNG of the same code."),
      url: z
        .string()
        .describe("A link, on fortrip.ai, for the user to pay with WeChat Pay; anyone holding it can pay."),
    })
      .nullable()
      .describe("The WeChat Pay code and link; null until the payment is open."),
    alipay: openObject({
      url: z
        .string()
        .describe("A link, on fortrip.ai, for the user to pay with Alipay; anyone holding it can pay."),
    })
      .nullable()
      .describe("The Alipay link; null until the payment is open."),
  }).describe(
    "Paying with Alipay or WeChat Pay: pass method stripe_alipay_wechat_pay to pay_order to open it. The entry is absent when the order can't be paid this way and none is open, as on a CNY order.",
  ),
]);

export type PaymentMethod = z.infer<typeof paymentMethod>;

/** `FT-` and six characters with no 0, 1, I or O. */
export const orderReference = z.string().regex(/^FT-[2-9A-HJ-NP-Z]{6}$/);

const hotelItem = openObject({
  type: z.literal("hotel"),
  hotel: openObject({
    hotelId: hotelId.nullable(),
    name: z.string(),
    names,
    checkIn: localDate,
    checkOut: localDate,
    timeZone: z.string().nullable(),
    rooms: stayEcho.shape.rooms,
    room: openObject({
      name: localizedText.nullable(),
      beds: localizedText.nullable(),
    }),
    meals,
    cancellation: cancellation.describe(
      "The terms the order was made on, read at asOf; cancel says whether it can be cancelled now.",
    ),
    payAtProperty,
    confirmationNumber: z.string().nullable(),
  }),
});

export const order = openObject({
  orderId,
  reference: orderReference,
  status: openEnum(ORDER_STATUSES).describe(
    "awaiting_payment: not paid yet (a payment just made may still be settling); payable until payment.expiresAt. expired: not paid; the time ran out or the order was closed. Nothing charged. confirming: paid or held, the booking is with the hotel. confirmed: the hotel confirmed and the payment is charged. failed: no stay was booked; payment.status says what became of the money. cancelling, then cancelled: a cancellation under the terms. needs_attention: a person at Fortrip has to resolve it.",
  ),
  createdAt: instant,
  updatedAt: instant,
  items: z.array(openUnion("type", [hotelItem])).min(1),
  price: openObject({
    total: money.describe(
      "The whole stay for all rooms, in payment.chargeCurrency: what paying charges, or once paid what was charged. Fees payable at the property are not in it.",
    ),
  }),
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
    chargeCurrency: z
      .string()
      .describe(
        "USD or CNY: the currency of the offer the order was made from. An order made on the Fortrip website may be in another currency.",
      ),
    localCurrencyAtCheckout: z
      .boolean()
      .describe(
        "Whether paying by url may charge the card in its own currency, converted by Stripe; false once paid by token, or by Alipay or WeChat Pay through pay_order or the Fortrip page; always false on a CNY order.",
      ),
    localCharge: money
      .nullable()
      .describe(
        "What the card was charged in its own currency, when Stripe converted the total; otherwise null. Always null on a CNY order.",
      ),
    methods: z
      .array(paymentMethod)
      .describe(
        "What pay_order accepts for this order now, by id. [] means: give the user payment.url, when it isn't null.",
      ),
  }),
  cancel: openObject({
    available: z
      .boolean()
      .describe("Whether the user can cancel the order now, or, unpaid (reason unpaid), close it."),
    reason: openEnum(CANCEL_REASONS).describe(
      "cancellable: a paid order can be cancelled now; unpaid: an unpaid order can be closed; otherwise why not.",
    ),
    penalty: money
      .nullable()
      .describe(
        "The penalty if cancelled now, under the accepted terms, in the charge currency; null when not stated, except on an unpaid order (reason unpaid), where null means closing it charges nothing.",
      ),
    refund: money
      .nullable()
      .describe(
        "What a cancellation now refunds: what was paid less the penalty, in the charge currency; null when not stated.",
      ),
  }).describe("Whether the order can be cancelled now, and for what penalty and refund."),
  manageUrl: z.string(),
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

/** One difference between an offer and the supplier's verify (§10.3). */
export const offerChange = openUnion("field", [
  change("price", money),
  change("meals", meals),
  change("cancellation", cancellation),
  change("confirmation", confirmation),
  change("pay_at_property", payAtProperty),
]);

export type OfferChange = z.infer<typeof offerChange>;
