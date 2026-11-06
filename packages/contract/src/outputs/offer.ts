import { z } from "zod";

import { hotelId, offerId } from "../conventions/ids.ts";
import { money } from "../conventions/money.ts";
import { openEnum, openObject } from "../conventions/open.ts";
import { instant, localDate } from "../conventions/time.ts";
import { localizedText, names, stayEcho } from "./common.ts";
import { roomFacts } from "./hotel.ts";

/* `POST /v1/hotels/offers` (spec §9.2, §9.3). */

export const meals = openObject({
  known: z.boolean(),
  included: z.array(openEnum(["breakfast", "lunch", "dinner"])).nullable(),
  unspecifiedMainMeals: z
    .number()
    .int()
    .nullable()
    .describe(
      "Main meals a day beyond included that the rate doesn't name (e.g. 1 when a half-board rate doesn't say lunch or dinner); null when known is false.",
    ),
  allInclusive: z.boolean().nullable(),
  guestsCoveredPerRoom: z
    .number()
    .int()
    .nullable()
    .describe(
      "How many guests in each room the meals are for; fewer than the guests in the room means not everyone gets them. null when not stated.",
    ),
  label: localizedText.nullable(),
}).describe(
  "What the rate includes to eat. known false: the meals are unknown, not none, and included, unspecifiedMainMeals and allInclusive are null.",
);

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
}).describe(
  "Fees paid at the property, on top of price.total, in the property's currency, not converted. disclosure incomplete: there may be fees not listed.",
);

export const cancellation = openObject({
  status: openEnum(["free", "partial_penalty", "non_refundable", "unknown"]),
  asOf: instant.describe("When these terms were read: status and penalties are as of this time."),
  freeCancellationEndsAt: instant.nullable(),
  penalties: z.array(
    openObject({ startsAt: instant.nullable(), amount: money }),
  ),
  timeZone: z.string().nullable(),
}).describe("The cancellation terms, read at asOf.");

export const confirmation = openObject({
  mode: openEnum(["instant", "on_request", "unknown"]).describe(
    "instant: the hotel confirms the booking as soon as it is made. on_request: the hotel confirms or refuses it later, within withinMinutes when stated. unknown: not stated.",
  ),
  withinMinutes: z
    .number()
    .int()
    .nullable()
    .describe("For on_request, the minutes the hotel takes to confirm; null when instant or not stated."),
}).describe("How the hotel confirms a booking of this offer.");

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
    perNightAllRooms: money.describe(
      "price.total divided by the nights: all rooms, one night. A search's fromPerRoomNight is for one room; divide by roomCount to compare.",
    ),
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

const removed = (step: string) => z.number().int().describe(`Offers left out ${step}.`);

export const omitted = openObject({
  byNationality: removed(
    "because the hotel sells them only to guests of some nationalities; Fortrip can't book them",
  ),
  byFilters: removed("by filters"),
  dominated: removed(
    "because another offer of the same room is as good on price and every term, or can't be told apart from one kept",
  ),
  unreadable: removed("because their details came back incomplete or inconsistent"),
  byLimit: removed("by limitPerHotel"),
}).describe("How many offers each selection step left out.");

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
      reason: openEnum(UNAVAILABLE_REASONS).describe(
        "Why the hotel has no offers: sold_out (nothing left for the stay), no_matching_offers (the filters left none), nationality_restricted (the hotel sells this stay only to guests of some nationalities; Fortrip can't book it), offers_unreadable (its offers came back incomplete or inconsistent), not_found (Fortrip has no bookable hotel with this hotelId), supplier_unavailable (offers couldn't be fetched this time; try again), stay_in_past (check-in has passed in the hotel's time zone).",
      ),
      omitted: omitted.nullable(),
    }),
  ),
});

export type HotelOffersResult = z.infer<typeof hotelOffersResult>;
