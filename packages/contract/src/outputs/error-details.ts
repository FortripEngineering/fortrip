import { z } from "zod";

import { offerId, orderId, placeId } from "../conventions/ids.ts";
import {
  openEnum,
  openObject,
  openUnion,
  type OpenFallback,
} from "../conventions/open.ts";
import { instant, localDate } from "../conventions/time.ts";
import { ERROR_CODES, type ErrorCode, SUPPLIER_STATUSES } from "../errors.ts";
import { offer } from "./offer.ts";
import { money } from "../conventions/money.ts";
import {
  CREDENTIAL_INVALID_REASONS,
  ORDER_STATUSES,
  offerChange,
  orderCancel,
  PAYMENT_METHOD_UNAVAILABLE_REASONS,
} from "./order.ts";
import { center, place, placeRef } from "./place.ts";
import { localities } from "./search.ts";

/*
 * The error envelope and each code's `details` (spec §11). A code whose row
 * shows "–" carries no `details` (null here).
 */

const count = z.number().int();

/** `supplier_unavailable`'s `details.outcome`: nothing was sent, or the call
 *  was sent and timed out. */
const SUPPLIER_OUTCOMES = ["not_started", "unknown"] as const;

/** The HTTP status `supplier_unavailable` is answered with, by its
 *  `details.outcome`: one of its statuses for each outcome it names. */
export const SUPPLIER_OUTCOME_STATUS: Readonly<
  Record<(typeof SUPPLIER_OUTCOMES)[number], (typeof SUPPLIER_STATUSES)[number]>
> = { not_started: 503, unknown: 504 };

export const ERROR_DETAILS = {
  invalid_request: openObject({
    issues: z.array(openObject({ pointer: z.string(), message: z.string() })),
  }),
  cursor_invalid: openObject({
    reason: openEnum(["expired", "mismatch", "malformed"]),
  }),
  unauthenticated: null,
  forbidden: null,
  not_found: null,
  offer_expired: openObject({ offerId, expiredAt: instant }),
  offer_changed: openObject({ changes: z.array(offerChange).min(1), offer }),
  offer_already_ordered: openObject({ orderId }),
  order_in_progress: openObject({ orderId }),
  cancellation_changed: null,
  order_not_cancellable: openObject({
    cancel: orderCancel.describe(
      "The order's cancel as it is now: the action that applies instead of the one asked for, or what blocks both.",
    ),
  }),
  order_not_payable: openObject({ orderId, status: openEnum(ORDER_STATUSES) }),
  payment_in_progress: openObject({ orderId }),
  payment_total_mismatch: openObject({
    orderId,
    total: money.describe("The order's total, which the total sent did not equal; it has not changed."),
  }),
  payment_credential_invalid: openObject({
    reason: openEnum(CREDENTIAL_INVALID_REASONS),
  }),
  payment_declined: openObject({ declineCode: z.string().nullable() }),
  payment_action_required: null,
  payment_method_unavailable: openObject({
    reason: openEnum(PAYMENT_METHOD_UNAVAILABLE_REASONS),
  }),
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
  search_too_broad: openObject({
    matched: count,
    poolLimit: count,
    localities,
    /** The searched area's center, as a search echoes it; null for text only. */
    center: center.nullable(),
  }),
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
  currency_unavailable: openObject({ currency: z.string() }),
  rate_limited: openObject({
    scope: openEnum([
      "search",
      "offers",
      "hotel",
      "orders_read",
      "orders_create",
      "orders_cancel",
      "orders_pay",
    ]),
  }),
  ordering_paused: null,
  service_unavailable: null,
  supplier_unavailable: openObject({
    outcome: openEnum(SUPPLIER_OUTCOMES),
  }),
  client_outdated: null,
  internal: null,
} satisfies Readonly<Record<ErrorCode, z.ZodType | null>>;

type Details = typeof ERROR_DETAILS;

/** The error body of a known code; `details` typed by the code. */
export type ErrorBody<C extends ErrorCode> = {
  code: C;
  message: string;
  pointer?: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  requestId: string;
} & (Details[C] extends z.ZodType ? { details: z.output<Details[C]> } : unknown);

/** Any known code's error body; narrows by `code`. */
export type KnownErrorBody = { [C in ErrorCode]: ErrorBody<C> }[ErrorCode];

export type ErrorEnvelope = { error: KnownErrorBody | OpenFallback<"code"> };

/**
 * `{ error: { code, message, pointer?, retryable, retryAfterSeconds?, details,
 * requestId } }`, picked by `code`: a known code whose §11 row lists details
 * carries them, parsed as that code's; one whose row shows "–" has none. An
 * unknown code falls back.
 */
export const errorEnvelope = openObject({
  error: openUnion(
    "code",
    (Object.keys(ERROR_CODES) as ErrorCode[]).map((code) => {
      const details: z.ZodType | null = ERROR_DETAILS[code];
      return openObject({
        code: z.literal(code),
        message: z.string(),
        pointer: z
          .string()
          .optional()
          .describe("A JSON Pointer to the one field of the request the error is about, when there is one."),
        retryable: z.boolean(),
        retryAfterSeconds: z.number().int().optional(),
        ...(details ? { details } : {}),
        requestId: z.string(),
      });
    }),
  ),
}) as unknown as z.ZodType<ErrorEnvelope>;
