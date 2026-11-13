import { z } from "zod";

import { hotelId } from "../conventions/ids.ts";
import { money } from "../conventions/money.ts";
import { openEnum, openObject } from "../conventions/open.ts";
import { localTime } from "../conventions/time.ts";
import { AMENITY_CODES } from "../vocabulary.ts";
import { knownLocaleText, latLng, localizedText, names, photo } from "./common.ts";
import { hotelSummary } from "./search.ts";

/* `GET /v1/hotels/{hotelId}` (spec §8). */

/** The 14 policy topics, in snake_case, plus `other`. */
export const POLICY_TOPICS = [
  "check_in",
  "important_notices",
  "booking",
  "booking_tips",
  "check_in_out",
  "check_in_tips",
  "reception",
  "deposit",
  "meal",
  "extra_bed",
  "pets",
  "surroundings",
  "meetings",
  "non_smoking",
  "other",
] as const;

export type PolicyTopic = (typeof POLICY_TOPICS)[number];

/**
 * A room type: its name and facts. The same object on an offer, in a hotel's
 * list and on an order's room; a fact not on record is null.
 */
export const roomType = openObject({
  name: localizedText.nullable(),
  beds: localizedText.nullable(),
  areaSqm: openObject({ min: z.number(), max: z.number() }).nullable(),
  maxOccupancy: z.number().int().nullable(),
  window: openEnum(["yes", "no", "partial"]).nullable(),
}).describe("A room type: its name and facts, each null when not on record.");

export type RoomType = z.infer<typeof roomType>;

const timeRange = openObject({
  from: localTime.nullable(),
  until: localTime.nullable(),
});

export const hotel = openObject({
  hotelId,
  name: z.string(),
  names,
  bookable: z.boolean(),
  stars: z.number().nullable(),
  address: hotelSummary.shape.address,
  location: latLng.nullable(),
  timeZone: z.string().nullable(),
  description: knownLocaleText.nullable(),
  /** Up to 8 hotel photos, the cover first; `null` when the catalogue lists
   *  none (unknown is not no). */
  photos: z
    .array(photo)
    .nullable()
    .describe("Up to 8 hotel photos, the cover first; null when the catalogue lists none."),
  checkInTimes: timeRange,
  checkOutTimes: timeRange,
  policies: openObject({
    listed: z.boolean(),
    items: z.array(
      openObject({
        topic: openEnum(POLICY_TOPICS),
        text: z.string(),
        locale: openEnum(["en", "zh"]).nullable(),
      }),
    ),
  }),
  amenities: openObject({
    listed: z.boolean(),
    items: z.array(
      openObject({ code: openEnum(AMENITY_CODES), name: knownLocaleText }),
    ),
  }),
  breakfastServed: z.boolean().nullable(),
  deposit: openObject({
    required: z.boolean().nullable(),
    amount: money.nullable(),
  }),
  contact: openObject({
    phone: z.string().nullable(),
    website: z.string().nullable(),
  }),
  roomTypes: z
    .array(roomType)
    .nullable()
    .optional()
    .describe(
      "The hotel's room types, present only when asked for with include=roomTypes; null when the catalogue lists none. Nothing joins an offer's roomType to an entry here: the names can differ.",
    ),
});

export type Hotel = z.infer<typeof hotel>;
