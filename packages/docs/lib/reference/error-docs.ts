import {
  ERROR_CODES,
  ERROR_DETAILS,
  type ErrorCode,
  LIMITS,
  SUPPORT_EMAIL,
} from "@fortrip/agent-contract";
import type { z } from "zod";
import { shapeOf, toJsonSchema } from "./schema-rows.ts";

export interface ErrorRow {
  code: ErrorCode;
  /** `409`, or `503 / 504` for a code answered at two statuses. */
  status: string;
  retryable: boolean;
  /** The shape of `details`, or `null` when the code carries none. */
  details: string | null;
  meaning: string;
}

/** When each code is answered and what to do. Keyed by the contract's codes,
 *  so a code the contract gains fails the typecheck until it is described. */
const MEANINGS: Record<ErrorCode, string> = {
  invalid_request:
    "The request doesn't match the input schema, or breaks a rule between fields (a price sort without a stay, say). `issues` lists each problem: `pointer`, a JSON Pointer to the field, and `message`. Filtering by an amenity that can't filter adds `filterable`, the codes that can, and `share`: for the requested `code`, `listedShare` is the fraction, from 0 to 1, of the hotels that list facilities that list it.",
  cursor_invalid:
    "The cursor expired, belongs to another request or user, or was never a cursor. Start again from the first page.",
  unauthenticated:
    "No access token, or one Fortrip doesn't accept. Sign in again.",
  forbidden: "The token is valid but doesn't allow this call.",
  not_found: "No such hotel or order, or the order belongs to another account.",
  order_removed:
    "The order was never completed and has been removed; no payment is recorded as held. Ordering the same stay again brings back the same `orderId`.",
  offer_expired:
    "The offer's `expiresAt` has passed. Get offers again and order a new one.",
  offer_changed:
    "The hotel supplier's price or terms changed since the offer. `changes` lists every change, and `offer` is a new offer with the new terms. Show the changes, ask the user again, then order the new offer.",
  offer_already_ordered:
    "The offer was ordered with different details. Read the order in `orderId`, or get a new offer.",
  order_exists: `This stay already has an open order for one of these guests (\`orderId\`, \`status\`): show it instead of ordering again; its payment link stays valid. A party with none of its guests can order the stay from a new offer (get offers again), and so can the user once the stay's order is confirmed, cancelled or refused by the hotel. It also answers when the stay's earlier order failed at the hotel with its outcome unknown, or the stay has had 20 orders; for those, the user emails ${SUPPORT_EMAIL}.`,
  order_in_progress:
    "The same offer is being ordered by another request right now, or (for `cancel_order`) the order is still being confirmed. Retry after `retryAfterSeconds` to get its answer.",
  cancellation_changed:
    "The order's cancellation penalty is now higher than the `maximumPenalty` sent, usually because a penalty step has passed. Read the order again, show the user its `cancel.penalty` and `cancel.refund`, and ask again before cancelling.",
  order_not_cancellable:
    "The order can't be cancelled now; `reason` says why, as `order.cancel.reason` does. `stay_started`, `non_refundable` and `refused` won't change: the user emails support. `in_progress` and `not_confirmed` mean the order isn't confirmed yet.",
  order_attempts_exhausted: `This order has reached its limit of attempts and can't be submitted again. The user can email ${SUPPORT_EMAIL} with its reference.`,
  order_not_payable:
    "`pay_order` on an order that isn't awaiting payment, or whose payment window closes within two minutes. `status` is the order's. This call charged nothing.",
  payment_in_progress:
    "Another payment of the order is under way. Read the order after `retryAfterSeconds`.",
  payment_total_changed:
    "The `total` sent isn't the order's. Confirm the order's total with the user, then call again with that total and the same token. This call charged nothing.",
  payment_credential_invalid:
    "The shared payment token can't pay this order. `reason`: `not_found`, `currency` or `amount` (its limits don't fit the order's `payment.credentialLimits`), `expired`, `deactivated`, `used` (it paid or tried an order before: a token pays one order only) or `other_seller`. Request a new token.",
  payment_declined:
    "The card was declined; `declineCode` is the bank's reason when it gives one. The user can pick another payment method in their wallet, or pay by `payment.url`, which stays open.",
  payment_action_required:
    "The card needs a verification (such as 3-D Secure) that a token payment can't give. The user pays by `payment.url`, which stays open.",
  payment_method_unavailable:
    "This order can't be paid with a token (its `payment.handlers` is empty), or it took its limit of tokens. Give the user `payment.url`.",
  destination_ambiguous:
    `Several places carry the name. \`candidates\` lists up to ${LIMITS.candidatesShown} with their hotel counts, \`candidatesTotal\` how many there are, and \`nameAsText\` how many hotels match the name as text. Ask the user which one is meant, then search it by \`placeId\`.`,
  destination_not_found:
    "`no_match`: no place in the country carries the name. `unknown_id`: the `placeId` isn't known. `not_a_locality`: the place is no locality hub; `hub` is the hub it belongs to, and searching the town itself with `place` gives a radius around it.",
  search_too_broad:
    'A price sort or price filter over an area or text with more matches than can be priced (`poolLimit`). Search one of the listed `localities` as `{ kind: "locality", placeId }`.',
  stay_unsupported:
    "Offers and orders take one party per call, with every room the same (`mixed_occupancy`), and stays up to `max` nights (`max_nights`).",
  stay_in_past:
    "Check-in is already past in the hotel's time zone. Ask the user for new dates.",
  offer_unavailable:
    "The hotel supplier no longer sells the offer (`sold_out`), or refused it (`refused`). Get offers again.",
  rate_limited:
    "Too many calls of one kind (`scope`) in a minute. Retry after `retryAfterSeconds`.",
  ordering_paused:
    "Ordering is paused for now. Search and offers still work, and an order already made can still be read. Retry after `retryAfterSeconds`.",
  service_unavailable:
    "A service Fortrip depends on is briefly unavailable. Retry after `retryAfterSeconds`.",
  supplier_unavailable:
    "The hotel supplier didn't answer. `not_started` (503): nothing was sent, so retrying is safe. `unknown` (504): the call was sent and timed out; for an order, read your orders before ordering again.",
  internal: "An unexpected error. The `requestId` helps support find it.",
};

/** The `details` shape of a code, from its contract schema. */
export function detailsShape(schema: z.ZodType | null): string | null {
  return schema ? shapeOf(toJsonSchema(schema, "output")) : null;
}

/** One row per contract error code, in the contract's order. */
export const ERROR_ROWS: ErrorRow[] = (
  Object.keys(ERROR_CODES) as ErrorCode[]
).map((code) => ({
  code,
  status: ERROR_CODES[code].status.join(" / "),
  retryable: ERROR_CODES[code].retryable,
  details: detailsShape(ERROR_DETAILS[code] as z.ZodType | null),
  meaning: MEANINGS[code],
}));
