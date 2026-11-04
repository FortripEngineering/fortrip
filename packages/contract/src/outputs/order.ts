import { z } from "zod";

import { hotelId, orderId } from "../conventions/ids.ts";
import { money } from "../conventions/money.ts";
import { openEnum, openObject, openUnion, protocolObject } from "../conventions/open.ts";
import { instant, localDate } from "../conventions/time.ts";
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

/** Why an order can or can't be cancelled now (3.3): `cancellable` when it
 *  can, else the first reason that holds. `non_refundable` is a rate the
 *  hotel takes no cancellation for; `refused`, a cancellation the hotel
 *  refused, the booking standing as it was. */
export const CANCEL_REASONS = [
  "cancellable",
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

/** Why a shared payment token can't pay an order (3.4). */
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

/** A way to pay an order other than its link, after the Universal Commerce
 *  Protocol's payment handlers, its fields named as UCP and Stripe name
 *  them (snake case): `type` names it (`com.stripe.payments`, which takes a
 *  Stripe shared payment token), `version` and `spec` the handler
 *  specification it follows, and, from 3.5, `schema` that specification's
 *  JSON Schema, `config` its settings, whose `business_profile` is the
 *  seller's id a wallet grants a payment credential for (Stripe's business
 *  profile), and `available_instruments` the instruments it takes.
 *  `networkId` is deprecated (3.5): the same as `config.business_profile`,
 *  null when the handler names none. */
export const paymentHandler = openObject({
  id: z.string(),
  type: z.string(),
  version: z.string(),
  spec: z.string(),
  schema: z.string().optional(),
  available_instruments: z
    .array(openObject({ type: z.string(), config: protocolObject().optional() }))
    .optional(),
  config: protocolObject().optional(),
  networkId: z.string().nullable(),
});

export type PaymentHandler = z.infer<typeof paymentHandler>;

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
    cancellation,
    payAtProperty,
    confirmationNumber: z.string().nullable(),
  }),
});

export const order = openObject({
  orderId,
  reference: orderReference,
  status: openEnum(ORDER_STATUSES),
  createdAt: instant,
  updatedAt: instant,
  items: z.array(openUnion("type", [hotelItem])).min(1),
  price: openObject({ total: money }),
  payment: openObject({
    status: openEnum(PAYMENT_STATUSES),
    url: z.string().nullable(),
    requiresSignIn: z.boolean(),
    expiresAt: instant.nullable(),
    chargeCurrency: z.string(),
    localCurrencyAtCheckout: z.boolean(),
    localCharge: money.nullable(),
    /** The ways to pay other than `url`, while the order can be paid that
     *  way (3.4): a `com.stripe.payments` handler takes a shared payment
     *  token through `pay_order`. Absent when there is none. */
    handlers: z.array(paymentHandler).optional(),
    /** What a payment credential for `pay_order` must allow, present with
     *  `handlers` (3.4): `maxAmount` in minor units (cents) of `currency`,
     *  lowercase as Stripe takes it, and `expiresAt`, past which the order
     *  can't be paid. */
    credentialLimits: openObject({
      maxAmount: z.number().int(),
      currency: z.string(),
      expiresAt: instant,
    }).optional(),
  }),
  /** Whether the user can cancel the order now and, when they can, its
   *  penalty under the accepted terms (read a minute ahead) and the refund,
   *  what was paid less the penalty, both in the charge currency. Absent
   *  from servers before 3.3. */
  cancel: openObject({
    available: z.boolean(),
    reason: openEnum(CANCEL_REASONS),
    penalty: money.nullable(),
    refund: money.nullable(),
  }).optional(),
  manageUrl: z.string(),
});

export type Order = z.infer<typeof order>;

/** `GET /v1/orders`: newest first. */
export const orderList = openObject({
  data: z.array(order),
  nextCursor: z.string().nullable(),
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
