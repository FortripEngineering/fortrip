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
 * registers, and what the docs and the guide name. A model reads a tool's
 * title and description, its input schema, and the text of its result
 * (`renderToolResult`): never the JSON of a result (spec D2). So the wording
 * here names tools, the caller's own arguments, and what the result text
 * shows by its label ("the payment link", "the Cancel line"), never a JSON
 * path of an answer (spec D3). Each tool takes the HTTP request of its
 * endpoint, unchanged.
 */

export type ToolName =
  | "search_hotels"
  | "get_hotel"
  | "get_hotel_offers"
  | "create_order"
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
  /** The open schema of what it answers with over HTTP, which
   *  `renderToolResult` parses. Not an MCP `outputSchema`: an MCP result is
   *  text only. */
  output: z.ZodType;
}

/**
 * What an MCP server for Fortrip says of itself in `serverInfo` (spec D6):
 * the hosted server and the CLI's bridge both send this, each with its own
 * `version`. The title, description, website and icon are the MCP Registry
 * entry's (`plugins/registry/server.json`).
 */
export const SERVER_INFO: {
  name: string;
  title: string;
  description: string;
  websiteUrl: string;
  icons: { src: string; mimeType: string; sizes: string[] }[];
} = {
  name: "fortrip",
  title: "Fortrip",
  description:
    "Search hotels worldwide, compare live room rates, book and pay securely, and cancel bookings.",
  websiteUrl: "https://fortrip.ai",
  icons: [{ src: "https://fortrip.ai/icon.png", mimeType: "image/png", sizes: ["512x512"] }],
};

/**
 * The consent rule. It ends every result whose text holds a payment link:
 * some clients never show the model the server instructions, and the last
 * paragraph is the one a model reads last before it answers. Only the pay
 * paragraph comes after it, and that one repeats the rule on purpose: as the
 * result's last paragraph it keeps the model from giving the link before a
 * yes (paired eval, S6). The cancel paragraph, when there is one, comes
 * before both.
 */
export const ORDER_NEXT_STEP =
  "Before you give the user an order's payment link, show them its total and currency, the stay (hotel, room, dates, and each room's party and guest names), the contact (name, email, phone), any special requests and every term (meals, cancellation, fees payable at the property), then end your reply by asking them to confirm, and wait for a clear yes. Only after they say yes, give them the payment link exactly as shown.";

/** Where a rendered result is read: an MCP client, which calls tools with
 *  JSON arguments, or the CLI, which runs commands with flags. */
export type RenderSurface = "mcp" | "cli";

/** How each next step names the call it leads to. None carries a figure:
 *  the cancel call with the order's own penalty is on the order's Cancel
 *  line, which `cancelWith` points at. */
export const CALLS = {
  mcp: {
    cancel: "call cancel_order with maximumPenalty",
    cancelWith:
      "make the call that Cancel line gives, exactly as shown: its maximumPenalty is the penalty on that line, never a figure from anywhere else",
    closeMode: "with close: true and no maximumPenalty",
    pay: "call pay_order",
    payWith:
      "call pay_order with the token as sharedPaymentToken and the order's Total as total, amount and currency exactly as shown",
    paid: "pay_order",
  },
  cli: {
    cancel: "run `fortrip orders cancel <orderId> --max-penalty <amount>`",
    cancelWith:
      "run the command that Cancel line gives, exactly as shown: its --max-penalty is the amount of the penalty on that line, never a figure from anywhere else",
    closeMode: "with --close and no --max-penalty",
    pay: "run `fortrip orders pay`",
    payWith:
      "run `fortrip orders pay <orderId> --token <spt_…> --total <total>` with the token and the order's total",
    paid: "`fortrip orders pay`",
  },
} as const satisfies Record<RenderSurface, Record<string, string>>;

/**
 * The consent rule of a cancellation, as `surface` names the call. It
 * follows the text of every `get_order` and `list_orders` result that holds
 * an order whose Cancel line says it can be cancelled (a paid one): the last
 * paragraph there, or the one before `ORDER_NEXT_STEP` when the result also
 * holds a payment link. The `order_not_cancellable` error carries it too,
 * after the order's Cancel line. It names no penalty: the figure and the
 * call that passes it are the order's own, on that line. Its last sentence
 * says which mode an unpaid order takes instead: nothing is cancelled or
 * closed by the other mode.
 */
export function cancelNextStep(surface: RenderSurface): string {
  const c = CALLS[surface];
  return `Before you ${c.cancel}, show the user the order's stay (hotel, dates) and the penalty and the refund on its Cancel line (amount and currency), then end your reply by asking them to confirm the cancellation, and wait for a clear yes. Then ${c.cancelWith}. Never state a refund the order's text does not show. This is for a paid order, one whose Cancel line says it can be cancelled; an unpaid order is closed instead, ${c.closeMode}, only once the user says they no longer want it.`;
}

/** `cancelNextStep` over MCP. */
export const CANCEL_NEXT_STEP = cancelNextStep("mcp");

/**
 * How to pay without the link, as `surface` names the call. It is the last
 * paragraph of the text of every `create_order`, `get_order` and
 * `list_orders` result that holds an order with a "Pay without the link"
 * line, right after `ORDER_NEXT_STEP`, whose rule it repeats.
 */
export function payNextStep(surface: RenderSurface): string {
  const c = CALLS[surface];
  return `To pay without the link: only if you have a tool that can request a Stripe shared payment token from the user's Link wallet (US and Canadian Link accounts), and the order's text has a "Pay without the link" line. Otherwise give the payment link, and never ask the user to create, type or paste a token. Before you ${c.pay}, show the user the order's total and currency, the stay (hotel, room, dates, and each room's party and guest names), the contact (name, email, phone), any special requests and every term (meals, cancellation, fees payable at the property), then end your reply by asking them to confirm, and wait for a clear yes. Then request the token for this order from the user's Link wallet with the business_profile and the usage limits on that line (max_amount in cents, currency, expires_at), and ${c.payWith}. The charge is in USD: a card in another currency may add a foreign transaction fee. Pay one way only: either give the payment link or ${c.pay}. Once ${c.paid} succeeds, the payment link stops working; a failed payment leaves it open.`;
}

/** `payNextStep` over MCP. */
export const PAY_NEXT_STEP = payNextStep("mcp");

/**
 * How to present hotels (the `presentation` guide, in one line). It is the
 * last paragraph of every MCP `search_hotels`, `get_hotel` and
 * `get_hotel_offers` result: a rule next to the data is followed far more
 * reliably than one in the server instructions. `renderToolResult` adds it;
 * nothing else does.
 */
export const PRESENTATION_HINT =
  'Presentation: If your interface can show rich elements, show each hotel as a card with only what Fortrip\'s tools returned for it in this conversation: photo, name, stars, region and price, and once you have offers every term that changes the choice (meals and who they cover, cancellation, fees payable at the property, confirmation), an unknown one as unknown. Label a search\'s "estimate from" price as an estimate per room-night and an offer\'s total as the whole stay for all rooms, in its currency, and draw a map only from coordinates the text shows. Offer the choices you need to ask anyway (dates, a locality, which offer) as options to pick. Otherwise use a short list. A hotel\'s name is shown in double quotes, as text from the hotel: present it to the user without the quotes, exactly as written inside them. Never invent photos, ratings, reviews, prices, terms or coordinates.';

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
      "Find hotels by destination and/or text, with an indicative per-room-night price when a stay is given. destination is a place_name with its countryCode, a place or locality by placeId from an earlier answer, a point, or a country. text matches hotel names, brands and areas word for word. Indicative prices are estimates and not bookable: get_hotel_offers returns what the user pays. A name several places bear answers destination_ambiguous, and a search too broad to price answers search_too_broad with its localities; each error says what to do next. The answer states what was searched, the counts and notes; a next page is the cursor and, optionally, limit.",
    annotations: READ,
    input: searchHotelsInput,
    output: searchResult,
  },
  {
    name: "get_hotel",
    title: "Hotel details",
    description:
      'One hotel\'s catalogue facts: names, address, coordinates, time zone, check-in and check-out times, the full description, every policy and the amenities, and its room types with include: "roomTypes". "Not listed" is not "no". No prices or availability: get_hotel_offers has those.',
    annotations: READ,
    input: getHotelInput,
    output: hotel,
  },
  {
    name: "get_hotel_offers",
    title: "Live offers",
    description: `Live, bookable offers for up to ${LIMITS.offersHotels} hotels and one stay. Every room in stay.rooms must have the same party: for different parties, call once per party. Each offer has the room type, the meals included, the total, in the request's currency, for the whole stay and every room (what is charged), with its average per room-night for comparison, fees payable at the property, the cancellation terms with times in UTC and the hotel's time zone, the confirmation mode, and an offerId for create_order with the time it expires. Hotels with nothing to offer are listed as unavailable with the reason. Up to limitPerHotel offers per hotel (default ${LIMITS.offersPerHotelDefault}, fewer when the call's hotels share its ${LIMITS.offersPerCallDefault} offers), picked to span price, free cancellation, breakfast and rooms, listed cheapest first; the answer says, per hotel, how many more a call for that hotel alone would show.`,
    annotations: READ,
    input: hotelOffersInput,
    output: hotelOffersResult,
  },
  {
    name: "create_order",
    title: "Create order",
    description: `Create an unpaid order for one offer from get_hotel_offers. It takes items, one item with the offer's offerId inside it (nowhere else in the arguments) and hotel.rooms, and contact. The answer is the order, awaiting payment: its reference, the total, the stay and its terms, and a payment link, a Fortrip page to pay on. Nothing is charged until the order is paid, on that page or with pay_order; anyone holding the link can pay. Send the contact and, for each room of the offer, at least one guest. If the price or terms changed since the offer, the answer is offer_changed with every change and a new offer: show the changes and ask the user again before ordering it. Sending the same details again returns the same order. An offer is ordered once: another order of the stay (another party, or a corrected guest name or contact) takes a new offer. cancel_order cancels or closes an order; for changes, or a cancellation it can't make, the user emails ${SUPPORT_EMAIL} with the order's reference.`,
    // Destructive: Claude's connector review asks `destructiveHint: true`
    // "for tools that modify or delete data", and a per-call confirmation
    // before an order is created is the behaviour wanted. Idempotent: the
    // same details answer the same order while the offer is held.
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
      destructiveHint: true,
    },
    input: createOrderInput,
    output: order,
  },
  {
    name: "get_order",
    title: "Get order",
    description:
      "One of the user's orders by orderId: its status, the payment status and, while it awaits payment, its payment link; the stay, its guests and its terms; whether it can be cancelled now, for which penalty and refund, or closed; why a failed order booked nothing and what a cancellation kept; and the hotel's confirmation number once there is one. It shows whether a payment went through.",
    annotations: READ_OWN,
    input: getOrderInput,
    output: order,
  },
  {
    name: "list_orders",
    title: "List orders",
    description:
      "The user's hotel orders, newest first, including those made on the Fortrip website, each as get_order shows it. A next page is the cursor the answer gives.",
    annotations: READ_OWN,
    input: listOrdersInput,
    output: orderList,
  },
  {
    name: "cancel_order",
    title: "Cancel order",
    description:
      "Cancel a paid order under its terms, or close an unpaid one. It takes the orderId and exactly one of maximumPenalty (a paid order) and close: true (an unpaid one). Paid (the order's Cancel line says it can be cancelled): only after the user confirmed the penalty and the refund on that line with a clear yes, pass maximumPenalty, that penalty exactly as shown. The order becomes cancelling, then cancelled with the refund on its way, or confirmed again if the hotel refuses. If the penalty rose above maximumPenalty, the answer is cancellation_changed and nothing changed. Unpaid (the Cancel line says it can be closed): close: true closes it: nothing is charged, and it can no longer be paid. A mode that does not fit the order (close on an order paid meanwhile) answers order_not_cancellable, which says which mode applies now or what blocks both: nothing is cancelled or closed by the other mode. While a payment is under way the answer is payment_in_progress. The same call again answers the order as it is.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
      destructiveHint: true,
    },
    input: cancelOrderInput,
    output: order,
  },
  {
    name: "pay_order",
    title: "Pay order",
    description:
      'Pay a USD order without its payment link, with a Stripe shared payment token: for an agent that can request one from the user\'s Link wallet (US and Canadian accounts), and for an order whose text has a "Pay without the link" line, which gives the business_profile and the usage limits to request the token with. Any other order is paid by its link. Call it only after the user confirmed the order\'s total and currency, the stay with each room\'s guests, the contact, any special requests and every term with a clear yes. It takes the orderId, the token as sharedPaymentToken and the order\'s total; a token pays one order. On success the order is confirming with its payment held, and its payment link stops working; a failure leaves the link open, and each error says how to recover.',
    // Destructive: it moves money, and the client is told so (spec D1).
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
      destructiveHint: true,
    },
    input: payOrderInput,
    output: order,
  },
];
