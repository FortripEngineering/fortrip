import { z } from "zod";

import { offerId, orderId, placeId } from "../conventions/ids.ts";
import {
  openEnum,
  openObject,
  openUnion,
  strictOutput,
  type OpenFallback,
} from "../conventions/open.ts";
import { instant, localDate } from "../conventions/time.ts";
import { ERROR_CODES, type ErrorCode } from "../errors.ts";
import { AMENITY_CODES } from "../vocabulary.ts";
import { offer } from "./offer.ts";
import { ORDER_STATUSES, offerChange, orderReference } from "./order.ts";
import { place, placeRef } from "./place.ts";
import { localities } from "./search.ts";

/*
 * The error envelope and each code's `details` (spec §11). A code whose row
 * shows "–" carries no `details` (null here).
 */

const count = z.number().int();

export const ERROR_DETAILS = {
  invalid_request: openObject({
    issues: z.array(openObject({ pointer: z.string(), message: z.string() })),
    filterable: z.array(openEnum(AMENITY_CODES)).optional(),
    share: openObject({
      code: openEnum(AMENITY_CODES),
      listedShare: z.number().min(0).max(1),
    }).optional(),
  }),
  cursor_invalid: openObject({
    reason: openEnum(["expired", "mismatch", "malformed"]),
  }),
  unauthenticated: null,
  forbidden: null,
  not_found: null,
  order_removed: openObject({ orderId, reference: orderReference }),
  offer_expired: openObject({ offerId, expiredAt: instant }),
  offer_changed: openObject({ changes: z.array(offerChange).min(1), offer }),
  offer_already_ordered: openObject({ orderId }),
  order_exists: openObject({ orderId, status: openEnum(ORDER_STATUSES) }),
  order_in_progress: openObject({ orderId }),
  order_attempts_exhausted: openObject({ orderId }),
  destination_ambiguous: openObject({
    name: z.string(),
    countryCode: z.string(),
    candidates: z.array(
      openObject({
        ...place.shape,
        hotels: openObject({
          scope: openEnum(["area", "radius"]),
          radiusMeters: z.number().nullable(),
          count,
        }),
      }),
    ),
    candidatesTotal: count,
    nameAsText: count.nullable(),
  }),
  destination_not_found: openUnion("reason", [
    openObject({
      reason: z.literal("no_match"),
      name: z.string(),
      countryCode: z.string(),
      nameAsText: count.nullable(),
    }),
    openObject({ reason: z.literal("unknown_id"), placeId }),
    openObject({
      reason: z.literal("not_a_locality"),
      placeId,
      hub: placeRef.nullable(),
      hubTotal: count.nullable(),
    }),
  ]),
  search_too_broad: openObject({ matched: count, poolLimit: count, localities }),
  stay_unsupported: openUnion("reason", [
    openObject({ reason: z.literal("mixed_occupancy") }),
    openObject({ reason: z.literal("max_nights"), max: count }),
  ]),
  stay_in_past: openObject({
    checkIn: localDate,
    timeZone: z.string().nullable(),
  }),
  offer_unavailable: openObject({
    offerId,
    reason: openEnum(["sold_out", "refused"]),
  }),
  rate_limited: openObject({
    scope: openEnum(["search", "offers", "hotel", "orders_read", "orders_create"]),
  }),
  ordering_paused: null,
  service_unavailable: null,
  supplier_unavailable: openObject({
    outcome: openEnum(["not_started", "unknown"]),
  }),
  internal: null,
} satisfies Readonly<Record<ErrorCode, z.ZodType | null>>;

type Details = typeof ERROR_DETAILS;

/** The error body of a known code; `details` typed by the code. */
export type ErrorBody<C extends ErrorCode> = {
  code: C;
  message: string;
  param?: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  requestId: string;
} & (Details[C] extends z.ZodType ? { details?: z.output<Details[C]> } : unknown);

/** Any known code's error body; narrows by `code`. */
export type KnownErrorBody = { [C in ErrorCode]: ErrorBody<C> }[ErrorCode];

export type ErrorEnvelope = { error: KnownErrorBody | OpenFallback<"code"> };

function envelopeSchema(detailsRequired: boolean) {
  return openObject({
    error: openUnion(
      "code",
      (Object.keys(ERROR_CODES) as ErrorCode[]).map((code) => {
        const details: z.ZodType | null = ERROR_DETAILS[code];
        return openObject({
          code: z.literal(code),
          message: z.string(),
          param: z.string().optional(),
          retryable: z.boolean(),
          retryAfterSeconds: z.number().int().optional(),
          ...(details
            ? { details: detailsRequired ? details : details.optional() }
            : {}),
          requestId: z.string(),
        });
      }),
    ),
  });
}

/**
 * `{ error: { code, message, param?, retryable, retryAfterSeconds?, details?,
 * requestId } }`, picked by `code`: a known code parses its own details, an
 * unknown code falls back. `details` is optional here, for clients.
 */
export const errorEnvelope = envelopeSchema(false) as unknown as z.ZodType<ErrorEnvelope>;

/**
 * Server tests only: the closed envelope, where a code whose §11 row lists
 * details must carry them and a code whose row shows "–" must not.
 */
export function strictErrorEnvelope(): z.ZodType<{ error: KnownErrorBody }> {
  return strictOutput(envelopeSchema(true)) as unknown as z.ZodType<{
    error: KnownErrorBody;
  }>;
}
