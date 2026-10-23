import { z } from "zod";

import { hotelId, orderId } from "../conventions/ids.ts";
import { money } from "../conventions/money.ts";
import { openEnum, openObject, openUnion } from "../conventions/open.ts";
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
  }),
  manageUrl: z.string(),
});

export type Order = z.infer<typeof order>;

/** `GET /v1/orders`: newest first. */
export const orderList = openObject({
  data: z.array(order),
  nextCursor: z.string().nullable(),
});

export type OrderList = z.infer<typeof orderList>;

/** One difference between an offer and the supplier's verify (§10.3). */
export const offerChange = openUnion(
  "field",
  (
    [
      ["price", money],
      ["meals", meals],
      ["cancellation", cancellation],
      ["confirmation", confirmation],
      ["pay_at_property", payAtProperty],
    ] as const
  ).map(([field, value]) =>
    openObject({
      field: z.literal(field),
      previous: value,
      current: value,
      worse: z.boolean(),
    }),
  ),
);

export type OfferChange = z.infer<typeof offerChange>;
