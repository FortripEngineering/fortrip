import { SUPPORT_EMAIL } from "../limits.ts";
import type { Order, OrderCancel, OrderList } from "../outputs/order.ts";
import { CALLS, type RenderSurface } from "../tools.ts";
import { label, money, named, party, raw, stayLine, when } from "./format.ts";
import { cancellationText, confirmationText, feesText, mealsWithLabel, roomTypeText } from "./offers.ts";
import { oneLine } from "./third-party.ts";

/* `book_hotel`, `get_order` and `list_orders` (spec §10.2). */

type Item = Order["items"][number];
type HotelItem = Extract<Item, { type: "hotel" }>;
type Room = HotelItem["hotel"]["rooms"][number];

export const ORDER_STATUS_WORDS: Record<string, string> = {
  awaiting_payment: "awaiting payment",
  expired: "not paid: the time ran out or it was closed",
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

/** What keeps an order from being cancelled or closed now, in words; the
 *  error `order_not_cancellable` words it the same way. */
export const CANCEL_BLOCKER_WORDS: Record<string, string> = {
  payment_in_progress: "a payment is under way; read the order again shortly",
  website_checkout:
    "it was started on the Fortrip website and isn't paid; it expires unpaid unless the user pays there",
  expired: "it expired unpaid, so there is nothing to cancel or close",
  failed: "no stay was booked, so there is nothing to cancel",
  confirming: "the booking is still being confirmed with the hotel; read the order again later",
  cancelling: "a cancellation is already under way; read the order again later",
  already_cancelled: "it is already cancelled",
  stay_started: `the stay has started; ${SUPPORT}`,
  non_refundable: "this rate can't be cancelled",
  refused: "the hotel refused the cancellation; the booking stands",
  terms_unknown: `its cancellation terms are not on record; ${SUPPORT}`,
  needs_attention: `Fortrip is looking into this order; ${SUPPORT}`,
};

const FAILURE_WORDS: Record<string, string> = {
  sold_out: "the room sold out before it was booked; get offers again for another room or hotel",
  hotel_refused: "the hotel refused the booking; get offers again for another room or hotel",
  details_refused:
    "the booking was refused for the names given; check the guest and contact names with the user before ordering again",
  unknown: "the reason is not on record",
};

/** "Mary Smith, Tom Smith", or "none named yet". */
function guestsText(room: Room): string {
  const names = (room.guests ?? []).map((g) => oneLine(`${g.firstName} ${g.lastName}`));
  return names.length ? names.join(", ") : "none named yet";
}

/** The rooms' type, meals and guests. Rooms booked alike share one "Room"
 *  line, their guests on the next; rooms that differ get a line each. */
function roomLines(rooms: Room[]): string[] {
  const booked = rooms.map((r) => `${roomTypeText(r.roomType)} · ${mealsWithLabel(r.meals)}`);
  if (!booked.every((b) => b === booked[0])) {
    return rooms.map((r, i) => `Room ${i + 1}: ${booked[i]} · guests: ${guestsText(r)}`);
  }
  const guests =
    rooms.length === 1 || rooms.every((r) => !r.guests?.length)
      ? guestsText(rooms[0]!)
      : rooms.map((r, i) => `room ${i + 1} ${guestsText(r)}`).join("; ");
  return [`${rooms.length === 1 ? "Room" : "Each room"}: ${booked[0]}`, `Guests: ${guests}`];
}

function itemLines(item: Item): string[] {
  if (item.type !== "hotel") {
    return [`Item of type ${item.type}: not shown in this text. ${raw(item)}`];
  }
  const h = (item as HotelItem).hotel;
  return [
    [
      `Hotel: ${oneLine(named(h.name, h.names))}`,
      h.hotelId ?? "not in the hotel catalogue",
      stayLine(h.checkIn, h.checkOut),
      party(h.rooms),
      `time zone ${h.timeZone ?? "not listed"}`,
    ].join(" · "),
    ...roomLines(h.rooms),
    `Special requests: ${h.specialRequests === null ? "none" : oneLine(h.specialRequests)}`,
    `Terms: ${cancellationText(h.cancellation)} · ${h.confirmation ? confirmationText(h.confirmation) : "confirmation mode not on record"} · ${feesText(h.payAtProperty)}`,
    `Hotel confirmation number: ${h.confirmationNumber === null ? "none yet" : oneLine(h.confirmationNumber)}`,
  ];
}

function contactLine(c: Order["contact"]): string {
  if (c === null) return "Contact: none on record yet";
  return `Contact: ${oneLine(c.name)} · ${c.email === null ? "no email on record" : oneLine(c.email)} · ${c.phone === null ? "no phone on record" : oneLine(c.phone)}`;
}

/** What became of an order that is over: why a failed one booked nothing,
 *  what a cancelled one kept and returned. */
function outcomeLines(o: Order): string[] {
  const lines: string[] = [];
  if (o.failure) lines.push(`Why it failed: ${label(FAILURE_WORDS, o.failure.reason)}`);
  else if (o.status === "failed") lines.push("Why it failed: the reason is not on record");
  if (o.cancelled) {
    lines.push(
      `Cancelled ${when(o.cancelled.at, null)}: penalty kept ${money(o.cancelled.penalty)}, refund ${money(o.cancelled.refund)}`,
    );
  } else if (o.status === "cancelled") {
    lines.push("Cancelled: the penalty kept and the refund are not on record");
  }
  return lines;
}

function paymentLines(o: Order, surface: RenderSurface): string[] {
  const p = o.payment;
  const lines = [
    [
      `Total: ${money(o.total)}`,
      `payment ${label(PAYMENT_WORDS, p.status)}`,
      p.localCurrencyAtCheckout ? "the user's card may pay in its local currency at checkout" : "",
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
  } else if (o.status === "awaiting_payment" && p.status === "unpaid") {
    lines.push("Payment link: none while a payment is being processed; read this order again shortly.");
  }
  if (p.token) lines.push(tokenLine(o, p.token, surface));
  lines.push(`Cancel: ${cancelText(o.cancel, surface)}`);
  lines.push(`Manage: ${o.manageUrl}`);
  return lines;
}

/** "Pay without the link: …": the handler by type with the business
 *  profile the token is granted for, and Stripe's usage limits for the
 *  token under Stripe's own names, as they go into the token request. */
function tokenLine(
  o: Order,
  token: NonNullable<Order["payment"]["token"]>,
  surface: RenderSurface,
): string {
  const { handler: h, usageLimits: u } = token;
  const pay =
    surface === "cli"
      ? `\`fortrip orders pay ${o.orderId} --token <spt_…> --total ${o.total.amount}\``
      : "pay_order";
  const expires = new Date(u.expires_at * 1000);
  const at = Number.isNaN(expires.getTime()) ? "" : ` (${when(expires.toISOString(), null)})`;
  return `Pay without the link: ${pay} with a shared payment token via ${h.type} (handler ${h.id}, business_profile ${h.config.business_profile}); usage limits for the token request: max_amount ${u.max_amount}, currency ${u.currency}, expires_at ${u.expires_at}${at}.`;
}

/** "penalty USD 120.00, refund USD 246.00": what cancelling now keeps and
 *  returns. Figures are only ever the order's own. */
export function cancelFigures(c: OrderCancel): string {
  const figure = (name: string, m: OrderCancel["penalty"]) => `${name} ${m ? money(m) : "not stated"}`;
  return `${figure("penalty", c.penalty)}, ${figure("refund", c.refund)}`;
}

/** What `cancel_order` can do to the order now: cancel it, with the penalty
 *  and the refund; close it, on the user's word; or what blocks both. */
function cancelText(c: OrderCancel, surface: RenderSurface): string {
  if (c.action === "close") {
    return `can be closed now, nothing is charged; close it only if the user says they no longer want it (${CALLS[surface].close})`;
  }
  if (c.action === "cancel") return `can cancel now: ${cancelFigures(c)}`;
  if (c.action !== null) return c.action;
  return `not available: ${c.blockedBy === null ? "not stated" : label(CANCEL_BLOCKER_WORDS, c.blockedBy)}`;
}

export function orderLines(o: Order, surface: RenderSurface = "mcp"): string[] {
  return [
    `Order ${o.orderId} · reference ${o.reference} · ${label(ORDER_STATUS_WORDS, o.status)} · created ${when(o.createdAt, null)} · updated ${when(o.updatedAt, null)}`,
    ...outcomeLines(o),
    ...o.items.flatMap(itemLines),
    contactLine(o.contact),
    ...paymentLines(o, surface),
  ];
}

export function renderOrder(o: Order, surface: RenderSurface = "mcp"): string {
  return orderLines(o, surface).join("\n");
}

export function renderOrderList(list: OrderList, surface: RenderSurface = "mcp"): string {
  const lines = [
    list.data.length === 0
      ? "No orders on this page."
      : `Orders, newest first: ${list.data.length} on this page.`,
  ];
  for (const o of list.data) lines.push("", ...orderLines(o, surface));
  lines.push(
    "",
    list.nextCursor === null
      ? "Last page."
      : surface === "cli"
        ? `Next page: run again with --cursor ${list.nextCursor}.`
        : `Next page: call again with { cursor: "${list.nextCursor}" }.`,
  );
  return lines.join("\n");
}
