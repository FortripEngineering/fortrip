import { SUPPORT_EMAIL } from "../limits.ts";
import {
  type Order,
  type OrderCancel,
  orderCancelled,
  orderFailure,
  paymentTokenRequest,
  tokenUsageLimits,
} from "../outputs/order.ts";
import type { RenderSurface } from "../tools.ts";
import { label, money, named, party, raw, stayLine, when } from "./format.ts";
import { cancellationText, confirmationText, feesText, mealsWithLabel, roomTypeText } from "./offers.ts";
import { code, joined, type Ours, ours, theirs, token } from "./third-party.ts";

/*
 * An order, as `create_order`, `get_order`, `list_orders`, `cancel_order`
 * and `pay_order` answer it. Every line begins with Fortrip's words. What
 * someone else wrote (the names of the hotel, the room and the guests, the
 * contact, special requests, the hotel's confirmation number) is in quotes;
 * what Fortrip generates (ids, links, amounts, dates) is bare. The labels
 * that begin its lines ("Total", "Payment link", "Pay without the link",
 * "Cancel") are what the rules after it, the tool descriptions and the
 * guide name.
 */

type Item = Order["items"][number];
type HotelItem = Extract<Item, { type: "hotel" }>;
type Room = HotelItem["hotel"]["rooms"][number];

export const ORDER_STATUS_WORDS: Record<string, string> = {
  awaiting_payment: "awaiting payment",
  expired: "not paid: the time to pay ran out",
  closed: "closed unpaid, as asked",
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

/** What keeps an order from being cancelled or closed now, in words;
 *  `blockerText` says it, for an order and for `order_not_cancellable`. */
const CANCEL_BLOCKER_WORDS: Record<string, string> = {
  payment_in_progress: "a payment is under way; read the order again shortly",
  website_checkout:
    "it was started on the Fortrip website and isn't paid; it expires unpaid unless the user pays there",
  expired: "its time to pay ran out, so there is nothing to cancel or close",
  closed: "it was closed unpaid, as asked, so there is nothing to cancel or close",
  failed: "no stay was booked, so there is nothing to cancel",
  confirming: "the booking is still being confirmed with the hotel; read the order again later",
  cancelling: "a cancellation is already under way; read the order again later",
  already_cancelled: "it is already cancelled",
  stay_started: `the stay has started; ${SUPPORT}`,
  cancellation_not_allowed:
    "the hotel takes no cancellation for this order, even one that keeps the whole total; the booking stands",
  cancellation_refused: "the hotel refused the cancellation; the booking stands",
  terms_unknown: `its cancellation terms are not on record; ${SUPPORT}`,
  support_only: `the booking stands, and it can't be cancelled here; to cancel it, the user emails ${SUPPORT_EMAIL} with the order's reference`,
  needs_attention: `Fortrip is looking into this order; ${SUPPORT}`,
};

/** Why a failed order booked nothing, and what to do next. */
const FAILURE_WORDS: Record<string, string> = {
  rate_unavailable:
    "the rate could no longer be booked when the hotel was asked; get offers again and let the user choose again",
  // A cause is offered, never asserted, and a real name is never to be
  // altered to get past the hotel's system: that is for support.
  hotel_refused: `the hotel's booking system refused this order, and would refuse the same order again. Some guest names are not accepted by it, which may be the cause; if the names are as on the passport, don't change them: ${SUPPORT}`,
  unknown: `the reason is not on record; read the order again later, or ${SUPPORT}`,
};

/** Each guest's name in quotes ("Mary Smith", "Tom Smith"), or: none named yet. */
function guestsText(room: Room): Ours {
  const names = (room.guests ?? []).map((g) => theirs(`${g.firstName} ${g.lastName}`));
  return names.length ? joined(names, ", ") : ours`none named yet`;
}

/** The rooms' type, meals and guests. Rooms booked alike share one "Room"
 *  line, their guests on the next; rooms that differ get a line each. */
function roomLines(rooms: Room[]): Ours[] {
  const booked = rooms.map((r) => ours`${roomTypeText(r.roomType)} · ${mealsWithLabel(r.meals)}`);
  if (!booked.every((b) => b === booked[0])) {
    return rooms.map((r, i) => ours`Room ${i + 1}: ${booked[i]!} · guests: ${guestsText(r)}`);
  }
  const guests =
    rooms.length === 1 || rooms.every((r) => !r.guests?.length)
      ? guestsText(rooms[0]!)
      : joined(rooms.map((r, i) => ours`room ${i + 1} ${guestsText(r)}`), "; ");
  return [
    rooms.length === 1 ? ours`Room: ${booked[0]!}` : ours`Each room: ${booked[0]!}`,
    ours`Guests: ${guests}`,
  ];
}

function itemLines(item: Item): Ours[] {
  if (item.type !== "hotel") {
    return [ours`Item of type ${code(item.type, ours`not recognized`)}: not shown in this text. ${raw(item)}`];
  }
  const h = (item as HotelItem).hotel;
  return [
    joined(
      [
        ours`Hotel: ${named(h.name, h.names)}`,
        h.hotelId === null ? ours`not in the hotel catalogue` : token("id", h.hotelId),
        stayLine(h.checkIn, h.checkOut),
        party(h.rooms),
        h.timeZone === null ? ours`time zone not listed` : ours`time zone ${token("timeZone", h.timeZone)}`,
      ],
      " · ",
    ),
    ...roomLines(h.rooms),
    h.specialRequests === null ? ours`Special requests: none` : ours`Special requests: ${theirs(h.specialRequests)}`,
    ours`Terms: ${cancellationText(h.cancellation)} · ${h.confirmation ? confirmationText(h.confirmation) : "confirmation mode not on record"} · ${feesText(h.payAtProperty)}`,
    h.confirmationNumber === null
      ? ours`Hotel confirmation number: none yet`
      : ours`Hotel confirmation number: ${theirs(h.confirmationNumber)}`,
  ];
}

function contactLine(c: Order["contact"]): Ours {
  if (c === null) return ours`Contact: none on record yet`;
  return joined(
    [
      ours`Contact: ${theirs(c.name)}`,
      c.email === null ? ours`no email on record` : theirs(c.email),
      c.phone === null ? ours`no phone on record` : theirs(c.phone),
    ],
    " · ",
  );
}

/** What became of an order that is over: why a failed one booked nothing
 *  (a failed order always says), and what a cancelled one kept and returned.
 *  The second is a cancelled order's line alone: on an order of any other
 *  status, figures of a cancellation are not its outcome. */
function outcomeLines(o: Order): Ours[] {
  const lines: Ours[] = [];
  if (o.failure) {
    lines.push(ours`Why it failed: ${label(FAILURE_WORDS, o.failure.reason, ours`the reason is not recognized`)}`);
  }
  if (o.status === "cancelled") {
    lines.push(
      o.cancelled
        ? ours`Cancelled ${when(o.cancelled.at, null)}: penalty kept ${money(o.cancelled.penalty)}, refund ${money(o.cancelled.refund)}`
        : ours`Cancelled: the penalty kept and the refund are not on record`,
    );
  }
  return lines;
}

function paymentLines(o: Order, surface: RenderSurface): Ours[] {
  const p = o.payment;
  const lines = [
    joined(
      [
        ours`Total: ${money(o.total)}`,
        ours`payment ${label(PAYMENT_WORDS, p.status, ours`status not recognized`)}`,
        p.localCurrencyAtCheckout && ours`the user's card may pay in its local currency at checkout`,
        p.localCharge && ours`card charged ${money(p.localCharge)}`,
      ],
      " · ",
    ),
  ];
  if (p.url !== null) {
    const about = joined(
      [
        p.expiresAt !== null && ours`expires ${when(p.expiresAt, null)}`,
        p.requiresSignIn ? ours`the user signs in to Fortrip to pay` : ours`no sign-in needed`,
      ],
      "; ",
    );
    lines.push(ours`Payment link (${about}): ${token("url", p.url)}`);
  } else if (o.status === "awaiting_payment" && p.status === "unpaid") {
    lines.push(ours`Payment link: none while a payment is being processed; read this order again shortly.`);
  }
  if (p.tokenRequest) lines.push(tokenLine(o, p.tokenRequest, surface));
  lines.push(cancelLine(o.cancel, o.orderId, surface));
  lines.push(ours`Manage: ${token("url", o.manageUrl)}`);
  return lines;
}

/** "Pay without the link: …": the handler by type with the business
 *  profile the token is granted for, and Stripe's usage limits for the
 *  token under Stripe's own names, as they go into the token request.
 *  `max_amount` says its unit (cents, of usd), and `expires_at` is read as
 *  an instant only when it is the Unix seconds the schema takes: any other
 *  number is shown alone. */
function tokenLine(
  o: Order,
  request: NonNullable<Order["payment"]["tokenRequest"]>,
  surface: RenderSurface,
): Ours {
  const { handler: h, usageLimits: u } = request;
  const pay =
    surface === "cli"
      ? ours`\`fortrip orders pay ${token("id", o.orderId)} --token <spt_…> --total ${token("amount", o.total.amount)}\``
      : ours`pay_order`;
  const unit = u.currency === "usd" ? "cents" : "the currency's minor unit";
  const limits = ours`max_amount ${u.max_amount} (${unit}), currency ${token("currency", u.currency)}, expires_at ${u.expires_at}`;
  const until = tokenUsageLimits.shape.expires_at.safeParse(u.expires_at).success
    ? ours`${limits} (${when(new Date(u.expires_at * 1000).toISOString(), null)})`
    : limits;
  return ours`Pay without the link: ${pay} with a shared payment token via ${token("handlerType", h.type)} (handler ${token("id", h.id)}, business_profile ${token("id", h.config.business_profile)}); usage limits for the token request: ${until}.`;
}

/** "penalty USD 120.00, refund USD 246.00": what cancelling now keeps and
 *  returns. Figures are only ever the order's own. */
function cancelFigures(c: OrderCancel): Ours {
  const figure = (m: OrderCancel["penalty"]) => (m ? money(m) : ours`not stated`);
  return ours`penalty ${figure(c.penalty)}, refund ${figure(c.refund)}`;
}

/** The order a CLI command names: its id, or the placeholder where the
 *  text has none to give (an error holds the order's cancel state, not its
 *  id). A tool call names no order in these words: the caller has its id. */
function orderArgument(orderId: string | null): Ours {
  return orderId === null ? ours`<orderId>` : token("id", orderId);
}

/** The call that cancels a paid order for `penalty`, as `surface` makes it:
 *  the penalty is the order's own, as the call takes it. */
function cancelCall(orderId: string | null, penalty: NonNullable<OrderCancel["penalty"]>, surface: RenderSurface): Ours {
  return surface === "cli"
    ? ours`run \`fortrip orders cancel ${orderArgument(orderId)} --max-penalty ${token("amount", penalty.amount)}\``
    : ours`call cancel_order with maximumPenalty { amount: ${theirs(penalty.amount)}, currency: ${theirs(penalty.currency)} }`;
}

/** The call that closes an unpaid order, as `surface` makes it. */
function closeCall(orderId: string | null, surface: RenderSurface): Ours {
  return surface === "cli"
    ? ours`run \`fortrip orders cancel ${orderArgument(orderId)} --close\``
    : ours`call cancel_order with close: true`;
}

/**
 * The "Cancel: …" line: what `cancel_order` can do to an order now, and by
 * which of its two modes. Cancel it (a paid order), with the penalty, the
 * refund and the call that passes that penalty; close it (an unpaid one), on
 * the user's word, with its call; or what blocks both. It is an order's
 * line, and the line `order_not_cancellable` shows of the order it is about:
 * the cancel rule (`cancelNextStep`) points at it for the figure and the
 * call.
 */
export function cancelLine(c: OrderCancel, orderId: string | null, surface: RenderSurface): Ours {
  if (c.action === "close") {
    return ours`Cancel: can be closed now, nothing is charged; close it only if the user says they no longer want it (${closeCall(orderId, surface)})`;
  }
  if (c.action === "cancel") {
    const now = ours`Cancel: can cancel now: ${cancelFigures(c)}`;
    return c.penalty ? ours`${now} (only after the user's yes: ${cancelCall(orderId, c.penalty, surface)})` : now;
  }
  if (c.action !== null) return ours`Cancel: ${code(c.action, ours`an action not recognized`)}`;
  return ours`Cancel: not available: ${blockerText(c)}`;
}

/** What blocks both cancelling and closing, in words. An order with no
 *  action always names it. */
export function blockerText(c: OrderCancel): Ours {
  return label(CANCEL_BLOCKER_WORDS, c.blockedBy ?? "", ours`reason not recognized`);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * An order as it came, each optional part of it that does not parse read as
 * not there, so that one such part does not cost the order its text: what a
 * cancellation kept is then not on record, why the order failed is unknown
 * (a failed order always says), and the order takes no token, which leaves
 * the payment link. Each is what the text says of the part when it is absent,
 * and none is a fact about the stay, the money or what can be done now:
 * an order that does not parse there is still shown as JSON.
 */
export function readableOrder(value: unknown): unknown {
  if (!isObject(value)) return value;
  const order = { ...value };
  if (!orderCancelled.nullable().safeParse(order.cancelled).success) order.cancelled = null;
  if (!orderFailure.nullable().safeParse(order.failure).success) {
    order.failure = order.status === "failed" ? { reason: "unknown" } : null;
  }
  if (isObject(order.payment) && !paymentTokenRequest.nullable().safeParse(order.payment.tokenRequest).success) {
    order.payment = { ...order.payment, tokenRequest: null };
  }
  return order;
}

/** An order of a list that this build can't read: kept as it came, and
 *  shown as JSON on one line, so the orders around it still show in full. */
export class UnreadableOrder {
  constructor(readonly value: unknown) {}
}

export function orderLines(o: Order, surface: RenderSurface = "mcp"): Ours[] {
  return [
    ours`Order ${token("id", o.orderId)} · reference ${token("id", o.reference)} · ${label(ORDER_STATUS_WORDS, o.status, ours`status not recognized`)} · created ${when(o.createdAt, null)} · updated ${when(o.updatedAt, null)}`,
    ...outcomeLines(o),
    ...o.items.flatMap(itemLines),
    contactLine(o.contact),
    ...paymentLines(o, surface),
  ];
}

export function renderOrder(o: Order, surface: RenderSurface = "mcp"): string {
  return orderLines(o, surface).join("\n");
}

export function renderOrderList(
  list: { data: (Order | UnreadableOrder)[]; nextCursor: string | null },
  surface: RenderSurface = "mcp",
): string {
  const lines = [
    list.data.length === 0
      ? ours`No orders on this page.`
      : ours`Orders, newest first: ${list.data.length} on this page.`,
  ];
  for (const o of list.data) {
    lines.push(
      ours``,
      ...(o instanceof UnreadableOrder
        ? [ours`This order is not in the expected shape; as JSON: ${raw(o.value)}`]
        : orderLines(o, surface)),
    );
  }
  lines.push(
    ours``,
    list.nextCursor === null
      ? ours`Last page.`
      : surface === "cli"
        ? ours`Next page: run again with --cursor ${token("cursor", list.nextCursor)}.`
        : ours`Next page: call again with { cursor: ${theirs(list.nextCursor)} }.`,
  );
  return lines.join("\n");
}
