import { z } from "zod";

import { CARD_NUMBER_MESSAGE, containsCardNumber } from "./card-number.ts";
import { addIsoDateDays, countIsoDateDays, isIsoDate } from "./dates.ts";
import { hotelId, offerId, orderId, placeId } from "./conventions/ids.ts";
import { usdMoney } from "./conventions/money.ts";
import { localDate } from "./conventions/time.ts";
import {
  flag,
  nonEmpty,
  oneOf,
  strictInput,
  text,
  wholeNumber,
} from "./fields.ts";
import {
  GUEST_NAME_MESSAGE,
  guestNameRe,
  normalizeGuestName,
} from "./guest-name.ts";
import { LIMITS_V1 } from "./limits.ts";

/*
 * What an agent may send to API v1 (spec §7.1, §8, §9.1, §10.1, §10.5). Every
 * schema is strict (an unknown key is named, never dropped), carries its own
 * messages (see `fields.ts`) and describes every leaf: the descriptions reach
 * MCP clients and the docs through the JSON Schema. Whatever needs no catalogue
 * or supplier to decide is decided here and answers 400. Offers and orders do
 * not compare their dates with today: the service does, in the hotel's zone.
 */

/** Amenity codes a search can filter by (§7.7), in the order they are listed. */
export const FILTERABLE_AMENITIES = [
  "parking",
  "wifi",
  "laundry",
  "restaurant",
  "room_service",
  "bar",
  "non_smoking",
  "business_center",
  "pool",
] as const;

/** Every amenity code a response can carry: the filterable ones, then the
 *  response-only ones and `other`. A search that filters by a response-only
 *  code is refused by the service with details (§7.7). */
export const AMENITY_CODES = [
  ...FILTERABLE_AMENITIES,
  "airport_shuttle",
  "spa",
  "gym",
  "accessible",
  "ev_charging",
  "air_conditioning",
  "pets_allowed",
  "kitchen",
  "other",
] as const;

export type FilterableAmenity = (typeof FILTERABLE_AMENITIES)[number];
export type AmenityCode = (typeof AMENITY_CODES)[number];

const SEARCH_SORT_VALUES = [
  "distance",
  "relevance",
  "stars_desc",
  "price_asc",
  "price_desc",
] as const;

const locale = oneOf("locale", ["en", "zh"] as const).describe(
  "Language for names and text in the response: en or zh.",
);

const displayCurrency = oneOf("displayCurrency", [
  "USD",
  "CNY",
] as const).describe(
  "Currency to show prices in, USD or CNY. It never changes what is charged: payment is in USD.",
);

/** An opaque cursor from a previous response. */
const cursor = nonEmpty("cursor");

// ---------------------------------------------------------------------------
// Stay

const nightsError = (name: string) =>
  `${name} must be after the check-in date and at most ${LIMITS_V1.nightsFortrip} nights later`;

export const stay = strictInput({
  checkIn: localDate.describe(
    "Check-in date in the hotel's calendar, yyyy-MM-dd.",
  ),
  checkOut: localDate.describe(
    `Check-out date in the hotel's calendar, yyyy-MM-dd. Stays are 1 to ${LIMITS_V1.nightsFortrip} nights.`,
  ),
  rooms: z
    .array(
      strictInput({
        adults: wholeNumber("adults", 1, LIMITS_V1.adultsPerRoom).describe(
          "Adults in this room.",
        ),
        childrenAges: z
          .array(wholeNumber("Each child's age", 0, LIMITS_V1.childAgeMax), {
            error: `childrenAges must list each child's age (0 to ${LIMITS_V1.childAgeMax}) in this room, at most ${LIMITS_V1.childrenPerRoom}`,
          })
          .max(LIMITS_V1.childrenPerRoom, {
            error: `childrenAges must list each child's age (0 to ${LIMITS_V1.childAgeMax}) in this room, at most ${LIMITS_V1.childrenPerRoom}`,
          })
          .describe(
            "Age of each child in this room, 0 to 17. An empty list means no children.",
          ),
      }),
      { error: `rooms must list 1 to ${LIMITS_V1.rooms} rooms` },
    )
    .min(1, { error: `rooms must list 1 to ${LIMITS_V1.rooms} rooms` })
    .max(LIMITS_V1.rooms, {
      error: `rooms must list 1 to ${LIMITS_V1.rooms} rooms`,
    })
    .describe(
      `The rooms wanted, 1 to ${LIMITS_V1.rooms}, each with its own party.`,
    ),
}).superRefine((value, ctx) => {
  if (!isIsoDate(value.checkIn) || !isIsoDate(value.checkOut)) return;
  const nights = countIsoDateDays(value.checkIn, value.checkOut);
  if (nights < 1 || nights > LIMITS_V1.nightsFortrip) {
    ctx.addIssue({
      code: "custom",
      path: ["checkOut"],
      message: nightsError("checkOut"),
    });
  }
});

export type Stay = z.infer<typeof stay>;

// ---------------------------------------------------------------------------
// Destination

const countryCode = z
  .string({ error: "countryCode must be an ISO 3166-1 alpha-2 code" })
  .regex(/^[A-Z]{2}$/, {
    error: "countryCode must be 2 uppercase letters (ISO 3166-1 alpha-2)",
  });

const radiusMeters = wholeNumber("radiusMeters", 1, LIMITS_V1.radiusMetersMax)
  .optional()
  .describe(
    `Search radius around the destination in meters, 1 to ${LIMITS_V1.radiusMetersMax}. Left out, the service picks one.`,
  );

function bounded(name: string, min: number, max: number) {
  const error = `${name} must be a number from ${min} to ${max}`;
  return z.number({ error }).min(min, { error }).max(max, { error });
}

const KINDS = ["place_name", "place", "point", "country", "locality"] as const;

export const destination = z.discriminatedUnion(
  "kind",
  [
    strictInput({
      kind: z
        .literal("place_name", { error: "kind must be place_name" })
        .describe("A place named in words, with its country."),
      name: text("name", 1, LIMITS_V1.textLength).describe(
        "The place name, in any language, e.g. Tokyo or 东京.",
      ),
      countryCode: countryCode.describe(
        "ISO 3166-1 alpha-2 country the place is in, e.g. JP.",
      ),
      radiusMeters,
    }),
    strictInput({
      kind: z
        .literal("place", { error: "kind must be place" })
        .describe("A place id from an earlier response."),
      placeId: placeId.describe("placeId from an earlier response."),
      radiusMeters,
    }),
    strictInput({
      kind: z
        .literal("point", { error: "kind must be point" })
        .describe("A point on the map."),
      location: strictInput({
        lat: bounded("lat", -90, 90).describe("Latitude, WGS84."),
        lng: bounded("lng", -180, 180).describe("Longitude, WGS84."),
      }).describe("The point, WGS84."),
      radiusMeters,
    }),
    strictInput({
      kind: z
        .literal("country", { error: "kind must be country" })
        .describe("A whole country."),
      countryCode: countryCode.describe("ISO 3166-1 alpha-2 country, e.g. JP."),
    }),
    strictInput({
      kind: z
        .literal("locality", { error: "kind must be locality" })
        .describe("A locality (hub) listed in an earlier search response."),
      placeId: placeId.describe("placeId of the locality."),
      radiusMeters,
    }),
  ],
  {
    error: `destination.kind must be one of: ${KINDS.join(", ")}`,
  },
);

export type Destination = z.infer<typeof destination>;

// ---------------------------------------------------------------------------
// Search

const textQuery = z
  .string({
    error: `text must be text of 1 to ${LIMITS_V1.textLength} characters`,
  })
  .trim()
  .min(1, {
    error: `text must be text of 1 to ${LIMITS_V1.textLength} characters`,
  })
  .max(LIMITS_V1.textLength, {
    error: `text must be text of 1 to ${LIMITS_V1.textLength} characters`,
  });

const starsError = "must be from 1 to 5 in steps of 0.5";

function starBound(name: string) {
  return z
    .number({ error: `${name} ${starsError}` })
    .min(1, { error: `${name} ${starsError}` })
    .max(5, { error: `${name} ${starsError}` })
    .refine((value) => Number.isInteger(value * 2), {
      error: `${name} ${starsError}`,
    });
}

const amenitiesError = `amenities must list 1 to ${LIMITS_V1.amenityFilters} codes from: ${AMENITY_CODES.join(", ")}`;

const searchFilters = strictInput({
  stars: strictInput({
    min: starBound("stars.min")
      .optional()
      .describe("Lowest star rating, 1 to 5 in steps of 0.5."),
    max: starBound("stars.max")
      .optional()
      .describe("Highest star rating, 1 to 5 in steps of 0.5."),
  })
    .superRefine((value, ctx) => {
      if (
        value.min !== undefined &&
        value.max !== undefined &&
        value.min > value.max
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["max"],
          message: "stars.max must be at least stars.min",
        });
      }
    })
    .optional()
    .describe(
      "Star rating range. Unrated hotels are left out whenever it is set.",
    ),
  amenities: z
    .array(oneOf("Each amenity", AMENITY_CODES), { error: amenitiesError })
    .min(1, { error: amenitiesError })
    .max(LIMITS_V1.amenityFilters, { error: amenitiesError })
    .optional()
    .describe(
      "Amenities every hotel must list. Only some codes can filter; asking for one that cannot is answered with the list that can.",
    ),
  price: strictInput({
    maxPerRoomNight: usdMoney.describe(
      "Highest price per room per night, in USD.",
    ),
  })
    .optional()
    .describe("Price limit. Needs indicative pricing, so a stay."),
})
  .optional()
  .describe("Filters every hotel in the answer must pass.");

/** A next page carries these and nothing else. */
const NEXT_PAGE_KEYS = new Set(["cursor", "limit"]);

/**
 * The search request, with the clock that decides "not before today at UTC-12"
 * (C5: the earliest calendar date on Earth) injectable for tests.
 */
export function createSearchHotelsInput(now: () => number = Date.now) {
  return strictInput({
    destination: destination
      .optional()
      .describe("Where to search. A first page needs this or `text`."),
    text: textQuery
      .optional()
      .describe(
        `Hotel name, brand or area to match, 1 to ${LIMITS_V1.textLength} characters. A first page needs this or \`destination\`.`,
      ),
    stay: stay
      .optional()
      .describe(
        "Dates and party. Needed for indicative prices. Search uses only the dates when the rooms differ.",
      ),
    pricing: oneOf("pricing", ["indicative", "none"] as const)
      .optional()
      .describe(
        "`indicative` adds an approximate price per hotel and needs a stay; `none` skips prices. Default: indicative with a stay, otherwise none.",
      ),
    filters: searchFilters,
    sort: oneOf("sort", SEARCH_SORT_VALUES)
      .optional()
      .describe(
        "Result order. `distance` needs a destination, `relevance` needs `text`, `price_asc` and `price_desc` need indicative pricing. Default: relevance with `text`, otherwise distance.",
      ),
    limit: wholeNumber("limit", 1, LIMITS_V1.pageSizeMax)
      .optional()
      .describe(
        `Hotels per page, 1 to ${LIMITS_V1.pageSizeMax}. Default ${LIMITS_V1.pageSizeDefault}.`,
      ),
    cursor: cursor
      .optional()
      .describe(
        "`nextCursor` from the previous response. A next page is the cursor and, optionally, `limit`; nothing else.",
      ),
    locale: locale.optional(),
    displayCurrency: displayCurrency.optional(),
  }).superRefine((input, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    if (input.cursor !== undefined) {
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined && !NEXT_PAGE_KEYS.has(key)) {
          issue(
            [key],
            `${key} cannot be sent with cursor: a next page is the cursor and limit only`,
          );
        }
      }
      return;
    }

    if (input.destination === undefined && input.text === undefined) {
      issue(["destination"], "Provide a destination or text");
    }
    if (input.sort === "distance" && input.destination === undefined) {
      issue(["sort"], "sort distance needs a destination");
    }
    if (input.sort === "relevance" && input.text === undefined) {
      issue(["sort"], "sort relevance needs text");
    }

    const indicative =
      (input.pricing ?? (input.stay ? "indicative" : "none")) === "indicative";
    if (input.pricing === "indicative" && input.stay === undefined) {
      issue(["stay"], "pricing indicative needs a stay");
    }
    if (!indicative) {
      const reason =
        input.pricing === "none" ? 'pricing is "none"' : "there is no stay";
      if (input.sort === "price_asc" || input.sort === "price_desc") {
        issue(
          ["sort"],
          `${input.sort} needs indicative pricing, but ${reason}`,
        );
      }
      if (input.filters?.price !== undefined) {
        issue(
          ["filters", "price"],
          `filters.price needs indicative pricing, but ${reason}`,
        );
      }
    }

    const checkIn = input.stay?.checkIn;
    if (checkIn !== undefined && isIsoDate(checkIn)) {
      // The earliest calendar date on Earth is the date at UTC-12.
      const earliest = new Date(now() - 12 * 3_600_000)
        .toISOString()
        .slice(0, 10);
      if (checkIn < earliest) {
        issue(["stay", "checkIn"], "stay.checkIn must not be in the past");
      }
    }
  });
}

/** `POST /v1/hotels/search` and the MCP `search_hotels` arguments. */
export const searchHotelsInput = createSearchHotelsInput();

export type SearchHotelsInput = z.input<typeof searchHotelsInput>;

// ---------------------------------------------------------------------------
// Hotel detail

/** `GET /v1/hotels/{hotelId}` and the MCP `get_hotel` arguments. */
export const getHotelInput = strictInput({
  hotelId: hotelId.describe("hotelId from a search response."),
  include: oneOf("include", ["rooms"] as const)
    .optional()
    .describe("`rooms` adds the room list."),
  locale: locale.optional(),
});

export type GetHotelInput = z.input<typeof getHotelInput>;

// ---------------------------------------------------------------------------
// Offers

const hotelIdsError = `hotelIds must list 1 to ${LIMITS_V1.offersHotels} distinct hotelIds`;

/** `POST /v1/hotels/offers` and the MCP `get_offers` arguments. */
export const hotelOffersInput = strictInput({
  hotelIds: z
    .array(hotelId, { error: hotelIdsError })
    .min(1, { error: hotelIdsError })
    .max(LIMITS_V1.offersHotels, { error: hotelIdsError })
    .refine((ids) => new Set(ids).size === ids.length, {
      error: hotelIdsError,
    })
    .describe(`Hotels to price, 1 to ${LIMITS_V1.offersHotels}, no repeats.`),
  stay: stay.describe(
    "Dates and party. One party per call: every room must be the same.",
  ),
  filters: strictInput({
    requireBreakfast: flag("requireBreakfast")
      .optional()
      .describe("Keep only offers that include breakfast."),
    requireFreeCancellation: flag("requireFreeCancellation")
      .optional()
      .describe("Keep only offers that can still be cancelled free of charge."),
  })
    .optional()
    .describe("Filters every offer must pass."),
  limitPerHotel: wholeNumber("limitPerHotel", 1, LIMITS_V1.offersPerHotelMax)
    .default(LIMITS_V1.offersPerHotelDefault)
    .describe(
      `Offers per hotel, 1 to ${LIMITS_V1.offersPerHotelMax}. Default ${LIMITS_V1.offersPerHotelDefault}.`,
    ),
  locale: locale.optional(),
  displayCurrency: displayCurrency.optional(),
});

export type HotelOffersInput = z.input<typeof hotelOffersInput>;

// ---------------------------------------------------------------------------
// Orders

/** Free text that must not carry a payment card number: payment happens only
 *  on the payment page. `minDigits` is the shortest card looked for. */
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

/** A guest's first or last name: Latin letters as on the passport, after the
 *  same normalizing the order applies. */
function guestName(name: string) {
  return cardFreeText(name, 1, LIMITS_V1.guestName)
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

/** A contact's first or last name: any script, at most `max` characters once
 *  normalized, so the joined name fits the order core's limit. */
function contactName(name: string, max: number) {
  return z
    .string({ error: `${name} must be text of 1 to ${max} characters` })
    .refine((value) => !containsCardNumber(value), {
      error: CARD_NUMBER_MESSAGE,
      abort: true,
    })
    .refine(
      (value) => {
        const length = normalizeGuestName(value).length;
        return length >= 1 && length <= max;
      },
      { error: `${name} must be text of 1 to ${max} characters` },
    );
}

const emailError = "email must be an email address";
const guestsError = "guests must list at least one guest per room";
const maxGuestsPerRoom = LIMITS_V1.adultsPerRoom + LIMITS_V1.childrenPerRoom;

/** `POST /v1/orders` and the MCP `book_hotel` arguments. */
export const createOrderInput = strictInput({
  contact: strictInput({
    firstName: contactName("firstName", LIMITS_V1.contactFirstName).describe(
      `Contact person's first name, at most ${LIMITS_V1.contactFirstName} characters.`,
    ),
    lastName: contactName("lastName", LIMITS_V1.contactLastName).describe(
      `Contact person's last name, at most ${LIMITS_V1.contactLastName} characters.`,
    ),
    email: z
      .string({ error: emailError })
      .trim()
      .pipe(z.email({ error: emailError }))
      .describe("Contact email; the confirmation is sent here."),
    // Only cards of 16+ digits: a phone number has at most 15 (E.164).
    phone: cardFreeText(
      "phone",
      LIMITS_V1.contactPhoneMin,
      LIMITS_V1.contactPhoneMax,
      16,
    ).describe("Contact phone number, with country code."),
  }).describe("Who the hotel and the confirmation reach."),
  items: z
    .array(
      strictInput({
        offerId: offerId.describe("offerId from get_offers."),
        hotel: strictInput({
          rooms: z
            .array(
              strictInput({
                guests: z
                  .array(
                    strictInput({
                      firstName: guestName("firstName").describe(
                        "Guest's first name, in Latin letters as on the passport; transliterate accents (Müller → Mueller).",
                      ),
                      lastName: guestName("lastName").describe(
                        "Guest's last name, in Latin letters as on the passport.",
                      ),
                    }),
                    { error: guestsError },
                  )
                  .min(1, { error: guestsError })
                  .max(maxGuestsPerRoom, {
                    error: `guests must list at most ${maxGuestsPerRoom} guests per room`,
                  })
                  .describe(
                    "Guests staying in this room: at least one, no more than the room sleeps.",
                  ),
              }),
              { error: `rooms must list 1 to ${LIMITS_V1.rooms} rooms` },
            )
            .min(1, { error: `rooms must list 1 to ${LIMITS_V1.rooms} rooms` })
            .max(LIMITS_V1.rooms, {
              error: `rooms must list 1 to ${LIMITS_V1.rooms} rooms`,
            })
            .describe("One entry per room of the offer, in order."),
          specialRequests: cardFreeText(
            "specialRequests",
            0,
            LIMITS_V1.specialRequests,
          )
            .optional()
            .describe("Requests for the hotel, in English. Not guaranteed."),
        }).describe("What the hotel needs to know."),
      }),
      { error: "items must list exactly one offer" },
    )
    .min(1, { error: "items must list exactly one offer" })
    .max(1, { error: "items must list exactly one offer" })
    .describe("The offer to book. Exactly one in v1."),
});

export type CreateOrderInput = z.input<typeof createOrderInput>;

/** `GET /v1/orders/{orderId}` and the MCP `get_order` arguments. */
export const getOrderInput = strictInput({
  orderId: orderId.describe("orderId from create order or list orders."),
  locale: locale.optional(),
});

export type GetOrderInput = z.input<typeof getOrderInput>;

const listLimitError = `limit must be a whole number from 1 to ${LIMITS_V1.pageSizeMax}`;

/** `GET /v1/orders` and the MCP `list_orders` arguments. A query string gives
 *  `limit` as text, so it is coerced. */
export const listOrdersInput = strictInput({
  cursor: cursor
    .optional()
    .describe("`nextCursor` from the previous page of orders."),
  limit: z.coerce
    .number({ error: listLimitError })
    .int({ error: listLimitError })
    .min(1, { error: listLimitError })
    .max(LIMITS_V1.pageSizeMax, { error: listLimitError })
    .optional()
    .describe(
      `Orders per page, 1 to ${LIMITS_V1.pageSizeMax}. Default ${LIMITS_V1.pageSizeDefault}.`,
    ),
  locale: locale.optional(),
});

export type ListOrdersInput = z.input<typeof listOrdersInput>;
