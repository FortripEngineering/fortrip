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
import { AMENITY_CODES, SEARCH_SORTS } from "./vocabulary.ts";

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
  "The currency to price and charge in: USD (default) or CNY, where available (otherwise the answer is currency_unavailable).";

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

const amenitiesError = `amenities must list 1 to ${LIMITS.amenityFilters} codes from: ${AMENITY_CODES.join(", ")}`;

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
    .max(LIMITS.amenityFilters, { error: amenitiesError })
    .optional()
    .describe(
      "Amenities every hotel must list. Only some codes can filter; asking for one that cannot is answered with the list that can.",
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
        "`indicative` adds an approximate price per hotel and needs a stay; `none` skips prices. Default: indicative with a stay, otherwise none.",
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
        "`nextCursor` from the previous response. A next page is the cursor and, optionally, `limit`; nothing else.",
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
  include: oneOf("include", ["rooms"] as const)
    .optional()
    .describe("`rooms` adds the room list."),
  locale: locale.optional(),
});

export type GetHotelInput = z.input<typeof getHotelInput>;

// ---------------------------------------------------------------------------
// Offers

const hotelIdsError = `hotelIds must list 1 to ${LIMITS.offersHotels} distinct hotelIds`;

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
    .default(LIMITS.offersPerHotelDefault)
    .describe(
      `Offers per hotel, 1 to ${LIMITS.offersPerHotelMax}. Default ${LIMITS.offersPerHotelDefault}.`,
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
const maxGuestsPerRoom = LIMITS.adultsPerRoom + LIMITS.childrenPerRoom;

/** `POST /v1/orders` and the MCP `book_hotel` arguments. */
export const createOrderInput = strictInput({
  contact: strictInput({
    firstName: contactName("firstName", LIMITS.contactFirstName).describe(
      `Contact person's first name, at most ${LIMITS.contactFirstName} characters.`,
    ),
    lastName: contactName("lastName", LIMITS.contactLastName).describe(
      `Contact person's last name, at most ${LIMITS.contactLastName} characters.`,
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
  items: z
    .array(
      strictInput({
        offerId: offerId.describe("offerId from an offers response."),
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
    .describe("The offer to book: exactly one."),
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
    .describe("`nextCursor` from the previous page of orders."),
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

/** `POST /v1/orders/{orderId}/cancel` and the MCP `cancel_order` arguments:
 *  the order and, to cancel a paid order, the penalty the user agreed to as a
 *  ceiling; an unpaid order is closed with the order alone. The server
 *  computes the refund; a higher penalty now answers `cancellation_changed`. */
export const cancelOrderInput = strictInput({
  orderId: orderId.describe("The orderId of the order to cancel."),
  maximumPenalty: echoedMoney("maximumPenalty")
    .optional()
    .describe(
      "The penalty the user agreed to: the order's cancel.penalty, exactly as returned. Ignored when closing an unpaid order.",
    ),
});

export type CancelOrderInput = z.input<typeof cancelOrderInput>;

const sharedPaymentTokenRe = /^spt_[A-Za-z0-9]{1,250}$/;

const sharedPaymentTokenError =
  "sharedPaymentToken must be a Stripe shared payment token: spt_ followed by letters and digits";

const instrumentTokenError =
  "credential.token must be a Stripe shared payment token: spt_ followed by letters and digits";

const instrumentsError = "payment.instruments must be a list of 1 to 8 instruments";

const instrumentCardError =
  "payment.instruments must not hold card details: pay with the shared payment token alone";

/** One instrument of UCP's Complete Checkout payment, as UCP defines it:
 *  UCP's other fields (`billing_address`, `network`, …) pass through and
 *  aren't used to pay, and an instrument may be another handler's. Only the
 *  selected one is held to `selectedCard`. UCP's own names, in snake case. */
const ucpInstrument = z
  .looseObject(
    {
      id: nonEmpty("id").describe("The instrument's id, as the agent's UCP client names it."),
      handler_id: nonEmpty("handler_id").describe(
        "The id of the handler the instrument pays through: the order's stripe_payments for the selected one.",
      ),
      type: nonEmpty("type").describe(
        "The instrument type: card for the selected one. A Link token is presented as a card instrument, whatever Link funds it with.",
      ),
      selected: flag("selected")
        .optional()
        .describe(
          "Whether this is the instrument to pay with. Exactly one is selected; a lone instrument without it is the one.",
        ),
      credential: z
        .looseObject(
          {
            type: nonEmpty("credential.type").describe(
              "The credential type: stripe_payment_token for the selected one.",
            ),
            token: z
              .string({ error: instrumentTokenError })
              .optional()
              .describe(
                "The shared payment token (spt_…) the user approved for this order, requested with the limits of the order's stripe_shared_payment_token method.",
              ),
          },
          { error: "credential must be a JSON object" },
        )
        .optional()
        .describe("The instrument's credential: for the selected one, the shared payment token."),
      display: z
        .looseObject({}, { error: "display must be a JSON object" })
        .optional()
        .describe("How the wallet shows the instrument, as UCP has it. Not used to pay."),
    },
    { error: "Each instrument must be a JSON object" },
  )
  .describe("A UCP payment instrument.");

type UcpInstrument = z.output<typeof ucpInstrument>;

/** What the selected instrument must be: a card of the order's
 *  `stripe_payments` handler, its credential a shared payment token. */
const selectedCard = z.looseObject({
  handler_id: z.literal("stripe_payments", {
    error: "The selected instrument's handler_id must be stripe_payments",
  }),
  type: z.literal("card", { error: "The selected instrument's type must be card" }),
  credential: z.looseObject(
    {
      type: z.literal("stripe_payment_token", {
        error: "The selected instrument's credential.type must be stripe_payment_token",
      }),
      token: z
        .string({ error: instrumentTokenError })
        .regex(sharedPaymentTokenRe, { error: instrumentTokenError }),
    },
    { error: "The selected instrument needs a credential: its shared payment token" },
  ),
});

/** The instruments a payment pays with: those with `selected: true`, or a
 *  lone instrument that doesn't say. */
function selectedOf(instruments: readonly (UcpInstrument | null | undefined)[]) {
  const chosen = instruments.flatMap((i, at) => (i?.selected === true ? [{ i, at }] : []));
  const lone = instruments[0];
  if (chosen.length === 0 && instruments.length === 1 && lone && lone.selected === undefined) {
    return [{ i: lone, at: 0 }];
  }
  return chosen;
}

/** The ways an order is paid: the order's own link, or through `pay_order`
 *  one of its `payment.methods`, by id (a shared payment token, or
 *  Alipay/WeChat Pay). */
export const PAY_WAYS = ["payment_link", "stripe_shared_payment_token", "stripe_alipay_wechat_pay"] as const;
export type PayWay = (typeof PAY_WAYS)[number];

/** The way each exclusive field of `payOrderInput` pays by. */
export const PAY_INPUT_WAYS: Record<"sharedPaymentToken" | "payment" | "method", PayWay> = {
  sharedPaymentToken: "stripe_shared_payment_token",
  payment: "stripe_shared_payment_token",
  method: "stripe_alipay_wechat_pay",
};

/** `POST /v1/orders/{orderId}/pay` and the MCP `pay_order` arguments: the
 *  order, how to pay it, and the total the user approved. The way is a
 *  Stripe shared payment token granted for the order, or `method`
 *  (Alipay or WeChat Pay); with a token it is `sharedPaymentToken` or, as UCP's Complete
 *  Checkout sends it, the credential of `payment`'s selected instrument.
 *  Exactly one of `sharedPaymentToken`, `payment` and `method`. A total other than the order's answers
 *  `payment_total_changed` and charges nothing. */
export const payOrderInput = strictInput({
  orderId: orderId.describe("The orderId of the order to pay."),
  sharedPaymentToken: z
    .string({ error: sharedPaymentTokenError })
    .regex(sharedPaymentTokenRe, { error: sharedPaymentTokenError })
    .optional()
    .describe(
      "The shared payment token (spt_…) the user approved for this order, requested with the limits of the order's stripe_shared_payment_token method. Exactly one of sharedPaymentToken, payment and method.",
    ),
  payment: strictInput({
    instruments: z
      .array(ucpInstrument, { error: instrumentsError })
      .min(1, { error: instrumentsError })
      .max(8, { error: instrumentsError })
      .describe("The instruments, exactly one of them selected."),
  })
    .superRefine((payment, ctx) => {
      // The list's own length error stands alone.
      if (payment.instruments.length < 1 || payment.instruments.length > 8) return;
      // What passes through is never card details. A phone number counts
      // only from 16 digits, so a billing address's phone isn't one.
      const phones: unknown[] = [];
      const rest = JSON.stringify(payment.instruments, (key, value) => {
        if (key !== "phone_number") return value;
        phones.push(value);
        return undefined;
      });
      if (containsCardNumber(rest) || containsCardNumber(JSON.stringify(phones), 16)) {
        ctx.addIssue({ code: "custom", path: ["instruments"], message: instrumentCardError });
        return;
      }
      const chosen = selectedOf(payment.instruments);
      const [only] = chosen;
      if (chosen.length !== 1 || !only) {
        ctx.addIssue({
          code: "custom",
          path: ["instruments"],
          message: `payment.instruments must have exactly one instrument with selected: true, not ${chosen.length}`,
        });
        return;
      }
      // An instrument that isn't even a UCP one has its refusal already.
      if (!ucpInstrument.safeParse(only.i).success) return;
      const card = selectedCard.safeParse(only.i);
      for (const issue of card.success ? [] : card.error.issues) {
        ctx.addIssue({
          code: "custom",
          path: ["instruments", only.at, ...issue.path],
          message: issue.message,
        });
      }
    })
    .optional()
    .describe(
      "UCP's Complete Checkout payment, in place of sharedPaymentToken: the token as the stripe_payment_token credential of the one selected stripe_payments card instrument. Exactly one of sharedPaymentToken, payment and method.",
    ),
  method: oneOf("method", ["stripe_alipay_wechat_pay"] as const)
    .optional()
    .describe(
      "Pay by a method in payment.methods other than the token, which is paid with sharedPaymentToken or payment. Exactly one of sharedPaymentToken, payment and method.",
    ),
  total: requestMoney("total").describe(
    "The total the user approved: the order's price.total, in its currency, exactly as returned.",
  ),
}).superRefine((input, ctx) => {
  // Of the three ways to pay, in order: the last one given is the extra.
  const given = (
    [
      ["sharedPaymentToken", input.sharedPaymentToken],
      ["payment", input.payment],
      ["method", input.method],
    ] as const
  ).filter(([, value]) => value !== undefined);
  const extra = given.length > 1 ? given.at(-1) : undefined;
  if (extra) {
    ctx.addIssue({
      code: "custom",
      path: [extra[0]],
      message: "Send exactly one of sharedPaymentToken, payment and method",
    });
  } else if (given.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["sharedPaymentToken"],
      message: sharedPaymentTokenError,
    });
  }
});

export type PayOrderInput = z.input<typeof payOrderInput>;

/** The shared payment token a `pay_order` call pays with: `sharedPaymentToken`,
 *  or the credential of `payment`'s selected instrument. Takes what
 *  `payOrderInput` parsed, which holds exactly one. */
export function sharedPaymentTokenOf(
  input: Pick<z.output<typeof payOrderInput>, "sharedPaymentToken" | "payment">,
): string {
  const chosen = input.payment ? selectedOf(input.payment.instruments) : [];
  const token = input.sharedPaymentToken ?? (chosen.length === 1 ? chosen[0]?.i.credential?.token : undefined);
  if (token === undefined) {
    throw new Error("sharedPaymentTokenOf: no token; parse with payOrderInput first");
  }
  return token;
}
