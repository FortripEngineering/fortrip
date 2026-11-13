import {
  center,
  ERROR_CODES,
  ERROR_DETAILS,
  type ErrorCode,
  LIMITS,
  localities,
  offer,
  SUPPLIER_OUTCOME_STATUS,
} from "@fortrip/agent-contract";
import type { z } from "zod";
import { fieldShape, type JsonSchema, shapeOf, toJsonSchema } from "./schema-rows.ts";

export interface ErrorRow {
  code: ErrorCode;
  /** `409`, or `503 / 504` for a code answered at two statuses. */
  status: string;
  retryable: boolean;
  /** The fields of `details`, a Markdown line each (a union's branches,
   *  one each), or `null` when the code carries none. */
  details: string[] | null;
  meaning: string;
}

/** When each code is answered and what to do. Keyed by the contract's codes,
 *  so a code the contract gains fails the typecheck until it is described. */
const MEANINGS: Record<ErrorCode, string> = {
  invalid_request:
    "The request doesn't match the input schema, or breaks a rule between fields (a price sort without a stay, say). A known field sent at the wrong depth is named with the path it belongs at. A guest name the hotel's booking system refuses is answered here too, before any order is made. `issues` lists each problem: `pointer`, a JSON Pointer to the field, and `message`.",
  cursor_invalid:
    "The cursor expired, belongs to another request or user, or was never a cursor. Start again from the first page.",
  unauthenticated:
    "No access token, or one Fortrip doesn't accept. Sign in again.",
  forbidden: "The token is valid but doesn't allow this call.",
  not_found: "No such hotel or order, or the order belongs to another account.",
  offer_expired:
    "The offer's `expiresAt` has passed. Get offers again and order a new one.",
  offer_changed:
    "The price or a term changed since the offer, and nothing was ordered. `changes` lists every change by the offer's key that changed (`field`), and `offer` is a new offer with the new terms. Show the changes, ask the user again, then order the new offer.",
  offer_already_ordered:
    "The offer was ordered with different details. An offer is ordered once, even when its order failed or expired: read the order in `orderId`, or get a new offer.",
  order_in_progress:
    "The same offer is being ordered by another request right now, or (for `cancel_order`) the order is still being confirmed. Retry after `retryAfterSeconds` to get its answer.",
  cancellation_changed:
    "The order's cancellation penalty is now higher than the `maximumPenalty` sent, usually because a penalty step has passed. Nothing was cancelled. Read the order again, show the user its `cancel.penalty` and `cancel.refund`, and ask again before cancelling.",
  order_not_cancellable:
    "The call asked to cancel an order that can only be closed, to close one that can only be cancelled, or for either on an order that allows neither. `cancel` is the order's `cancel` as it is now: its `action` is what applies instead (`cancel` with `maximumPenalty`, `close` with `close: true`), or `blockedBy` says what blocks both. `stay_started`, `non_refundable`, `refused` and `support_only` won't change: the user emails support.",
  order_not_payable: `\`pay_order\` on an order that isn't awaiting payment, or whose payment window closes within ${LIMITS.payCutoffMinutes} minutes. \`status\` is the order's. This call charged nothing.`,
  payment_in_progress:
    "Another payment of the order is under way. Read the order after `retryAfterSeconds`.",
  payment_total_mismatch:
    "The `total` sent isn't the order's; `details.total` is, and it hasn't changed. Confirm that total with the user, then call again with it and the same token. This call charged nothing.",
  payment_credential_invalid:
    "The shared payment token can't pay this order. `reason`: `not_found`, `currency` or `amount` (its limits don't fit the order's `payment.token.usageLimits`), `expired`, `deactivated`, `used` (it paid or tried an order before: a token pays one order only) or `other_seller`. Request a new token.",
  payment_declined:
    "The card was declined; `declineCode` is the bank's reason when it gives one. The user can pick another payment method in their wallet, or pay by `payment.url`, which stays open.",
  payment_action_required:
    "The card needs a verification (such as 3-D Secure) that a token payment can't give. The user pays by `payment.url`, which stays open.",
  payment_method_unavailable:
    "No token can pay the order, whatever the token. `reason`: `payment_open_on_page` (the user has a payment open on the order's payment page, and finishes it there), `token_not_offered` (the order's `payment.token` is `null`) or `charge_refused` (Stripe refused the charge for a reason a new token wouldn't fix). The user pays by `payment.url`. This call charged nothing.",
  destination_ambiguous:
    `Several places carry the name. \`candidates\` lists up to ${LIMITS.candidatesShown} with their hotel counts, \`candidatesTotal\` how many there are, and \`nameAsText\` how many hotels match the name as text. Ask the user which one is meant, then search it by \`placeId\`.`,
  destination_not_found:
    "`no_match`: no place in the country carries the name. `unknown_id`: the `placeId` isn't known. `not_a_locality`: the place isn't a locality; `locality` is the one it belongs to, and searching the town itself with `place` gives a radius around it.",
  search_too_broad:
    'A price sort or price filter over an area or text with more matches than can be priced (`poolLimit`). Search one of the listed `localities` as `{ kind: "locality", placeId }`.',
  stay_unsupported:
    "Offers and orders take one party per call, with every room the same (`mixed_occupancy`), and stays up to `max` nights (`max_nights`).",
  stay_in_past:
    "Check-in is already past in the hotel's time zone. Ask the user for new dates.",
  offer_unavailable:
    "The offer can no longer be ordered: it sold out (`sold_out`) or was refused (`refused`). Other offers for the same room may be gone too, so get offers again and let the user choose again.",
  currency_unavailable:
    "Prices in the currency asked for (`currency`) aren't available yet. Tell the user, and ask whether to see USD prices.",
  rate_limited:
    "Too many calls of one kind in a minute; `rateLimit` names the [rate limit](#rate-limits) that was hit. Retry after `retryAfterSeconds`.",
  ordering_paused:
    "Ordering is paused for now. Search and offers still work, and an order already made can still be read. Retry after `retryAfterSeconds`.",
  service_unavailable:
    "A service Fortrip depends on is briefly unavailable. Retry after `retryAfterSeconds`.",
  supplier_unavailable: `The hotel's side didn't answer. \`not_started\` (${SUPPLIER_OUTCOME_STATUS.not_started}): nothing was sent, so retrying is safe. \`unknown\` (${SUPPLIER_OUTCOME_STATUS.unknown}): the call was sent and timed out, so it may have taken effect. Either way, sending the same call again is safe ([retries](/api#retries)).`,
  client_outdated:
    "The Fortrip CLI that sent the call is a major version behind the service. `message` says so and gives the command that updates it. Only the CLI gets this, on its HTTP calls and through `fortrip mcp`; other clients never do.",
  internal: "An unexpected error. The `requestId` helps support find it.",
};

/** Objects the schemas page describes, which a detail links to rather than spells out. */
const DESCRIBED: Array<[z.ZodType, string]> = [
  [offer, "[Offer](/schemas#offers)"],
  [localities, "[`coverage.localities`](/schemas#search-result)"],
  [center, "[`destination.center`](/schemas#search-result)"],
];

type Def = { type: string; innerType?: z.ZodType; shape?: Record<string, z.ZodType> };
const defOf = (schema: z.ZodType) => schema._zod.def as unknown as Def;

/** A field's schema less `.nullable()` and `.optional()`, and whether it can be null. */
function unwrapped(schema: z.ZodType): { inner: z.ZodType; nullable: boolean } {
  let inner = schema;
  let nullable = false;
  for (let def = defOf(inner); (def.type === "nullable" || def.type === "optional") && def.innerType; def = defOf(inner)) {
    nullable ||= def.type === "nullable";
    inner = def.innerType;
  }
  return { inner, nullable };
}

/** The fields of a code's `details`, a Markdown line each: `name`, then its
 *  shape, or a link to the object the schemas page describes. A union of
 *  objects is a line per branch. */
export function detailFields(schema: z.ZodType | null): string[] | null {
  if (!schema) return null;
  const json = toJsonSchema(schema, "output");
  const shape = defOf(schema).shape;
  if (!shape) {
    // A union: each known branch whole (one with a constant discriminator),
    // not the fallback that keeps a branch to come.
    return (json.anyOf ?? json.oneOf ?? [json])
      .filter((branch) => Object.values(branch.properties ?? {}).some((p) => p.const !== undefined))
      .map((branch) => `\`${shapeOf(branch)}\``);
  }
  return Object.entries(json.properties ?? {}).map(([name, prop]) => {
    const optional = json.required?.includes(name) ? "" : " (optional)";
    const field = shape[name];
    const { inner, nullable } = field ? unwrapped(field) : { inner: null, nullable: false };
    const described = DESCRIBED.find(([known]) => known === inner)?.[1];
    if (described) return `\`${name}\`${optional}: ${described}${nullable ? " or `null`" : ""}`;
    const items = prop.type === "array" && prop.items ? prop.items : null;
    return items
      ? `\`${name}[]\`${optional}: \`${fieldShape(items as JsonSchema)}\``
      : `\`${name}\`${optional}: \`${fieldShape(prop)}\``;
  });
}

/** One row per contract error code, in the contract's order. */
export const ERROR_ROWS: ErrorRow[] = (
  Object.keys(ERROR_CODES) as ErrorCode[]
).map((code) => ({
  code,
  status: ERROR_CODES[code].status.join(" / "),
  retryable: ERROR_CODES[code].retryable,
  details: detailFields(ERROR_DETAILS[code] as z.ZodType | null),
  meaning: MEANINGS[code],
}));
