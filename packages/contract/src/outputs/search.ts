import { z } from "zod";

import { hotelId } from "../conventions/ids.ts";
import { money } from "../conventions/money.ts";
import { openEnum, openObject, openUnion } from "../conventions/open.ts";
import { localDate } from "../conventions/time.ts";
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
  approx: openObject({
    fromPerRoomNight: money,
    fromPerRoomStay: money,
    rateDate: localDate,
  }).nullable(),
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
  /** The cover photo; `null` without one. Absent from servers before 3.1. */
  photo: photo.nullable().optional(),
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
    matched: count,
    priced: count.nullable(),
    withPrice: count.nullable(),
    poolRadiusMeters: z.number().nullable(),
    excludedNoPrice: count.nullable(),
    excludedNoFacilityData: count.nullable(),
    withinMaxRadius: count.nullable(),
    textAnywhere: count.nullable(),
    localities: localities.nullable(),
    nameAsText: count.nullable(),
  }),
  data: z.array(hotelSummary),
  nextCursor: z.string().nullable(),
  notes: z.array(
    openObject({ code: openEnum(SEARCH_NOTE_CODES), message: z.string() }),
  ),
});

export type SearchResult = z.infer<typeof searchResult>;
