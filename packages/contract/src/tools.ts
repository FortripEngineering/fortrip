import { z } from "zod";

import {
  cancelOrderInput,
  createOrderInput,
  getHotelInput,
  getOrderInput,
  hotelOffersInput,
  listOrdersInput,
  payOrderInput,
  searchHotelsInput,
} from "./inputs.ts";
import { LIMITS, SUPPORT_EMAIL } from "./limits.ts";
import { hotel } from "./outputs/hotel.ts";
import { hotelOffersResult } from "./outputs/offer.ts";
import { order, orderList } from "./outputs/order.ts";
import { searchResult } from "./outputs/search.ts";

/*
 * The MCP tools every agent surface describes: what the hosted server
 * registers, and what the docs and the guide name. Wording here is what MCP
 * clients show the model, so it speaks in tool names and field names. Each
 * tool takes the HTTP request of its endpoint, unchanged (spec §6).
 */

export type ToolName =
  | "search_hotels"
  | "get_hotel"
  | "get_hotel_offers"
  | "book_hotel"
  | "get_order"
  | "list_orders"
  | "cancel_order"
  | "pay_order";

export interface ToolSpec {
  name: ToolName;
  title: string;
  description: string;
  annotations: {
    readOnlyHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
    destructiveHint: boolean;
  };
  /** What the tool takes. */
  input: z.ZodType;
  /** The open schema of what it answers with. */
  output: z.ZodType;
}

/**
 * The consent rule (spec §6), for every way to pay. It rides on every MCP
 * result that holds a non-null `payment.url`, as `nextStep` and as the first
 * next-step paragraph of the text: some clients never show the model the
 * server instructions. The pay and wallet paragraphs after it refer to the
 * confirmation in a clause of their own.
 */
export const ORDER_NEXT_STEP =
  "Before you give the user an order's payment.url, show them its total and currency, the stay (hotel, room, dates, rooms and guests per room) and every term (meals, cancellation, fees payable at the property), then end your reply by asking them to confirm, and wait for a clear yes. Only after they say yes, give them payment.url exactly as returned.";

/** Where a rendered result is read: an MCP client, which calls tools with
 *  JSON arguments, or the CLI, which runs commands with flags. */
export type RenderSurface = "mcp" | "cli";

/** How each next step names the call it leads to. */
export const CALLS = {
  mcp: {
    cancel: "call cancel_order",
    penalty: "Pass maximumPenalty as cancel.penalty, exactly as returned.",
    close: "call cancel_order",
    pay: "call pay_order",
    payWallet: " with method stripe_alipay_wechat_pay and the order's price.total",
    get: "call get_order",
    poll: "poll get_order",
    payWith: "call pay_order with it and the order's price.total",
    paid: "pay_order",
  },
  cli: {
    cancel: "run `fortrip orders cancel <orderId> --max-penalty <amount>`",
    close: "run `fortrip orders cancel <orderId> --close`",
    penalty:
      "Pass the penalty's amount as --max-penalty (120.00 for a penalty of USD 120.00).",
    pay: "run `fortrip orders pay`",
    payWallet: " with --method stripe_alipay_wechat_pay --total <total>",
    get: "run `fortrip orders get <orderId>`",
    poll: "poll it with `fortrip orders get <orderId>`",
    payWith:
      "run `fortrip orders pay <orderId> --token <spt_…> --total <total>` with the token and the order's total",
    paid: "`fortrip orders pay`",
  },
} as const satisfies Record<RenderSurface, Record<string, string>>;

/**
 * The consent rule of a cancellation (spec §5.7, C11), as `surface` names
 * the call. It rides as the last paragraph of the text of every `get_order`
 * and `list_orders` result that holds an order with `cancel.available`
 * (an unpaid one, reason `unpaid`, aside: it is closed with no penalty),
 * after `ORDER_NEXT_STEP` when both apply, and never as `nextStep`, which
 * keeps its payment-only meaning.
 */
export function cancelNextStep(surface: RenderSurface): string {
  const c = CALLS[surface];
  return `Before you ${c.cancel}, show the user the order's stay (hotel, dates), cancel.penalty and cancel.refund (amount and currency), then end your reply by asking them to confirm the cancellation, and wait for a clear yes. ${c.penalty} Never state a refund the order did not return.`;
}

/** `cancelNextStep` over MCP. */
export const CANCEL_NEXT_STEP = cancelNextStep("mcp");

/**
 * How to pay without the link, as `surface` names the call. It rides as the
 * last paragraph of the text of every `book_hotel`, `get_order` and
 * `list_orders` result that holds an order whose `payment.methods` has the
 * `stripe_shared_payment_token` entry, after `ORDER_NEXT_STEP`; never as
 * `nextStep`.
 */
export function payNextStep(surface: RenderSurface): string {
  const c = CALLS[surface];
  return `To pay without the link: only if you have a tool that can request a Stripe shared payment token from the user's Link wallet (US and Canadian Link accounts), and the order's payment.methods has the stripe_shared_payment_token entry. Otherwise give payment.url, and never ask the user to create, type or paste a token. Before you ${c.pay}, show the user the order's total and currency, the stay (hotel, room, dates, rooms and guests per room) and every term (meals, cancellation, fees payable at the property), then end your reply by asking them to confirm, and wait for a clear yes. Then request the token for this order from the user's Link wallet with that entry's handler config.business_profile and its limits (maxAmount in cents, currency, expiresAt), and ${c.payWith}. The charge is in USD: a card in another currency may add a foreign transaction fee. Pay one way only: either give payment.url or ${c.pay}. Once ${c.paid} succeeds, payment.url stops working; a failed payment leaves it open.`;
}

/** `payNextStep` over MCP. */
export const PAY_NEXT_STEP = payNextStep("mcp");

/**
 * How to pay with Alipay or WeChat Pay (spec §7), as `surface` names the
 * call. It rides as the last paragraph of the text of every `book_hotel`,
 * `get_order` and `list_orders` result that holds an order whose
 * `payment.methods` has the `stripe_alipay_wechat_pay` entry, not yet open;
 * never as `nextStep`.
 */
export function walletNextStep(surface: RenderSurface): string {
  const c = CALLS[surface];
  return `Before you ${c.pay}${c.payWallet}, show the user the order's total and currency, the stay (hotel, room, dates, rooms and guests per room) and every term (meals, cancellation, fees payable at the property), then ask them to confirm, and wait for a clear yes. Then show the stripe_alipay_wechat_pay entry of payment.methods: the WeChat code as an image if you can, and both links. The user pays once, by one of them. Alipay and WeChat Pay charge at once; if the hotel can't confirm, the payment is refunded in full. Then ${c.poll}.`;
}

/** `walletNextStep` over MCP. */
export const WALLET_NEXT_STEP = walletNextStep("mcp");

/**
 * How to present hotels (the `presentation` guide, in one line). It rides as
 * the last paragraph of every MCP `search_hotels`, `get_hotel` and
 * `get_hotel_offers` result: a rule next to the data is followed far more
 * reliably than one in the server instructions.
 */
export const PRESENTATION_HINT =
  "Presentation: If your interface can show rich elements, show each hotel as a card with only what Fortrip's tools returned for it in this conversation: photo, name, stars, region and price, and once you have offers every term that changes the choice (meals and who they cover, cancellation, fees payable at the property, confirmation), an unknown one as unknown. Label a search's `price.fromPerRoomNight` as an estimate per room-night and an offer's `price.total` as the whole stay for all rooms, in its currency, and draw a map only from returned `location` coordinates. Offer the choices you need to ask anyway (dates, a locality, which offer) as options to pick. Otherwise use a short list. Keep hotel names as returned, and never invent photos, ratings, reviews, prices, terms or coordinates.";

const nextStep = z
  .string()
  .optional()
  .describe(
    "What to show and ask before giving a payment.url or paying another way. Present when the answer holds a non-null payment.url, and only then.",
  );

/** The answers over MCP that are orders. Those that can hold a
 *  `payment.url` are the HTTP answer plus `nextStep`, which only MCP
 *  declares; `cancel_order`'s and `pay_order`'s never hold one, so they are
 *  the HTTP answer. */
export const MCP_OUTPUT = {
  book_hotel: order.extend({ nextStep }),
  get_order: order.extend({ nextStep }),
  list_orders: orderList.extend({ nextStep }),
  cancel_order: order,
  pay_order: order,
} as const satisfies Record<
  "book_hotel" | "get_order" | "list_orders" | "cancel_order" | "pay_order",
  z.ZodType
>;

const READ = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
  destructiveHint: false,
} as const;

/** Reads of Fortrip's own records. */
const READ_OWN = { ...READ, openWorldHint: false } as const;

export const TOOLS: readonly ToolSpec[] = [
  {
    name: "search_hotels",
    title: "Search hotels",
    description:
      "Find hotels by destination and/or text, with an indicative per-room-night price when a stay is given. destination is a place_name with its countryCode, a place or locality by placeId from an earlier answer, a point, or a country. text matches hotel names, brands and areas word for word. Indicative prices are estimates and not bookable: get_hotel_offers returns what the user pays. A name several places bear answers destination_ambiguous, and a search too broad to answer search_too_broad with its localities; each error says what to do next. The answer states the scope, the counts and notes; a next page is the cursor and, optionally, limit.",
    annotations: READ,
    input: searchHotelsInput,
    output: searchResult,
  },
  {
    name: "get_hotel",
    title: "Hotel details",
    description:
      'One hotel\'s catalogue facts: names, address, location, time zone, check-in and check-out times, the full description, every policy and the amenities, and its rooms with include: "rooms". "Not listed" is not "no". No prices or availability: get_hotel_offers has those.',
    annotations: READ,
    input: getHotelInput,
    output: hotel,
  },
  {
    name: "get_hotel_offers",
    title: "Live offers",
    description: `Live, bookable offers for up to ${LIMITS.offersHotels} hotels and one stay. Every room in stay.rooms must have the same party: for different parties, call once per party. Each offer has the room, the meals included, price.total, in the request's currency, for the whole stay and every room (what is charged), fees payable at the property, the cancellation terms with times in UTC and the hotel's time zone, the confirmation mode, and an offerId for book_hotel that expires at expiresAt. Hotels with nothing to offer are listed under unavailable with the reason. Up to limitPerHotel offers per hotel (default ${LIMITS.offersPerHotelDefault}), picked to span price, free cancellation, breakfast and rooms, listed cheapest first; the answer counts those not shown.`,
    annotations: READ,
    input: hotelOffersInput,
    output: hotelOffersResult,
  },
  {
    name: "book_hotel",
    title: "Create order",
    description: `Order one offer from get_hotel_offers. The answer is an unpaid order with a payment link: status awaiting_payment, the total, the stay and its terms, and payment.url, a Fortrip page to pay on. Nothing is charged until the order is paid, on that page or with pay_order; anyone holding the link can pay. Send the contact and, for each room of the offer, at least one guest. If the price or terms changed since the offer, the answer is offer_changed with every change and a new offer: show the changes and ask the user again before ordering it. Sending the same details again returns the same order. An offer is ordered once: for another order of the stay (another party, or a corrected guest name), get offers again and order the new offer; when it replaces an unpaid order, tell the user to pay only the new link, as the earlier one expires unpaid. To cancel an order, use cancel_order; for changes, or a cancellation cancel_order can't make, the user emails ${SUPPORT_EMAIL} with the order's reference.`,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
    input: createOrderInput,
    output: MCP_OUTPUT.book_hotel,
  },
  {
    name: "get_order",
    title: "Get order",
    description:
      "One of the user's orders by orderId: its status, the payment status and, while it awaits payment, payment.url; the stay and its terms; and the hotel's confirmation number once there is one. Check it after the user pays.",
    annotations: READ_OWN,
    input: getOrderInput,
    output: MCP_OUTPUT.get_order,
  },
  {
    name: "list_orders",
    title: "List orders",
    description:
      "The user's hotel orders, newest first, including those made on the Fortrip website. Pass nextCursor back as cursor for the next page.",
    annotations: READ_OWN,
    input: listOrdersInput,
    output: MCP_OUTPUT.list_orders,
  },
  {
    name: "cancel_order",
    title: "Cancel order",
    description: `Cancel a paid order under its terms, or close an unpaid one. Paid (cancel.reason cancellable): only after the user confirmed the order's cancel.penalty and cancel.refund with a clear yes, pass maximumPenalty, that cancel.penalty exactly as returned. The order becomes cancelling, then cancelled with cancel.refund refunded, or confirmed with reason refused if the hotel refuses: poll get_order. cancellation_changed: the penalty rose above maximumPenalty and nothing changed; ask the user again. Never state a refund the order did not return. Unpaid (cancel.reason unpaid): close it, without maximumPenalty, only once the user says they no longer want it; nothing is charged and it becomes expired. If it was paid meanwhile, the answer is the paid order, invalid_request, order_not_cancellable or order_in_progress: cancel it only under its cancel.penalty, with the user's yes. payment_in_progress: read it again shortly. Repeat calls answer the order as it is.`,
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
      destructiveHint: true,
    },
    input: cancelOrderInput,
    output: MCP_OUTPUT.cancel_order,
  },
  {
    name: "pay_order",
    title: "Pay order",
    description:
      `Pay a USD order without its link, by one of its payment.methods: a Stripe shared payment token, only if you can request one from the user's Link wallet (US and Canadian accounts; never ask the user for one), or Alipay/WeChat Pay (method stripe_alipay_wechat_pay). Call it only after the user confirmed the order's total and currency, the stay and every term with a clear yes. Token: request it with the entry's handler config.business_profile and limits, and pass it with price.total; a token pays one order. Wallet: pass method and price.total, then show the entry it returns: the WeChat code as an image if you can, and both links; the user pays once, by either. A code lasts ${LIMITS.wechatCodeMinutes} minutes; then the WeChat link opens a new one, or call again. Pay one way only: success closes payment.url, a failure leaves it open, and each error says how to recover. Then poll get_order.`,
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
    input: payOrderInput,
    output: MCP_OUTPUT.pay_order,
  },
];
