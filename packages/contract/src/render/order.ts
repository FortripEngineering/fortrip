import { LIMITS, SUPPORT_EMAIL } from "../limits.ts";
import type { Order, OrderList, PaymentMethod, PaymentMethodId } from "../outputs/order.ts";
import { CALLS, type RenderSurface } from "../tools.ts";
import { label, money, named, party, raw, stayLine, when } from "./format.ts";
import { cancellationText, feesText, mealsWithLabel } from "./offers.ts";

/* `book_hotel`, `get_order` and `list_orders` (spec §10.2). */

type Item = Order["items"][number];
type HotelItem = Extract<Item, { type: "hotel" }>;

/** An order's `payment.methods` entry with `id`, if it has one. A known id
 *  is always its own branch: the open union's fallback refuses it. */
export function methodOf<I extends PaymentMethodId>(
  o: Order,
  id: I,
): Extract<PaymentMethod, { id: I }> | undefined {
  return o.payment.methods.find((m) => m.id === id) as Extract<PaymentMethod, { id: I }> | undefined;
}

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

/** Why an order can't be cancelled now, in words; the error
 *  `order_not_cancellable` words its reason the same way. */
export const CANCEL_REASON_WORDS: Record<string, string> = {
  cancellable: "it can be cancelled",
  unpaid: "it isn't paid: it can be closed if the user no longer wants it",
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

function paymentLines(o: Order, surface: RenderSurface): string[] {
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
  } else if (o.status === "awaiting_payment" && p.status === "unpaid") {
    lines.push("Payment link: could not be read this time; read this order again for it.");
  }
  const token = methodOf(o, "stripe_shared_payment_token");
  if (token) lines.push(tokenLine(o, token, surface));
  const wallet = methodOf(o, "stripe_alipay_wechat_pay");
  if (wallet) lines.push(...walletLines(wallet, surface));
  lines.push(cancelLine(o, surface));
  lines.push(`Manage: ${o.manageUrl}`);
  return lines;
}

/** "Pay without the link: …": the token entry's handler by type with the
 *  business profile its token is granted for, the token's limits, and when
 *  to use it at all. */
function tokenLine(
  o: Order,
  token: Extract<PaymentMethod, { id: "stripe_shared_payment_token" }>,
  surface: RenderSurface,
): string {
  const { handler: h, limits } = token;
  const pay =
    surface === "cli"
      ? `\`fortrip orders pay ${o.orderId} --token <spt_…> --total ${o.price.total.amount}\``
      : "pay_order";
  return [
    `Pay without the link: ${pay} with a shared payment token via ${h.type} (handler ${h.id}, business_profile ${h.config.business_profile}); token limits: maxAmount ${limits.maxAmount} (cents), currency ${limits.currency}, expiresAt ${limits.expiresAt}.`,
    "Only if you have a tool that can request the token from the user's Link wallet (US and Canadian Link accounts); otherwise give the payment link, and never ask the user to create, type or paste a token.",
    `First show the user the total and currency, the stay and every term, and wait for a clear yes. Pay one way only: the link or ${surface === "cli" ? "`fortrip orders pay`" : "pay_order"}.`,
  ].join(" ");
}

/** Paying with Alipay or WeChat Pay: how to open it, or, once open, the
 *  code and both links. */
function walletLines(
  w: Extract<PaymentMethod, { id: "stripe_alipay_wechat_pay" }>,
  surface: RenderSurface,
): string[] {
  const c = CALLS[surface];
  if (!w.open) {
    const pay =
      surface === "cli"
        ? "run `fortrip orders pay <orderId> --method stripe_alipay_wechat_pay --total <total>`"
        : "call pay_order with method stripe_alipay_wechat_pay and the order's price.total";
    return [`Pay with Alipay or WeChat Pay: ${pay}.`];
  }
  const lines: string[] = [];
  const wechat = w.wechatPay;
  if (wechat) {
    const live = wechat.qrData !== null && wechat.qrImageUrl !== null;
    lines.push(
      !live
        ? `WeChat Pay: a new code at ${wechat.url}`
        : surface === "cli"
          ? `WeChat Pay: open ${wechat.url}`
          : `WeChat Pay: ![WeChat Pay QR code](${wechat.qrImageUrl}), or a full-size code at ${wechat.url}`,
    );
  }
  if (w.alipay) lines.push(`Alipay: ${w.alipay.url}`);
  lines.push(
    `Show the user the WeChat Pay code as an image if you can, and both links. They pay once, by either; the code lasts ${LIMITS.wechatCodeMinutes} minutes. Then ${c.get} until the order isn't awaiting_payment.`,
  );
  return lines;
}

/** "Cancel: can cancel now: penalty …, refund …", or why not. Figures are
 *  only ever the order's own. An unpaid order is closed instead, on the
 *  user's word; one that can't be is a website order, left to expire, or
 *  one with a payment under way. */
function cancelLine(o: Order, surface: RenderSurface): string {
  const c = o.cancel;
  if (c.available && c.reason === "unpaid") {
    return `Cancel: can be closed now, nothing is charged; close it only if the user says they no longer want it (${CALLS[surface].close})`;
  }
  if (o.status === "awaiting_payment" && !c.available && c.reason === "not_confirmed") {
    if (!o.payment.requiresSignIn) return "Cancel: not now: a payment is under way; read the order again shortly";
    const at = o.payment.expiresAt === null ? "" : ` at ${when(o.payment.expiresAt, null)}`;
    return `Cancel: not needed: an unpaid order expires unpaid${at}`;
  }
  const figure = (name: string, m: typeof c.penalty) =>
    `${name} ${m ? money(m) : "not stated"}`;
  const figures = `${figure("penalty", c.penalty)}, ${figure("refund", c.refund)}`;
  if (c.available) return `Cancel: can cancel now: ${figures}`;
  const why = `Cancel: not available: ${label(CANCEL_REASON_WORDS, c.reason)}`;
  return c.penalty || c.refund ? `${why} · ${figures}` : why;
}

export function orderLines(o: Order, surface: RenderSurface = "mcp"): string[] {
  return [
    `Order ${o.orderId} · reference ${o.reference} · ${label(ORDER_STATUS_WORDS, o.status)} · created ${when(o.createdAt, null)} · updated ${when(o.updatedAt, null)}`,
    ...o.items.flatMap(itemLines),
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
