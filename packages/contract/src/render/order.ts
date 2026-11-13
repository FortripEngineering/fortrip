import { SUPPORT_EMAIL } from "../limits.ts";
import { type Order, type OrderCancel, tokenUsageLimits } from "../outputs/order.ts";
import { CALLS, type RenderSurface } from "../tools.ts";
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
  non_refundable:
    "the hotel takes no cancellation for this order, even one that keeps the whole total; the booking stands",
  refused: "the hotel refused the cancellation; the booking stands",
  terms_unknown: `its cancellation terms are not on record; ${SUPPORT}`,
  support_only: `the booking stands, and it can't be cancelled here; to cancel it, the user emails ${SUPPORT_EMAIL} with the order's reference`,
  needs_attention: `Fortrip is looking into this order; ${SUPPORT}`,
};

/** Why a failed order booked nothing, and what to do next. */
const FAILURE_WORDS: Record<string, string> = {
  rate_unavailable:
    "the rate could no longer be booked when the hotel was asked; get offers again and let the user choose again",
  hotel_refused: `the hotel's booking system refused this order, and would refuse the same order again; check the guest names with the user (as on the passport) before ordering again, and ${SUPPORT}`,
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
        h.hotelId === null ? ours`not in the hotel catalogue` : token(h.hotelId),
        stayLine(h.checkIn, h.checkOut),
        party(h.rooms),
        h.timeZone === null ? ours`time zone not listed` : ours`time zone ${token(h.timeZone)}`,
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
    lines.push(ours`Payment link (${about}): ${token(p.url)}`);
  } else if (o.status === "awaiting_payment" && p.status === "unpaid") {
    lines.push(ours`Payment link: none while a payment is being processed; read this order again shortly.`);
  }
  if (p.token) lines.push(tokenLine(o, p.token, surface));
  lines.push(ours`Cancel: ${cancelText(o, surface)}`);
  lines.push(ours`Manage: ${token(o.manageUrl)}`);
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
  request: NonNullable<Order["payment"]["token"]>,
  surface: RenderSurface,
): Ours {
  const { handler: h, usageLimits: u } = request;
  const pay =
    surface === "cli"
      ? ours`\`fortrip orders pay ${token(o.orderId)} --token <spt_…> --total ${token(o.total.amount)}\``
      : ours`pay_order`;
  const unit = u.currency === "usd" ? "cents" : "the currency's minor unit";
  const limits = ours`max_amount ${u.max_amount} (${unit}), currency ${token(u.currency)}, expires_at ${u.expires_at}`;
  const until = tokenUsageLimits.shape.expires_at.safeParse(u.expires_at).success
    ? ours`${limits} (${when(new Date(u.expires_at * 1000).toISOString(), null)})`
    : limits;
  return ours`Pay without the link: ${pay} with a shared payment token via ${token(h.type)} (handler ${token(h.id)}, business_profile ${token(h.config.business_profile)}); usage limits for the token request: ${until}.`;
}

/** "penalty USD 120.00, refund USD 246.00": what cancelling now keeps and
 *  returns. Figures are only ever the order's own. */
export function cancelFigures(c: OrderCancel): Ours {
  const figure = (m: OrderCancel["penalty"]) => (m ? money(m) : ours`not stated`);
  return ours`penalty ${figure(c.penalty)}, refund ${figure(c.refund)}`;
}

/** The call that cancels a paid order for `penalty`, as `surface` makes it. */
function cancelCall(orderId: string, penalty: NonNullable<OrderCancel["penalty"]>, surface: RenderSurface): Ours {
  return surface === "cli"
    ? ours`run \`fortrip orders cancel ${token(orderId)} --max-penalty ${token(penalty.amount)}\``
    : ours`call cancel_order with maximumPenalty { amount: ${theirs(penalty.amount)}, currency: ${theirs(penalty.currency)} }`;
}

/** What `cancel_order` can do to the order now, and by which of its two
 *  modes: cancel it (a paid order), with the penalty and the refund; close it
 *  (an unpaid one), on the user's word; or what blocks both. */
function cancelText(o: Order, surface: RenderSurface): Ours {
  const c = o.cancel;
  if (c.action === "close") {
    return ours`can be closed now, nothing is charged; close it only if the user says they no longer want it (${CALLS[surface].close})`;
  }
  if (c.action === "cancel") {
    const now = ours`can cancel now: ${cancelFigures(c)}`;
    return c.penalty ? ours`${now} (only after the user's yes: ${cancelCall(o.orderId, c.penalty, surface)})` : now;
  }
  if (c.action !== null) return code(c.action, ours`an action not recognized`);
  return ours`not available: ${blockerText(c)}`;
}

/** What blocks both cancelling and closing, in words. An order with no
 *  action always names it. */
export function blockerText(c: OrderCancel): Ours {
  return label(CANCEL_BLOCKER_WORDS, c.blockedBy ?? "", ours`reason not recognized`);
}

/** An order of a list that this build can't read: kept as it came, and
 *  shown as JSON on one line, so the orders around it still show in full. */
export class UnreadableOrder {
  constructor(readonly value: unknown) {}
}

export function orderLines(o: Order, surface: RenderSurface = "mcp"): Ours[] {
  return [
    ours`Order ${token(o.orderId)} · reference ${token(o.reference)} · ${label(ORDER_STATUS_WORDS, o.status, ours`status not recognized`)} · created ${when(o.createdAt, null)} · updated ${when(o.updatedAt, null)}`,
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
        ? ours`Next page: run again with --cursor ${token(list.nextCursor)}.`
        : ours`Next page: call again with { cursor: ${theirs(list.nextCursor)} }.`,
  );
  return lines.join("\n");
}
