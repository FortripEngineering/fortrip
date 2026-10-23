import { z } from "zod";

import { hotelId, offerId } from "../conventions/ids.ts";
import { money } from "../conventions/money.ts";
import { openEnum, openObject } from "../conventions/open.ts";
import { instant, localDate } from "../conventions/time.ts";
import { localizedText, names, stayEcho } from "./common.ts";
import { roomFacts } from "./hotel.ts";

/* `POST /v1/hotels/offers` (spec §9.2, §9.3). */

/** What the rate includes to eat; `known: false` leaves the rest null. */
export const meals = openObject({
  known: z.boolean(),
  included: z.array(openEnum(["breakfast", "lunch", "dinner"])).nullable(),
  unspecifiedMainMeals: z.number().int().nullable(),
  allInclusive: z.boolean().nullable(),
  guestsCoveredPerRoom: z.number().int().nullable(),
  label: localizedText.nullable(),
});

/** Fees paid at the property, in its currency, not converted. */
export const payAtProperty = openObject({
  disclosure: openEnum(["complete", "incomplete"]),
  items: z.array(
    openObject({
      label: localizedText.nullable(),
      amount: money.nullable(),
      mandatory: z.boolean(),
      basis: openEnum([
        "per_stay",
        "per_night",
        "per_person",
        "per_person_per_night",
        "unknown",
      ]),
      collectedAt: openEnum(["property", "unknown"]),
    }),
  ),
});

/** The cancellation terms read at `asOf`. */
export const cancellation = openObject({
  status: openEnum(["free", "partial_penalty", "non_refundable", "unknown"]),
  asOf: instant,
  freeCancellationEndsAt: instant.nullable(),
  penalties: z.array(
    openObject({ startsAt: instant.nullable(), amount: money }),
  ),
  timeZone: z.string().nullable(),
});

export const confirmation = openObject({
  mode: openEnum(["instant", "on_request", "unknown"]),
  withinMinutes: z.number().int().nullable(),
});

export const offer = openObject({
  offerId,
  type: openEnum(["hotel"]),
  expiresAt: instant,
  hotel: openObject({
    hotelId,
    room: openObject({ name: localizedText.nullable(), ...roomFacts }),
    roomCount: z.number().int(),
    meals,
  }),
  price: openObject({
    total: money,
    perNightAllRooms: money,
    approx: openObject({
      total: money,
      perNightAllRooms: money,
      rateDate: localDate,
    }).nullable(),
    payAtProperty,
  }),
  cancellation,
  confirmation,
});

export type Offer = z.infer<typeof offer>;

/** How many offers each selection step removed (§9.3). */
export const omitted = openObject({
  byNationality: z.number().int(),
  byFilters: z.number().int(),
  dominated: z.number().int(),
  unreadable: z.number().int(),
  byLimit: z.number().int(),
});

export type Omitted = z.infer<typeof omitted>;

export const UNAVAILABLE_REASONS = [
  "sold_out",
  "no_matching_offers",
  "nationality_restricted",
  "offers_unreadable",
  "not_found",
  "supplier_unavailable",
  "stay_in_past",
] as const;

export const hotelOffersResult = openObject({
  stay: stayEcho,
  hotels: z.array(
    openObject({
      hotel: openObject({ hotelId, name: z.string(), names }),
      offers: z.array(offer),
      omitted,
    }),
  ),
  unavailable: z.array(
    openObject({
      hotelId,
      reason: openEnum(UNAVAILABLE_REASONS),
      omitted: omitted.nullable(),
    }),
  ),
});

export type HotelOffersResult = z.infer<typeof hotelOffersResult>;
