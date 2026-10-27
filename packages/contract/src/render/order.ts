import { SUPPORT_EMAIL } from "../limits.ts";
import type { Order, OrderList } from "../outputs/order.ts";
import { label, money, named, party, raw, stayLine, when } from "./format.ts";
import { cancellationText, feesText, mealsWithLabel } from "./offers.ts";

/* `book_hotel`, `get_order` and `list_orders` (spec §10.2). */

type Item = Order["items"][number];
type HotelItem = Extract<Item, { type: "hotel" }>;

export const ORDER_STATUS_WORDS: Record<string, string> = {
  awaiting_payment: "awaiting payment",
  expired: "expired (not paid in time)",
  confirming: "confirming with the hotel",
  confirmed: "confirmed",
  failed: "failed",
  cancelling: "cancelling",
  cancelled: "cancelled",
  needs_attention: "needs attention from Fortrip",
};

const PAYMENT_WORDS: Record<string, string> = {
  unpaid: "unpaid",
  authorized: "authorized (held, not yet charged)",
  paid: "paid",
  released: "released (the hold was let go)",
  refund_pending: "refund pending",
  refunded: "refunded",
};

const SUPPORT = `for help, the user emails ${SUPPORT_EMAIL} with the order's reference`;

/** Why an order can't be cancelled now, in words; the error
 *  `order_not_cancellable` words its reason the same way. */
export const CANCEL_REASON_WORDS: Record<string, string> = {
  cancellable: "it can be cancelled",
  already_cancelled: "it is already cancelled",
  in_progress: "a cancellation is in progress",
  not_confirmed: "only a confirmed order that is paid can be cancelled",
  stay_started: `the stay has started; ${SUPPORT}`,
  non_refundable: "this rate can't be cancelled",
  refused: "the hotel refused the cancellation; the booking stands",
  terms_unknown: `its cancellation terms are not on record; ${SUPPORT}`,
  needs_attention: `Fortrip is looking into this order; ${SUPPORT}`,
};

function itemLines(item: Item): string[] {
  if (item.type !== "hotel") {
    return [`Item of type ${item.type}: not shown in this text. ${raw(item)}`];
  }
  const h = (item as HotelItem).hotel;
  return [
    [
      `Hotel: ${named(h.name, h.names)}`,
      h.hotelId ?? "not in the hotel catalogue",
      stayLine(h.checkIn, h.checkOut),
      party(h.rooms),
      `time zone ${h.timeZone ?? "not listed"}`,
    ].join(" · "),
    `Room: ${h.room.name ? h.room.name.text : "room name not listed"} · ${h.room.beds ? `beds: ${h.room.beds.text}` : "beds not listed"}`,
    `Terms: ${mealsWithLabel(h.meals)} · ${cancellationText(h.cancellation)} · ${feesText(h.payAtProperty)}`,
    `Hotel confirmation number: ${h.confirmationNumber ?? "none yet"}`,
  ];
}

function paymentLines(o: Order): string[] {
  const p = o.payment;
  const lines = [
    [
      `Total: ${money(o.price.total)}`,
      `payment ${label(PAYMENT_WORDS, p.status)}`,
      `charged in ${p.chargeCurrency}${p.localCurrencyAtCheckout ? " (the user's card may pay in its local currency at checkout)" : ""}`,
      p.localCharge ? `card charged ${money(p.localCharge)}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  ];
  if (p.url !== null) {
    const about = [
      p.expiresAt === null ? "" : `expires ${when(p.expiresAt, null)}`,
      p.requiresSignIn ? "the user signs in to Fortrip to pay" : "no sign-in needed",
    ].filter(Boolean);
    lines.push(`Payment link (${about.join("; ")}): ${p.url}`);
  } else if (o.status === "awaiting_payment") {
    lines.push("Payment link: could not be read this time; read this order again for it.");
  }
  if (o.cancel) lines.push(cancelLine(o.cancel));
  lines.push(`Manage: ${o.manageUrl}`);
  return lines;
}

/** "Cancel: can cancel now: penalty …, refund …", or why not. Figures are
 *  only ever the order's own. */
function cancelLine(c: NonNullable<Order["cancel"]>): string {
  const figure = (name: string, m: typeof c.penalty) =>
    `${name} ${m ? money(m) : "not stated"}`;
  const figures = `${figure("penalty", c.penalty)}, ${figure("refund", c.refund)}`;
  if (c.available) return `Cancel: can cancel now: ${figures}`;
  const why = `Cancel: not available: ${label(CANCEL_REASON_WORDS, c.reason)}`;
  return c.penalty || c.refund ? `${why} · ${figures}` : why;
}

export function orderLines(o: Order): string[] {
  return [
    `Order ${o.orderId} · reference ${o.reference} · ${label(ORDER_STATUS_WORDS, o.status)} · created ${when(o.createdAt, null)} · updated ${when(o.updatedAt, null)}`,
    ...o.items.flatMap(itemLines),
    ...paymentLines(o),
  ];
}

export function renderOrder(o: Order): string {
  return orderLines(o).join("\n");
}

export function renderOrderList(list: OrderList): string {
  const lines = [
    list.data.length === 0
      ? "No orders on this page."
      : `Orders, newest first: ${list.data.length} on this page.`,
  ];
  for (const o of list.data) lines.push("", ...orderLines(o));
  lines.push(
    "",
    list.nextCursor === null
      ? "Last page."
      : `Next page: call again with { cursor: "${list.nextCursor}" }.`,
  );
  return lines.join("\n");
}
