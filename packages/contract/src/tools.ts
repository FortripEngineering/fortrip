import { z } from "zod";

import { wholeNumber } from "./fields.ts";
import {
  createBookingInput,
  getHotelInput,
  getRatesInput,
  searchHotelsInput,
} from "./inputs.ts";
import { LIMITS, SUPPORT_EMAIL } from "./limits.ts";
import { bookingResult } from "./outputs.ts";

/*
 * The MCP tools every agent surface describes: what the hosted server
 * registers, and what the docs and the guide name. Wording here is what MCP
 * clients show the model, so it speaks in tool names and field names.
 */

export type ToolName =
  | "get_planning_guide"
  | "search_hotels"
  | "get_hotel"
  | "get_rates"
  | "create_booking";

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
  /** What it answers with, when that is a schema; `null` otherwise. */
  output: z.ZodType | null;
}

/** Rooms per hotel an MCP `get_rates` returns when it doesn't say: half the
 *  HTTP default, to keep the answer small in a model's context. */
const MCP_MAX_ROOMS_PER_HOTEL = 5;

/** `getRatesInput` as the MCP tool takes it: the same, with its own default
 *  for `maxRoomsPerHotel`. */
export const MCP_RATES_INPUT = getRatesInput.safeExtend({
  maxRoomsPerHotel: wholeNumber("maxRoomsPerHotel", 1, LIMITS.maxRoomsPerHotel)
    .default(MCP_MAX_ROOMS_PER_HOTEL)
    .describe(
      `Return the N cheapest rooms per hotel. Defaults to ${MCP_MAX_ROOMS_PER_HOTEL}.`,
    ),
});

/** Rides on every create_booking answer: some clients never show the model
 *  the server instructions. */
export const BOOKING_NEXT_STEP =
  "Show the user amount, currency, the stay (hotel, room, dates, rooms, guests per room) and every item in terms (meals, cancellation, confirmation, pay-at-hotel fees), then end your reply by asking them to confirm. Only after they say yes, give them paymentUrl exactly as returned.";

/** create_booking's answer over MCP: the booking result plus `nextStep`. */
export const MCP_BOOKING_RESULT = bookingResult.extend({
  nextStep: z.string(),
});

/** What `boardCode` means, in get_rates and in create_booking's terms. */
const MEAL_CODES =
  "RO room only; BB breakfast; HB breakfast + dinner; FB breakfast + lunch + dinner; BL lunch; BD dinner; HBBL breakfast + lunch; HBLD lunch + dinner; AI all inclusive";

export const TOOLS: readonly ToolSpec[] = [
  {
    name: "get_planning_guide",
    title: "Get hotel planning guide",
    description:
      'Returns Fortrip\'s planning guide for a request that is more than one hotel for fixed dates (flexible dates, a budget, split stays, several destinations, "find me the best"): what to ask the user, which results count as evidence, how to rank and how to present options.',
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
    input: null,
    output: null,
  },
  {
    name: "search_hotels",
    title: "Search hotels",
    description:
      "Find hotels by name/brand/city text (query), catalogue cityCode or coordinates (near), with per-night prices for the dates in currency (CNY by default, or USD). Those prices come from the supplier's minimum-price feed, not live rates; get_rates returns the bookable price. facilities must match catalogue names exactly. Refused (422) when more than 30,000 hotels match: narrow the search.",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
    input: searchHotelsInput,
    output: null,
  },
  {
    name: "get_hotel",
    title: "Get hotel details",
    description:
      "Static catalogue facts for one hotel: address, contact, intro, check-in/out times, policies, facilities and photos. No prices or availability.",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
    input: getHotelInput,
    output: null,
  },
  {
    name: "get_rates",
    title: "Get live rates",
    description: `Live rooms and rate plans for up to ${LIMITS.ratesHotels} hotels, prices in currency (CNY by default, or USD) at Stripe's exchange rate. rooms, adults and childrenAges are per room: every room has the same occupancy. Each room carries its catalogue facts (static) and the cheapest rate per meal plan × free-cancellation variant, with roomId and ratePlanCode for create_booking. boardCode is the meal plan (${MEAL_CODES}); boardCount is how many guests per room it covers: fewer than adults per room means the meals don't cover everyone (BB with boardCount 1 for 2 adults is breakfast for 1 of 2). Takes about 15 seconds; query a few hotels at a time. Returns the ${MCP_MAX_ROOMS_PER_HOTEL} cheapest rooms per hotel unless maxRoomsPerHotel says otherwise.`,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
    input: MCP_RATES_INPUT,
    output: null,
  },
  {
    name: "create_booking",
    title: "Create booking payment link",
    description: `Create (or resume) a booking for one rate from get_rates, with the same rooms, adults and childrenAges (per room). Returns the amount and currency the user will be charged, the accepted terms (meal plan, cancellation, confirmation, pay-at-hotel fees), the stay as booked, and paymentUrl: a Fortrip page that recaps the booking and continues to payment. Nothing is charged until the user pays there; anyone holding paymentUrl can pay. The same user and stay always returns the same order; a stay that is already paid returns 409. This tool can't change or cancel a booking: for changes, cancellations or refunds the user emails ${SUPPORT_EMAIL} with the booking's orderUrl. Can take up to about two minutes; if the call times out, call it again with the same details — it resumes the same order.`,
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
    input: createBookingInput,
    output: MCP_BOOKING_RESULT,
  },
];
