import { z } from "zod";

import { hotelId } from "../conventions/ids.ts";
import { money } from "../conventions/money.ts";
import { openEnum, openObject } from "../conventions/open.ts";
import { localTime } from "../conventions/time.ts";
import { AMENITY_CODES } from "../inputs-v1.ts";
import { knownLocaleText, latLng, localizedText, names } from "./common.ts";
import { hotelSummary } from "./search.ts";

/* `GET /v1/hotels/{hotelId}` (spec §8). */

/** 2.0's 14 policy topics in snake_case, plus `other`. */
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

/** A room type's facts; shared with the offer's room. */
export const roomFacts = {
  beds: localizedText.nullable(),
  areaSqm: openObject({ min: z.number(), max: z.number() }).nullable(),
  maxOccupancy: z.number().int().nullable(),
  window: openEnum(["yes", "no", "partial"]).nullable(),
};

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
  rooms: openObject({
    listed: z.boolean(),
    items: z.array(openObject({ name: localizedText, ...roomFacts })),
  }).optional(),
});

export type Hotel = z.infer<typeof hotel>;
