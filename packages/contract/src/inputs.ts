import { z } from "zod";

import { CARD_NUMBER_MESSAGE, containsCardNumber } from "./card-number.ts";
import { addIsoDateDays, countIsoDateDays, isIsoDate } from "./dates.ts";
import {
  childrenAges,
  flag,
  isoDate,
  nonEmpty,
  oneOf,
  positiveId,
  strictInput,
  text,
  wholeNumber,
} from "./fields.ts";
import {
  GUEST_NAME_MESSAGE,
  guestNameRe,
  normalizeGuestName,
} from "./guest-name.ts";
import { BOARD_CODES, CURRENCIES, LIMITS, SEARCH_SORTS } from "./limits.ts";

/*
 * What an agent may send. Each schema carries its own error messages (see
 * `fields.ts`) and a description on every field, nested ones included: the
 * descriptions reach MCP clients and the docs through the JSON Schema.
 * Failures that need no supplier call are caught here, so they answer 400
 * rather than looking like a transient outage.
 */

/** Longest facility name the search accepts, in characters. */
const FACILITY_NAME_MAX = 64;

/** Rooms per hotel a rates call returns when it doesn't say. */
const DEFAULT_MAX_ROOMS_PER_HOTEL = 10;

const stayDescriptions = {
  checkIn: "Check-in date, yyyy-MM-dd.",
  checkOut: `Check-out date, yyyy-MM-dd. Stays are 1 to ${LIMITS.nights} nights.`,
};

/** Prices are shown in this currency; it never changes what is charged. */
const displayCurrency = oneOf("currency", CURRENCIES)
  .default("CNY")
  .describe(
    "Currency to show prices in, converted from the supplier's at Stripe's exchange rate.",
  );

function bounded(name: string, min: number, max: number) {
  const error = `${name} must be a number from ${min} to ${max}`;
  return z.number({ error }).min(min, { error }).max(max, { error });
}

const queryError = `query must be text of 1 to ${LIMITS.queryLength} characters`;
const facilitiesError = `facilities must list 1 to ${LIMITS.facilities} catalogue facility names (1 to ${FACILITY_NAME_MAX} characters each)`;
const radiusError = `near.radiusKm must be more than 0, at most ${LIMITS.nearRadiusKm}`;

/** `POST /api/agent/v1/hotels/search` and the MCP `search_hotels` arguments. */
export const searchHotelsInput = strictInput({
  query: z
    .string({ error: queryError })
    .trim()
    .min(1, { error: queryError })
    .max(LIMITS.queryLength, { error: queryError })
    .optional()
    .describe(
      "Hotel name, brand or city to search for. Provide at least one of `query`, `cityCode` or `near`.",
    ),
  cityCode: positiveId("cityCode")
    .optional()
    .describe("Catalogue city code, as returned in `hotels[].cityCode`."),
  near: strictInput({
    lat: bounded("near.lat", -90, 90).describe("Latitude."),
    lng: bounded("near.lng", -180, 180).describe("Longitude."),
    radiusKm: z
      .number({ error: radiusError })
      .positive({ error: radiusError })
      .max(LIMITS.nearRadiusKm, { error: radiusError })
      .describe("Radius in kilometres."),
  })
    .optional()
    .describe("Search around a point."),
  starMin: bounded("starMin", 0, 5)
    .optional()
    .describe("Lowest star rating to include."),
  starMax: bounded("starMax", 0, 5)
    .optional()
    .describe("Highest star rating to include."),
  facilities: z
    .array(
      z
        .string({ error: facilitiesError })
        .trim()
        .min(1, { error: facilitiesError })
        .max(FACILITY_NAME_MAX, { error: facilitiesError }),
      { error: facilitiesError },
    )
    .min(1, { error: facilitiesError })
    .max(LIMITS.facilities, { error: facilitiesError })
    .transform((names) => [...new Set(names)])
    .optional()
    .describe(
      "Facilities every hotel must have. Names must match the catalogue exactly (case-insensitive), e.g. `Swimming pool`, `Parking`.",
    ),
  checkIn: isoDate("checkIn").describe(stayDescriptions.checkIn),
  checkOut: isoDate("checkOut").describe(stayDescriptions.checkOut),
  currency: displayCurrency,
  priceMin: z
    .number({ error: "priceMin must be a number, 0 or more" })
    .nonnegative({ error: "priceMin must be a number, 0 or more" })
    .optional()
    .describe(
      "Lowest average nightly price, in `currency`. Applied to indicative prices.",
    ),
  priceMax: z
    .number({ error: "priceMax must be a number above 0" })
    .positive({ error: "priceMax must be a number above 0" })
    .optional()
    .describe("Highest average nightly price, in `currency`."),
  sortBy: oneOf("sortBy", SEARCH_SORTS)
    .default("recommended")
    .describe(
      "Result order. `recommended` sorts by distance with `near`, by relevance with `query`, otherwise by catalogue weight. `distance` requires `near`.",
    ),
  page: wholeNumber("page", 1, LIMITS.page).default(1).describe("Page number."),
  pageSize: wholeNumber("pageSize", 1, LIMITS.pageSize)
    .default(20)
    .describe("Hotels per page."),
}).superRefine((input, ctx) => {
  if (!input.query && input.cityCode === undefined && !input.near) {
    ctx.addIssue({
      code: "custom",
      path: ["query"],
      message: "Provide query, cityCode or near",
    });
  }
  if (input.sortBy === "distance" && !input.near) {
    ctx.addIssue({
      code: "custom",
      path: ["sortBy"],
      message: "distance sort requires near",
    });
  }
  if (
    input.starMin !== undefined &&
    input.starMax !== undefined &&
    input.starMin > input.starMax
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["starMax"],
      message: "starMax must be >= starMin",
    });
  }
  if (
    input.priceMin !== undefined &&
    input.priceMax !== undefined &&
    input.priceMin > input.priceMax
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["priceMax"],
      message: "priceMax must be >= priceMin",
    });
  }
  if (!isIsoDate(input.checkIn) || !isIsoDate(input.checkOut)) return;
  // The supplier prices past dates; a UTC-yesterday floor still admits
  // travellers whose local date is ahead of UTC.
  const earliest = addIsoDateDays(new Date().toISOString().slice(0, 10), -1);
  if (input.checkIn < earliest) {
    ctx.addIssue({
      code: "custom",
      path: ["checkIn"],
      message: "checkIn must not be in the past",
    });
  }
  const nights = countIsoDateDays(input.checkIn, input.checkOut);
  if (nights < 1) {
    ctx.addIssue({
      code: "custom",
      path: ["checkOut"],
      message: "checkOut must be after checkIn",
    });
  } else if (nights > LIMITS.nights) {
    ctx.addIssue({
      code: "custom",
      path: ["checkOut"],
      message: `search supports at most ${LIMITS.nights} nights`,
    });
  }
});

/**
 * `GET /api/agent/v1/hotels/{id}` and the MCP `get_hotel` arguments. Not
 * strict: it has always dropped a key it doesn't know.
 */
export const getHotelInput = z.object(
  {
    hotelId: positiveId("hotelId").describe("hotelId from search_hotels"),
    includeRooms: flag("includeRooms")
      .optional()
      .describe("Also return the catalogue room list (adds a few KB)"),
  },
  { error: "Expected a JSON object" },
);

const hotelIdsError = `hotelIds must list 1 to ${LIMITS.ratesHotels} hotelIds`;
const boardCodesError = `boardCodes must list meal codes from: ${BOARD_CODES.join(", ")}`;

/** `POST /api/agent/v1/hotels/rates` and the MCP `get_rates` arguments. */
export const getRatesInput = strictInput({
  hotelIds: z
    .array(positiveId("Each hotelId"), { error: hotelIdsError })
    .min(1, { error: hotelIdsError })
    .max(LIMITS.ratesHotels, { error: hotelIdsError })
    .describe("Hotels to price. Each call takes about 15 seconds."),
  checkIn: isoDate("checkIn").describe(stayDescriptions.checkIn),
  checkOut: isoDate("checkOut").describe(stayDescriptions.checkOut),
  rooms: wholeNumber("rooms", 1, LIMITS.rooms).describe(
    "Number of rooms; every room has the same occupancy",
  ),
  adults: wholeNumber("adults (per room)", 1, LIMITS.adultsPerRoom).describe(
    "Adults per room, not in total (2 rooms for 4 adults = rooms 2, adults 2)",
  ),
  childrenAges: childrenAges(LIMITS.childrenPerRoom)
    .optional()
    .describe("Age of each child in one room (0-17), per room"),
  nationality: z
    .string({ error: "nationality must be a 2-letter ISO 3166-1 code" })
    .regex(/^[A-Z]{2}$/, {
      error: "nationality must be a 2-letter ISO 3166-1 code, upper case",
    })
    .optional()
    .describe(
      "Guest nationality, ISO 3166-1 alpha-2. Some rates are restricted by nationality; booking doesn't send it, so such a rate may change or be refused at booking",
    ),
  currency: displayCurrency,
  // One hotel can return thousands of rate plans; these keep a response
  // small enough for an agent's context.
  bookableOnly: flag("bookableOnly")
    .default(true)
    .describe("Keep only rates that are bookable on every night."),
  boardCodes: z
    .array(oneOf("Each boardCode", BOARD_CODES), { error: boardCodesError })
    .min(1, { error: boardCodesError })
    .optional()
    .describe(
      "Keep only these meal plans: `RO` room only, `BB` breakfast, `HB` half board, `FB` full board, `AI` all inclusive, and so on.",
    ),
  freeCancellation: flag("freeCancellation")
    .optional()
    .describe(
      "Keep only rates that can still be cancelled free of charge right now.",
    ),
  maxRoomsPerHotel: wholeNumber("maxRoomsPerHotel", 1, LIMITS.maxRoomsPerHotel)
    .default(DEFAULT_MAX_ROOMS_PER_HOTEL)
    .describe(
      "Return the N cheapest rooms per hotel. The MCP tool defaults to 5, the CLI to 10.",
    ),
}).superRefine((input, ctx) => {
  if (!isIsoDate(input.checkIn) || !isIsoDate(input.checkOut)) return;
  const nights = countIsoDateDays(input.checkIn, input.checkOut);
  if (nights < 1) {
    ctx.addIssue({
      code: "custom",
      path: ["checkOut"],
      message: "checkOut must be after checkIn",
    });
  } else if (nights > LIMITS.nights) {
    ctx.addIssue({
      code: "custom",
      path: ["checkOut"],
      message: `rates support at most ${LIMITS.nights} nights`,
    });
  }
});

/** Free text that must not carry a payment card number: payment happens
 *  only on the payment page, so a card typed here would only be stored and
 *  sent to the hotel. `minDigits` is the shortest card looked for. */
function cardFreeText(
  name: string,
  min: number,
  max: number,
  minDigits?: number,
) {
  // `abort`: a card in a name is reported as a card, not also as a name.
  return text(name, min, max).refine(
    (value) => !containsCardNumber(value, minDigits),
    { error: CARD_NUMBER_MESSAGE, abort: true },
  );
}

/** A guest's first or last name, held to the booking action's own rule
 *  (Latin letters as on the passport, after the same normalising) so a
 *  refusal is a 400 that says why rather than the action's 422. */
function guestName(name: string) {
  return cardFreeText(name, 1, LIMITS.guestName)
    .refine((value) => normalizeGuestName(value) !== "", {
      error: `${name} must not be blank`,
    })
    .refine(
      (value) => {
        const normalized = normalizeGuestName(value);
        return normalized === "" || guestNameRe.test(normalized);
      },
      { error: GUEST_NAME_MESSAGE },
    );
}

const guestsError = "guests must list at least one guest per room";
const roomNoError = `roomNo must be a whole number from 1 to ${LIMITS.rooms}`;
const contactEmailError = "contactEmail must be an email address";

/**
 * `POST /api/agent/v1/hotels/bookings` and the MCP `create_booking`
 * arguments. The booking action validates guest names (Latin letters) and
 * the room assignment again. Occupancy is per room, every room the same.
 * Unknown keys are refused, not dropped: a misspelled `children` would
 * otherwise book the default `childrenAges: []`, a different party.
 */
export const createBookingInput = strictInput({
  hotelId: positiveId("hotelId").describe("Hotel id."),
  roomId: nonEmpty("roomId").describe("roomId from get_rates"),
  ratePlanCode: nonEmpty("ratePlanCode").describe(
    "ratePlanCode from get_rates",
  ),
  checkIn: isoDate("checkIn").describe("yyyy-MM-dd"),
  checkOut: isoDate("checkOut").describe("yyyy-MM-dd"),
  rooms: wholeNumber("rooms", 1, LIMITS.rooms).describe(
    "Number of rooms, as in get_rates; every room has the same occupancy",
  ),
  adults: wholeNumber("adults (per room)", 1, LIMITS.adultsPerRoom).describe(
    "Adults per room, not in total, as in get_rates (2 rooms for 4 adults = rooms 2, adults 2)",
  ),
  childrenAges: childrenAges(LIMITS.childrenPerRoom)
    .default([])
    .describe(
      "Age of each child in one room (0-17), per room, as in get_rates",
    ),
  guests: z
    .array(
      strictInput({
        firstName: guestName("firstName").describe("First name."),
        lastName: guestName("lastName").describe("Last name."),
        // A numeric string ("1") booked before; the action takes either.
        roomNo: z.coerce
          .number({ error: roomNoError })
          .int({ error: roomNoError })
          .min(1, { error: roomNoError })
          .max(LIMITS.rooms, { error: roomNoError })
          .describe("1-based room number"),
      }),
      { error: guestsError },
    )
    .min(1, { error: guestsError })
    .describe(
      "At least one guest per room, Latin letters only as on the passport",
    ),
  contactName: cardFreeText("contactName", 1, LIMITS.contactName).describe(
    "Contact person for the booking.",
  ),
  // Only cards of 16+ digits: a phone number has at most 15 (E.164), so
  // its digits aren't mistaken for a card.
  contactPhone: cardFreeText(
    "contactPhone",
    LIMITS.contactPhoneMin,
    LIMITS.contactPhoneMax,
    16,
  ).describe("Contact phone number."),
  // Blank means none, as it did before: the booking sends no email then.
  contactEmail: z
    .string({ error: contactEmailError })
    .trim()
    .refine((value) => value === "" || z.email().safeParse(value).success, {
      error: contactEmailError,
    })
    .optional()
    .describe("Contact email."),
  specialRequests: cardFreeText("specialRequests", 0, LIMITS.specialRequests)
    .optional()
    .describe("English only; not guaranteed"),
}).superRefine((input, ctx) => {
  // Here, not at the supplier client: a reversed or same-day stay would
  // otherwise spend a rate-limit token and read "at most 15 nights".
  if (!isIsoDate(input.checkIn) || !isIsoDate(input.checkOut)) return;
  const nights = countIsoDateDays(input.checkIn, input.checkOut);
  if (nights < 1) {
    ctx.addIssue({
      code: "custom",
      path: ["checkOut"],
      message: "checkOut must be after checkIn",
    });
  } else if (nights > LIMITS.nights) {
    ctx.addIssue({
      code: "custom",
      path: ["checkOut"],
      message: `A booking covers at most ${LIMITS.nights} nights; book a longer stay as separate bookings`,
    });
  }
});

/** What a caller sends (defaults optional), and what a handler gets once parsed. */
export type SearchHotelsInput = z.input<typeof searchHotelsInput>;
export type SearchHotelsParsed = z.output<typeof searchHotelsInput>;
export type GetHotelInput = z.input<typeof getHotelInput>;
export type GetHotelParsed = z.output<typeof getHotelInput>;
export type GetRatesInput = z.input<typeof getRatesInput>;
export type GetRatesParsed = z.output<typeof getRatesInput>;
export type CreateBookingInput = z.input<typeof createBookingInput>;
export type CreateBookingParsed = z.output<typeof createBookingInput>;
