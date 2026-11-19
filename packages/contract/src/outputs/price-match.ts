import { z } from "zod";

import { claimId, offerId } from "../conventions/ids.ts";
import { money } from "../conventions/money.ts";
import { openEnum, openObject } from "../conventions/open.ts";
import { instant } from "../conventions/time.ts";

/* A price match: what `request_price_match` and `get_price_match` answer. */

/** `checking`: the other site is being checked. `matched`: a new offer at
 *  the other site's total. `partial`: a new offer below ours that stops
 *  short of the other site's total. `declined`: no new offer, and why. */
export const PRICE_MATCH_STATES = ["checking", "matched", "partial", "declined"] as const;

export type PriceMatchState = (typeof PRICE_MATCH_STATES)[number];

/** Why a price match gave no new offer. */
export const PRICE_MATCH_REASONS = [
  "not_lower",
  "site_unreadable",
  "site_not_credible",
  "unsupported",
  "daily_limit",
  "monthly_limit",
  "unfinished",
  "unavailable",
] as const;

export type PriceMatchReason = (typeof PRICE_MATCH_REASONS)[number];

/** Where a price seen was read: the site's own page, or price data for
 *  that site when its page could not be read. */
export const PRICE_SOURCES = ["site", "data"] as const;

/** A price the check saw on the other site. */
export const priceSeen = openObject({
  site: z.string().describe("The site the price was seen on."),
  total: money.describe("The total seen there for the stay."),
  via: openEnum(PRICE_SOURCES).describe(
    "site: read from the site's own page. data: from price data for that site, when its page could not be read.",
  ),
  room: z.string().optional().describe("The room the price was for, as the site named it."),
  terms: z.string().optional().describe("The terms that price came with, as the site gave them."),
});

/** The new offer a match gives: the original offer at a lower total. */
export const matchedOffer = openObject({
  offerId: offerId.describe("The new offer's offerId, to order as any offer."),
  total: money.describe("The new offer's total."),
  expiresAt: instant.describe("When the new offer can no longer be ordered."),
  saved: money.describe("How much less than the original offer's total it is."),
});

export const priceMatch = openObject({
  state: openEnum(PRICE_MATCH_STATES).describe(
    "checking: the other site is being checked. matched: a new offer at the other site's total. partial: a new offer below the original, short of the other site's total. declined: no new offer; reason says why.",
  ),
  offerId: offerId.describe("The offer the price match is about."),
  site: z.string().describe("The other site, as the request named it."),
  ourTotal: money.describe("That offer's total."),
  claimId: claimId
    .optional()
    .describe("The price match's id, to read it again; absent only when it was declined before any check started."),
  progressUrl: z.string().optional().describe("A page the user can follow the check on; present with claimId."),
  checkAgainAfterSeconds: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("While checking: how many seconds to wait before reading the price match again."),
  step: z.string().optional().describe("While checking: the latest step of the check."),
  seen: z
    .array(priceSeen)
    .nullable()
    .optional()
    .describe("The prices the check saw on the other site; null or absent when none is on record."),
  matchedOffer: matchedOffer.optional().describe("When matched or partial: the new offer."),
  otherTotal: money.optional().describe("When partial: what the other site charges."),
  reason: openEnum(PRICE_MATCH_REASONS)
    .optional()
    .describe(
      "When declined: not_lower, the site was not lower. site_unreadable: the site could not be read. site_not_credible: not a site price match covers. unsupported: an offer price match does not cover. daily_limit, monthly_limit: no more checks for now. unfinished: the check could not finish in time. unavailable: price match is not available now.",
    ),
  note: z.string().optional().describe("One sentence about the check."),
  feeAtProperty: z
    .boolean()
    .nullable()
    .optional()
    .describe("True when a fee payable at the property is left out of the comparison; null or absent when not known."),
});

export type PriceMatch = z.infer<typeof priceMatch>;
