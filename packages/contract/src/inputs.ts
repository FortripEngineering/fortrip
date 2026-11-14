import { z } from "zod";

import { CARD_NUMBER_MESSAGE, containsCardNumber } from "./card-number.ts";
import { addIsoDateDays, countIsoDateDays, isIsoDate } from "./dates.ts";
import { hotelId, offerId, orderId, placeId } from "./conventions/ids.ts";
import { echoedMoney, requestMoney } from "./conventions/money.ts";
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
import { CURRENCIES, LIMITS } from "./limits.ts";
import { FILTERABLE_AMENITIES, SEARCH_SORTS } from "./vocabulary.ts";

/*
 * What an agent may send to API v1 (spec §7.1, §8, §9.1, §10.1, §10.5). Every
 * schema is strict (an unknown key is named, never dropped), carries its own
 * messages (see `fields.ts`) and describes every leaf: the descriptions reach
 * MCP clients and the docs through the JSON Schema. Whatever needs no catalogue
 * or supplier to decide is decided here and answers 400. Offers and orders do
 * not compare their dates with today: the service does, in the hotel's zone.
 */

const locale = oneOf("locale", ["en", "zh"] as const).describe(
  "Language for names and text in the response: en or zh.",
);

const currencyDescription =
  "The currency of every price: USD (default) or CNY. Each currency is paid through its own channel, with its own payment methods; the order's payment page shows them. CNY is paid through payment channels in mainland China and suits a user who pays that way.";

/** An opaque cursor from a previous response. */
const cursor = nonEmpty("cursor");

// ---------------------------------------------------------------------------
// Stay

const nightsError = (name: string) =>
  `${name} must be after the check-in date and at most ${LIMITS.nightsFortrip} nights later`;

export const stay = strictInput({
  checkIn: localDate.describe(
    "Check-in date in the hotel's calendar, yyyy-MM-dd.",
  ),
  checkOut: localDate.describe(
    `Check-out date in the hotel's calendar, yyyy-MM-dd. Stays are 1 to ${LIMITS.nightsSupplier} nights; a longer one answers stay_unsupported (max_nights), and past ${LIMITS.nightsFortrip} nights invalid_request: ask the user whether to split it into consecutive stays.`,
  ),
  rooms: z
    .array(
      strictInput({
        adults: wholeNumber("adults", 1, LIMITS.adultsPerRoom).describe(
          "Adults in this room.",
        ),
        childrenAges: z
          .array(wholeNumber("Each child's age", 0, LIMITS.childAgeMax), {
            error: `childrenAges must list each child's age (0 to ${LIMITS.childAgeMax}) in this room, at most ${LIMITS.childrenPerRoom}`,
          })
          .max(LIMITS.childrenPerRoom, {
            error: `childrenAges must list each child's age (0 to ${LIMITS.childAgeMax}) in this room, at most ${LIMITS.childrenPerRoom}`,
          })
          .describe(
            "Age of each child in this room, 0 to 17. An empty list means no children.",
          ),
      }),
      { error: `rooms must list 1 to ${LIMITS.rooms} rooms` },
    )
    .min(1, { error: `rooms must list 1 to ${LIMITS.rooms} rooms` })
    .max(LIMITS.rooms, {
      error: `rooms must list 1 to ${LIMITS.rooms} rooms`,
    })
    .describe(
      `The rooms wanted, 1 to ${LIMITS.rooms}, each with its party; offers and orders need every room the same.`,
    ),
}).superRefine((value, ctx) => {
  if (!isIsoDate(value.checkIn) || !isIsoDate(value.checkOut)) return;
  const nights = countIsoDateDays(value.checkIn, value.checkOut);
  if (nights < 1 || nights > LIMITS.nightsFortrip) {
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

const radiusMeters = wholeNumber("radiusMeters", 1, LIMITS.radiusMetersMax)
  .optional()
  .describe(
    `Search radius around the destination in meters, 1 to ${LIMITS.radiusMetersMax}. Left out, the service picks one.`,
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
      name: text("name", 1, LIMITS.textLength).describe(
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
        .describe("A locality listed in an earlier search response."),
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
    error: `text must be text of 1 to ${LIMITS.textLength} characters`,
  })
  .trim()
  .min(1, {
    error: `text must be text of 1 to ${LIMITS.textLength} characters`,
  })
  .max(LIMITS.textLength, {
    error: `text must be text of 1 to ${LIMITS.textLength} characters`,
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

const amenitiesError = `amenities must list 1 to ${LIMITS.amenityFilters} codes from: ${FILTERABLE_AMENITIES.join(", ")}`;

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
    .array(oneOf("Each amenity", FILTERABLE_AMENITIES), { error: amenitiesError })
    .min(1, { error: amenitiesError })
    .max(LIMITS.amenityFilters, { error: amenitiesError })
    .optional()
    .describe(
      `Amenities every hotel must list, 1 to ${LIMITS.amenityFilters} of the codes a search can filter by. A hotel's own amenities can hold other codes.`,
    ),
  price: strictInput({
    maxPerRoomNight: requestMoney("filters.price.maxPerRoomNight").describe(
      "Highest price per room per night, in the search's currency.",
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
        `Hotel name, brand or area to match, 1 to ${LIMITS.textLength} characters. A first page needs this or \`destination\`.`,
      ),
    stay: stay
      .optional()
      .describe(
        "Dates and party. Needed for indicative prices. Search uses only the dates when the rooms differ.",
      ),
    pricing: oneOf("pricing", ["indicative", "none"] as const)
      .optional()
      .describe(
        "`indicative` adds an indicative price per hotel and needs a stay; `none` skips prices. Default: indicative with a stay, otherwise none.",
      ),
    filters: searchFilters,
    sort: oneOf("sort", SEARCH_SORTS)
      .optional()
      .describe(
        "Result order. `distance` needs a destination, `relevance` needs `text`, `price_asc` and `price_desc` need indicative pricing. Default: relevance with `text`, otherwise distance.",
      ),
    limit: wholeNumber("limit", 1, LIMITS.pageSizeMax)
      .optional()
      .describe(
        `Hotels per page, 1 to ${LIMITS.pageSizeMax}. Default ${LIMITS.pageSizeDefault}.`,
      ),
    cursor: cursor
      .optional()
      .describe(
        "The cursor the previous response gave for its next page (`nextCursor`). A next page is the cursor and, optionally, `limit`; nothing else.",
      ),
    locale: locale.optional(),
    currency: oneOf("currency", CURRENCIES).optional().describe(currencyDescription),
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

    const bound = input.filters?.price?.maxPerRoomNight;
    const searchCurrency = input.currency ?? "USD";
    if (bound !== undefined && bound.currency !== searchCurrency) {
      issue(
        ["filters", "price", "maxPerRoomNight", "currency"],
        `filters.price.maxPerRoomNight.currency is ${bound.currency}, but the search is in ${searchCurrency}${input.currency === undefined ? " (the default)" : ""}: send the price in ${searchCurrency}`,
      );
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
  include: oneOf("include", ["roomTypes"] as const)
    .optional()
    .describe("`roomTypes` adds the hotel's room types."),
  locale: locale.optional(),
});

export type GetHotelInput = z.input<typeof getHotelInput>;

// ---------------------------------------------------------------------------
// Offers

const hotelIdsError = `hotelIds must list 1 to ${LIMITS.offersHotels} distinct hotelIds`;

/**
 * How many offers each hotel of an offers call gets: what `limitPerHotel`
 * resolves to, on every surface. `limitPerHotel` is the request's, or
 * undefined when it gave none; `hotelsWithOffers` counts the call's hotels
 * that have any offer. The limit (the default one when none was given) holds
 * while every such hotel can have it within the call's budget; past that the
 * budget is split evenly among them. A call has at most
 * `LIMITS.offersHotels` hotels, so a share is never under 3, and needs no
 * floor; with no hotel that has offers, the limit stands. The budget is
 * smaller when no limit was given.
 */
export function offersPerHotel(
  limitPerHotel: number | undefined,
  hotelsWithOffers: number,
): number {
  const budget =
    limitPerHotel === undefined
      ? LIMITS.offersPerCallDefault
      : LIMITS.offersPerCallMax;
  const share = Math.floor(budget / hotelsWithOffers);
  return Math.min(limitPerHotel ?? LIMITS.offersPerHotelDefault, share);
}

/** `POST /v1/hotels/offers` and the MCP `get_hotel_offers` arguments. */
export const hotelOffersInput = strictInput({
  hotelIds: z
    .array(hotelId, { error: hotelIdsError })
    .min(1, { error: hotelIdsError })
    .max(LIMITS.offersHotels, { error: hotelIdsError })
    .refine((ids) => new Set(ids).size === ids.length, {
      error: hotelIdsError,
    })
    .describe(`Hotels to price, 1 to ${LIMITS.offersHotels}, no repeats.`),
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
  limitPerHotel: wholeNumber("limitPerHotel", 1, LIMITS.offersPerHotelMax)
    .optional()
    .describe(
      `Offers per hotel, 1 to ${LIMITS.offersPerHotelMax}. Left out: ${LIMITS.offersPerHotelDefault} for each hotel that has offers while that is at most ${LIMITS.offersPerCallDefault} offers in all, otherwise ${LIMITS.offersPerCallDefault} split evenly among those hotels (5 hotels: ${offersPerHotel(undefined, 5)} each; ${LIMITS.offersHotels} hotels: ${offersPerHotel(undefined, LIMITS.offersHotels)} each). Given: that many for each hotel while that is at most ${LIMITS.offersPerCallMax} offers in all, otherwise ${LIMITS.offersPerCallMax} split evenly the same way. The answer says, for each hotel, how many more offers a call for that hotel alone would show.`,
    ),
  locale: locale.optional(),
  currency: oneOf("currency", CURRENCIES)
    .optional()
    .describe(`${currencyDescription} An order made from these offers is charged in this currency.`),
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

const contactNameError = `name must be text of 1 to ${LIMITS.contactName} characters`;

/** The contact's name: one field, in any script, trimmed, every run of
 *  whitespace one space, and not only invisible characters. */
const contactName = z
  .string({ error: contactNameError })
  .trim()
  .overwrite((value) => value.replace(/\s+/g, " "))
  .min(1, { error: contactNameError })
  .max(LIMITS.contactName, { error: contactNameError })
  // Empty is `min`'s to report; this is for a name with nothing to see.
  .refine((value) => value === "" || value.replace(/[\p{Cf}\s]/gu, "") !== "", {
    error: contactNameError,
  })
  .refine((value) => !containsCardNumber(value), {
    error: CARD_NUMBER_MESSAGE,
  });

const emailError = "email must be an email address";
const guestsError = "guests must list at least one guest per room";
const maxGuestsPerRoom = LIMITS.adultsPerRoom + LIMITS.childrenPerRoom;

/** `POST /v1/orders` and the MCP `create_order` arguments. `items` comes
 *  first: it is the first property a model reads, and the offer goes inside
 *  its item (a model that also sent a top-level `offerId` was refused). */
export const createOrderInput = strictInput({
  items: z
    .array(
      strictInput({
        offerId: offerId.describe(
          "The offer to order: an offerId from an offers response. It goes here, inside the item, and nowhere else in the request.",
        ),
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
              { error: `rooms must list 1 to ${LIMITS.rooms} rooms` },
            )
            .min(1, { error: `rooms must list 1 to ${LIMITS.rooms} rooms` })
            .max(LIMITS.rooms, {
              error: `rooms must list 1 to ${LIMITS.rooms} rooms`,
            })
            .describe("One entry per room of the offer, in order."),
          specialRequests: cardFreeText(
            "specialRequests",
            0,
            LIMITS.specialRequests,
          )
            .optional()
            .describe("Requests for the hotel, in English. Not guaranteed."),
        }).describe("What the hotel needs to know."),
      }),
      { error: "items must list exactly one offer" },
    )
    .min(1, { error: "items must list exactly one offer" })
    .max(1, { error: "items must list exactly one offer" })
    .describe(
      "What to order: exactly one item, which holds the offer's offerId and what its hotel needs to know. The offerId goes inside the item, not beside items.",
    ),
  contact: strictInput({
    name: contactName.describe(
      `Contact person's full name, in any script, at most ${LIMITS.contactName} characters.`,
    ),
    email: z
      .string({ error: emailError })
      .trim()
      .pipe(z.email({ error: emailError }))
      .describe("Contact email; the confirmation is sent here."),
    // Only cards of 16+ digits: a phone number has at most 15 (E.164).
    phone: cardFreeText(
      "phone",
      LIMITS.contactPhoneMin,
      LIMITS.contactPhoneMax,
      16,
    ).describe("Contact phone number, with country code."),
  }).describe("Who the hotel and the confirmation reach."),
});

export type CreateOrderInput = z.input<typeof createOrderInput>;

/** `GET /v1/orders/{orderId}` and the MCP `get_order` arguments. */
export const getOrderInput = strictInput({
  orderId: orderId.describe("The order's orderId."),
  locale: locale.optional(),
});

export type GetOrderInput = z.input<typeof getOrderInput>;

const listLimitError = `limit must be a whole number from 1 to ${LIMITS.pageSizeMax}`;

/** `GET /v1/orders` and the MCP `list_orders` arguments. A query string gives
 *  `limit` as text, so it is coerced. */
export const listOrdersInput = strictInput({
  cursor: cursor
    .optional()
    .describe("The cursor the previous page of orders gave for the next one (`nextCursor`)."),
  limit: z.coerce
    .number({ error: listLimitError })
    .int({ error: listLimitError })
    .min(1, { error: listLimitError })
    .max(LIMITS.pageSizeMax, { error: listLimitError })
    .optional()
    .describe(
      `Orders per page, 1 to ${LIMITS.pageSizeMax}. Default ${LIMITS.pageSizeDefault}.`,
    ),
  locale: locale.optional(),
});

export type ListOrdersInput = z.input<typeof listOrdersInput>;

const cancelModeError =
  "Send exactly one of close and maximumPenalty: close (true) closes an unpaid order; maximumPenalty cancels a paid one, with the penalty the user agreed to as a ceiling";

/** `POST /v1/orders/{orderId}/cancel` and the MCP `cancel_order` arguments:
 *  the order and its mode, exactly one of `close` (an unpaid order) and
 *  `maximumPenalty` (a paid one, with the penalty the user agreed to as a
 *  ceiling). The server computes the refund; a higher penalty now answers
 *  `cancellation_changed`. */
export const cancelOrderInput = strictInput({
  orderId: orderId.describe("The orderId of the order to cancel."),
  close: z
    .literal(true, {
      error:
        "close must be true to close an unpaid order; leave it out when cancelling a paid order with maximumPenalty",
    })
    .optional()
    .describe(
      "Send true to close an unpaid order: nothing is charged. Send exactly one of close and maximumPenalty.",
    ),
  maximumPenalty: echoedMoney("maximumPenalty")
    .optional()
    .describe(
      "Send it to cancel a paid order: the penalty the user agreed to, as a ceiling. It is the penalty the order says a cancellation now keeps, exactly as the order gives it (cancel.penalty). Send exactly one of close and maximumPenalty.",
    ),
}).superRefine((input, ctx) => {
  const both = input.close !== undefined && input.maximumPenalty !== undefined;
  if (both || (input.close === undefined && input.maximumPenalty === undefined)) {
    // Both: the second is the extra. Neither: the first is what is missing.
    ctx.addIssue({
      code: "custom",
      path: [both ? "maximumPenalty" : "close"],
      message: cancelModeError,
    });
  }
});

export type CancelOrderInput = z.input<typeof cancelOrderInput>;

const sharedPaymentTokenRe = /^spt_[A-Za-z0-9]{1,250}$/;

const sharedPaymentTokenError =
  "sharedPaymentToken must be a Stripe shared payment token: spt_ followed by letters and digits";

/** The ways an order is paid: the order's own link, or through `pay_order`
 *  a shared payment token, which the order offers as `payment.tokenRequest`. */
export const PAY_WAYS = ["payment_link", "stripe_shared_payment_token"] as const;
export type PayWay = (typeof PAY_WAYS)[number];

/** `POST /v1/orders/{orderId}/pay` and the MCP `pay_order` arguments: the
 *  order, the Stripe shared payment token granted for it, and the total the
 *  user approved. A total other than the order's answers
 *  `payment_total_mismatch` and charges nothing. */
const PAY_OTHER_CURRENCY =
  "a token pays a USD order only. An order in another currency is paid by the user at its payment link: give them the link, and never convert or relabel the total";

export const payOrderInput = strictInput({
  orderId: orderId.describe("The orderId of the order to pay."),
  sharedPaymentToken: z
    .string({ error: sharedPaymentTokenError })
    .regex(sharedPaymentTokenRe, { error: sharedPaymentTokenError })
    .describe(
      "The shared payment token (spt_…) the user approved for this order, requested with the usage limits the order gives for a token (payment.tokenRequest.usageLimits).",
    ),
  // USD alone: an order offers a token request only when it is in USD. A
  // total in another currency is not a field to correct: relabelled or
  // converted it would be a total the user never approved.
  total: requestMoney("total", ["USD"], PAY_OTHER_CURRENCY).describe(
    "The total the user approved: the order's total, amount and currency, exactly as the order gives it (total). In USD: a token pays a USD order only, and any other order is paid by its payment link.",
  ),
});

export type PayOrderInput = z.input<typeof payOrderInput>;
