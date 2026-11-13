import { z } from "zod";

import { hotelId, offerId } from "../conventions/ids.ts";
import { money } from "../conventions/money.ts";
import { openEnum, openObject } from "../conventions/open.ts";
import { instant } from "../conventions/time.ts";
import { LIMITS } from "../limits.ts";
import { localizedText, names, stayEcho } from "./common.ts";
import { roomType } from "./hotel.ts";

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

/** What a fee payable at the property is for, in Fortrip's words. */
export const FEE_KINDS = [
  "tax",
  "resort_fee",
  "cleaning_fee",
  "deposit",
  "other",
  "unknown",
] as const;

export type FeeKind = (typeof FEE_KINDS)[number];

export const payAtProperty = openObject({
  disclosure: openEnum(["complete", "incomplete"]),
  items: z.array(
    openObject({
      kind: openEnum(FEE_KINDS).describe(
        "What the fee is for: tax (a city, tourist or other tax the property collects), resort_fee (a resort, facility or amenity fee), cleaning_fee, deposit (a sum the property holds during the stay), other (a kind not in this list), unknown (the kind is not stated).",
      ),
      amount: money.nullable(),
      mandatory: z.boolean(),
      basis: openEnum([
        "per_stay",
        "per_night",
        "per_person",
        "per_person_per_night",
        "unknown",
      ]),
    }),
  ),
}).describe(
  "Fees paid at the property, on top of the total, in the property's currency, not converted. disclosure incomplete: there may be fees not listed.",
);

export const cancellation = openObject({
  status: openEnum(["free", "partial_penalty", "non_refundable", "unknown"]),
  readAt: instant.describe("When these terms were read: status and penalties are as of this time."),
  freeCancellationEndsAt: instant.nullable(),
  penalties: z.array(
    openObject({ startsAt: instant.nullable(), amount: money }),
  ),
  timeZone: z.string().nullable(),
}).describe("The cancellation terms, read at readAt.");

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
  hotelId,
  expiresAt: instant,
  roomType,
  roomCount: z.number().int(),
  meals,
  cancellation,
  confirmation,
  payAtProperty,
  total: money.describe(
    "The whole stay for all rooms: what is charged. Fees payable at the property are not in it.",
  ),
  perRoomNight: money.describe(
    "total divided by the rooms and the nights, rounded to cents: for comparison only. It need not multiply back to total, which is what is charged.",
  ),
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
  byLimit: removed(
    `by limitPerHotel, or by the ${LIMITS.offersPerHotelDefault} a hotel gets when none is given; a higher limitPerHotel or a filter may show them`,
  ),
  byCallLimit: removed(
    `because the call's hotels share ${LIMITS.offersPerCallDefault} offers in all (${LIMITS.offersPerCallMax} when limitPerHotel is given): a call for this hotel alone shows this many more`,
  ),
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
      hotelId,
      name: z.string(),
      names,
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
