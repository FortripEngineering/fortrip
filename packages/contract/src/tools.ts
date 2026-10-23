import { z } from "zod";

import {
  createOrderInput,
  getHotelInput,
  getOrderInput,
  hotelOffersInput,
  listOrdersInput,
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
  | "get_planning_guide"
  | "search_hotels"
  | "get_hotel"
  | "get_hotel_offers"
  | "book_hotel"
  | "get_order"
  | "list_orders";

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
  /** What the tool takes; `null` for a tool without arguments. */
  input: z.ZodType | null;
  /** The open schema of what it answers with; `null` for the guide. */
  output: z.ZodType | null;
}

/**
 * The consent rule (spec §6). It rides on every MCP result that holds a
 * non-null `payment.url`, as `nextStep` and as the last paragraph of the
 * text: some clients never show the model the server instructions.
 */
export const ORDER_NEXT_STEP =
  "Before you give the user an order's payment.url, show them its total and currency, the stay (hotel, room, dates, rooms and guests per room) and every term (meals, cancellation, fees payable at the property), then end your reply by asking them to confirm, and wait for a clear yes. Only after they say yes, give them payment.url exactly as returned.";

const nextStep = z
  .string()
  .optional()
  .describe(
    "What to show and ask before giving a payment.url. Present when the answer holds a non-null payment.url.",
  );

/** The answers over MCP that can hold a `payment.url`: the HTTP answer plus
 *  `nextStep`, which only MCP declares. */
export const MCP_OUTPUT = {
  book_hotel: order.extend({ nextStep }),
  get_order: order.extend({ nextStep }),
  list_orders: orderList.extend({ nextStep }),
} as const satisfies Record<
  "book_hotel" | "get_order" | "list_orders",
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
    name: "get_planning_guide",
    title: "Get hotel planning guide",
    description:
      'Returns Fortrip\'s planning guide for a request that is more than one hotel for fixed dates (flexible dates, a budget, split stays, several destinations, "find me the best"): what to ask the user, which results count as evidence, how to rank and how to present options.',
    annotations: READ_OWN,
    input: null,
    output: null,
  },
  {
    name: "search_hotels",
    title: "Search hotels",
    description:
      "Find hotels by destination and/or text, with an indicative per-room-night price when a stay is given. destination is a place_name with its countryCode, a place or locality by placeId from an earlier answer, a point, or a country. A name several places bear answers destination_ambiguous with candidates: ask the user, then search the chosen placeId. text matches hotel names, brands and areas word for word. Indicative prices are estimates and not bookable: get_hotel_offers returns what the user pays. A search too broad to answer is refused with search_too_broad and its localities: pass one back as { kind: \"locality\", placeId }, never by name. The answer states the scope, the counts and notes; a next page is { cursor } alone.",
    annotations: READ,
    input: searchHotelsInput,
    output: searchResult,
  },
  {
    name: "get_hotel",
    title: "Get hotel details",
    description:
      'One hotel\'s catalogue facts: names, address, location, time zone, check-in and check-out times, the full description, every policy and the amenities, and its rooms with include: "rooms". "Not listed" is not "no". No prices or availability: get_hotel_offers has those.',
    annotations: READ,
    input: getHotelInput,
    output: hotel,
  },
  {
    name: "get_hotel_offers",
    title: "Get live hotel offers",
    description: `Live, bookable offers for up to ${LIMITS.offersHotels} hotels and one stay. Every room in stay.rooms must have the same party: for different parties, call once per party. Each offer has the room, the meals included, price.total in USD for the whole stay and every room (what is charged), fees payable at the property, the cancellation terms with times in UTC and the hotel's time zone, the confirmation mode, and an offerId for book_hotel that expires at expiresAt. Hotels with nothing to offer are listed under unavailable with the reason. Up to limitPerHotel offers per hotel, default ${LIMITS.offersPerHotelDefault}, cheapest first.`,
    annotations: READ,
    input: hotelOffersInput,
    output: hotelOffersResult,
  },
  {
    name: "book_hotel",
    title: "Create hotel order and payment link",
    description: `Order one offer from get_hotel_offers. The answer is an unpaid order with a payment link: status awaiting_payment, the total, the stay and its terms, and payment.url, a Fortrip page where the user pays. Nothing is charged until the user pays there; anyone holding the link can pay. Send the contact and, for each room of the offer, at least one guest. If the price or terms changed since the offer, the answer is offer_changed with every change and a new offer: show the changes and ask the user again before ordering it. Sending the same details again returns the same order. This tool can't change or cancel an order: for changes, cancellations or refunds the user emails ${SUPPORT_EMAIL} with the order's reference.`,
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
      "One of the user's orders by orderId: its status, the payment status and, while it awaits payment, payment.url; the stay and its terms; and the hotel's confirmation number once there is one. Check it after the user pays. An order awaiting payment whose payment.url is null had its link unreadable this time: read it again.",
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
];
