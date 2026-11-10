import { z } from "zod";

import { hotelId } from "../conventions/ids.ts";
import { money } from "../conventions/money.ts";
import { openEnum, openObject, openUnion } from "../conventions/open.ts";
import { LIMITS } from "../limits.ts";
import { knownLocaleText, latLng, names, photo, stayEcho } from "./common.ts";
import { center, place, placeRef } from "./place.ts";

/* `POST /v1/hotels/search` (spec §7.8). */

export const SEARCH_NOTE_CODES = [
  "indicative_prices",
  "prices_unavailable",
  "pool_limited",
  "amenities_listed_only",
  "place_resolved_dominant",
  "area_absorbed",
  "broad_area",
  "island_radius",
  "area_retired",
  "more_outside_radius",
  "more_elsewhere",
  "few_hotels_in_scope",
  "party_split_required",
  "no_results",
  "locality_available",
] as const;

export type SearchNoteCode = (typeof SEARCH_NOTE_CODES)[number];

/** An indicative (not bookable) price for one unit; only offers can be booked. */
export const indicativePrice = openObject({
  kind: openEnum(["indicative"]),
  basis: openEnum(["lowest_unit"]),
  fromPerRoomNight: money,
  fromPerRoomStay: money,
});

export type IndicativePrice = z.infer<typeof indicativePrice>;

export const hotelSummary = openObject({
  hotelId,
  name: z.string(),
  names,
  stars: z.number().nullable(),
  address: openObject({
    line: knownLocaleText.nullable(),
    countryCode: z.string().nullable(),
    region: placeRef.nullable(),
  }),
  location: latLng.nullable(),
  timeZone: z.string().nullable(),
  distanceMeters: z.number().nullable(),
  price: indicativePrice.nullable(),
  /** The cover photo; `null` without one. */
  photo: photo.nullable().describe("The cover photo; null when there is none."),
});

export type HotelSummary = z.infer<typeof hotelSummary>;

/** The top locality hubs of a scope (§7.6); also `search_too_broad` details. */
export const localities = openObject({
  items: z.array(
    openObject({
      place: placeRef,
      count: z.number().int(),
      total: z.number().int(),
      includes: z.array(
        openObject({ place: placeRef, members: z.number().int() }),
      ),
    }),
  ),
  unassigned: z.number().int(),
  more: z.number().int(),
});

const radiusSource = openEnum(["default", "requested"]);

const destination = openUnion("kind", [
  openObject({
    kind: z.literal("place"),
    place,
    resolution: openEnum([
      "only_match",
      "dominant",
      "by_id",
      "by_country_code",
      "by_locality",
    ]),
    otherMatches: z.number().int(),
    scope: openEnum(["area", "radius", "locality"]),
    center,
    radiusMeters: z.number().nullable(),
    radiusSource: radiusSource.nullable(),
  }),
  openObject({
    kind: z.literal("point"),
    center,
    scope: openEnum(["radius"]),
    radiusMeters: z.number(),
    radiusSource,
  }),
]);

const count = z.number().int();

/** A count of hotels, and when the answer has it. */
const hotels = (what: string) => count.nullable().describe(what);

export const searchResult = openObject({
  destination: destination.nullable(),
  text: openObject({
    value: z.string(),
    match: openEnum(["exact"]),
  }).nullable(),
  stay: stayEcho.nullable(),
  pricing: openObject({
    mode: openEnum(["indicative", "none"]),
    scope: openEnum(["page", "pool"]).nullable(),
    status: openEnum(["ok", "unavailable"]).nullable(),
  }),
  sort: openEnum([
    "distance",
    "relevance",
    "stars_desc",
    "price_asc",
    "price_desc",
  ]),
  coverage: openObject({
    matched: count.describe(
      "Hotels that match the destination, the text and every filter but the price filter.",
    ),
    priced: hotels(
      "Hotels priced: those on this page, or with a price sort or price filter the whole priced set (pricing.scope); null without prices.",
    ),
    withPrice: hotels("Of those priced, how many have an indicative price; null when prices weren't asked for or are unavailable."),
    poolRadiusMeters: z
      .number()
      .nullable()
      .describe(
        `When a price sort or price filter priced only the nearest ${LIMITS.poolLimit.toLocaleString("en-US")}: how far the farthest of them is from the center, in meters; otherwise null.`,
      ),
    excludedNoPrice: hotels("With a price filter: priced hotels left out for having no indicative price; otherwise null."),
    excludedNoFacilityData: hotels(
      "With an amenity filter: hotels left out for listing no facilities at all, though they may have the amenity; otherwise null.",
    ),
    withinMaxRadius: hotels(
      `For a radius under ${LIMITS.radiusMetersMax.toLocaleString("en-US")} m: how many would match within ${LIMITS.radiusMetersMax.toLocaleString("en-US")} m of the center; otherwise null.`,
    ),
    textAnywhere: hotels(
      "With text and a place: the hotels that match the text anywhere in the place's country; otherwise null.",
    ),
    localities: localities
      .nullable()
      .describe("For an area: its top localities, the towns its matching hotels belong to; otherwise null."),
    nameAsText: hotels(
      "When a place_name search matched few hotels: how many in its country match the name as text; otherwise null.",
    ),
  }).describe("What the search covered: counts of hotels, each null when it doesn't apply."),
  currencyHint: openObject({
    currency: openEnum(["CNY"]),
    reason: openEnum(["request_location", "sign_in_location"]),
  })
    .optional()
    .describe(
      "Present only when the search didn't set currency and the user may pay through another currency's channel: this request comes from mainland China (request_location), or the user's latest sign-in to Fortrip was there (sign_in_location). Prices are also available in that currency; a suggestion, not a requirement.",
    ),
  data: z.array(hotelSummary),
  nextCursor: z
    .string()
    .nullable()
    .describe("Pass it back as cursor for the next page; null on the last page."),
  notes: z.array(
    openObject({ code: openEnum(SEARCH_NOTE_CODES), message: z.string() }),
  ),
});

export type SearchResult = z.infer<typeof searchResult>;
