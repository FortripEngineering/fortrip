import type { z } from "zod";

import { parseOpen } from "../conventions/open.ts";
import { ERROR_CODES, type ErrorCode } from "../errors.ts";
import { LIMITS, SUPPORT_EMAIL } from "../limits.ts";
import {
  errorEnvelope,
  type ERROR_DETAILS,
  type KnownErrorBody,
} from "../outputs/error-details.ts";
import type { OfferChange } from "../outputs/order.ts";
import { CALLS, cancelNextStep, type RenderSurface } from "../tools.ts";
import { km, label, money, named, num, plural, raw, when } from "./format.ts";
import {
  cancellationText,
  confirmationText,
  feesText,
  mealsText,
  offerLine,
} from "./offers.ts";
import { blockerText, cancelFigures, ORDER_STATUS_WORDS } from "./order.ts";
import { localitiesLines } from "./search.ts";
import { code, joined, oneLine, type Ours, ours } from "./third-party.ts";

const CREDENTIAL_INVALID_WORDS: Record<string, string> = {
  not_found: "was not found",
  currency: "is for another currency than USD",
  amount: "allows less than the order's total",
  expired: "expires before it can be charged",
  deactivated: "was revoked",
  used: "was already used, or is held for another order",
  other_seller: "was granted to another seller",
};

/** Why `pay_order` takes no token for the order, and what the user does
 *  instead. */
const PAYMENT_METHOD_UNAVAILABLE_WORDS: Record<string, string> = {
  payment_open_on_page:
    "The user has a payment open on the order's payment page, so a token can't pay it: they finish paying on that page",
  token_not_offered: "This order takes no token now: the user pays by its payment link",
  charge_refused:
    "The charge was refused for a reason a new token wouldn't fix: the user pays by the order's payment link",
};

const SUPPLIER_OUTCOME_WORDS: Record<string, string> = {
  not_started: "Nothing was sent to the hotel's supplier.",
  unknown: "The request was sent and timed out: its outcome is unknown.",
};

/*
 * The error envelope as text, built from its `code` and `details` (spec D2):
 * the server's `message` is written for HTTP readers and names JSON paths, so
 * for every code this build knows the text is Fortrip's own and complete
 * without it. The message is shown only where there are no words of ours to
 * show: a code this build does not know (or details it can't read),
 * `client_outdated`, whose message is the whole answer, and the issues of an
 * `invalid_request`, which quote the caller's own arguments.
 *
 * An error that leads to a next call renders that call. Never throws: an
 * unknown code, or a body that does not parse, falls back to the HTTP
 * status, `retryable`, the message and the raw details. Every line begins
 * with Fortrip's words, and every value of the envelope (a message, a
 * pointer, the request id, names, codes) is one line inside them.
 */

/** What each code says happened: the head of its text, after the code. */
const HAPPENED: Record<Exclude<ErrorCode, "client_outdated">, string> = {
  invalid_request: "the request can't be accepted as sent, and nothing was done. Fix what each line below says, then send it again.",
  cursor_invalid: "this cursor can't continue its list.",
  unauthenticated: "the user is not signed in to Fortrip, or the sign-in is no longer accepted.",
  forbidden: "this sign-in is not allowed to make this call.",
  not_found: "no such hotel, or no such order for this user.",
  offer_expired: "the offer expired, and nothing was ordered.",
  offer_changed: "the price or terms changed since the offer, and nothing was ordered.",
  offer_already_ordered: "this offer was already ordered, with other details; no new order was made.",
  order_in_progress: "the order is still being created, or still being confirmed with the hotel.",
  cancellation_changed: "the penalty for cancelling is now higher than the one sent, and nothing was cancelled.",
  order_not_cancellable: "the order can't be cancelled or closed the way that was asked, and nothing changed.",
  order_not_payable: "this order can't be paid now.",
  payment_in_progress: "a payment of this order is under way.",
  payment_total_mismatch: "the payment was not made.",
  payment_credential_invalid: "the token can't pay this order.",
  payment_declined: "the payment was declined.",
  payment_action_required: "the card asks for a verification that a payment by token can't give.",
  payment_method_unavailable: "this order takes no token now.",
  destination_ambiguous: "several places bear this name.",
  destination_not_found: "the destination can't be searched as it was given.",
  search_too_broad: "too many hotels match to sort or filter them by price.",
  stay_unsupported: "this stay can't be priced or ordered as asked.",
  stay_in_past: "the check-in date has passed.",
  offer_unavailable: "the offer can no longer be ordered, and nothing was ordered.",
  currency_unavailable: "prices in this currency aren't available.",
  rate_limited: "too many calls of this kind in a short time.",
  ordering_paused: "ordering is paused on Fortrip's side.",
  service_unavailable: "Fortrip couldn't answer this time.",
  supplier_unavailable: "the hotel's side couldn't be reached this time.",
  internal: "something went wrong on Fortrip's side.",
};

const CURSOR_WORDS: Record<string, string> = {
  expired: "has expired",
  mismatch: "is not this user's, or was changed",
  malformed: "is not one Fortrip gave",
};

/** What each rate limit counts. */
const RATE_LIMIT_WORDS: Record<string, string> = {
  search: "hotel searches",
  offers: "calls for offers",
  hotel: "reads of a hotel's details",
  orders_read: "reads of orders",
  orders_create: "orders created",
  orders_cancel: "cancellations",
  orders_pay: "payments",
};

type DetailSchemas = typeof ERROR_DETAILS;
type Details<C extends ErrorCode> = z.output<Exclude<DetailSchemas[C], null>>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function changeLine(c: OfferChange): Ours {
  const pair = (show: (v: never) => Ours) => ours`${show(c.previous as never)} → ${show(c.current as never)}`;
  const line = (): Ours => {
    switch (c.field) {
      case "total":
        return ours`- total: ${pair(money)}`;
      case "meals":
        return ours`- meals: ${pair(mealsText)}`;
      case "cancellation":
        return ours`- cancellation: ${pair(cancellationText)}`;
      case "confirmation":
        return ours`- confirmation: ${pair(confirmationText)}`;
      case "payAtProperty":
        return ours`- fees not in the total: ${pair(feesText)}`;
      default:
        return ours`- Change to ${code(c.field, ours`a term not recognized`)}: ${raw(c.previous)} → ${raw(c.current)}`;
    }
  };
  return c.worse === true ? ours`${line()} (worse)` : c.worse === false ? ours`${line()} (not worse)` : line();
}

function tooBroad(d: Details<"search_too_broad">, surface: RenderSurface): Ours[] {
  const locality =
    surface === "cli" ? "--locality <id>" : 'destination { kind: "locality", placeId: "<id>" }';
  const lines = [
    ours`${plural(d.matched, "hotel")} match; a price sort or a price filter covers at most ${num(d.poolLimit)}.`,
    ours`Next: show the user these localities and ask which they prefer, unless their request already names one of them; then search again with ${locality} and the same text, filters, stay and sort.`,
    ...localitiesLines(d.localities, null, surface),
  ];
  // A locality over the pool is priced from its nearest hotels only; when it
  // is the area's center, a radius around the center prices nearly the same.
  const top = d.localities.items[0];
  if (top && top.total > d.poolLimit && d.center?.place?.placeId === top.place.placeId) {
    lines.push(
      ours`Or: ${top.place.name}, the area's center, alone has ${num(top.total)} matching hotels: the same destination with ${surface === "cli" ? "--radius-meters" : "radiusMeters"} (up to ${LIMITS.radiusMetersMax}) prices nearly the same hotels (the nearest ${num(d.poolLimit)} around ${top.place.name}).`,
    );
  }
  return lines;
}

function ambiguous(d: Details<"destination_ambiguous">, surface: RenderSurface): Ours[] {
  const shown =
    d.candidatesTotal > d.candidates.length
      ? ours`${d.candidates.length} of ${d.candidatesTotal} shown`
      : ours`${d.candidatesTotal}`;
  const lines = [
    ours`Places named "${d.name}" in ${d.countryCode} (${shown}). Ask the user which one, then search with ${surface === "cli" ? "--place <id>" : 'destination { kind: "place", placeId: "<id>" }'}:`,
  ];
  for (const c of d.candidates) {
    const hotels =
      c.hotels.radiusMeters === null
        ? ours`${plural(c.hotels.count, "hotel")} in the area`
        : ours`${plural(c.hotels.count, "hotel")} within ${km(c.hotels.radiusMeters)}`;
    lines.push(
      joined(
        [
          ours`- Place: ${named(c.name, c.names)} ${c.placeId}`,
          ours`${code(c.kind, ours`kind not recognized`)} in ${joined([c.region && ours`${c.region.name} ${c.region.placeId}`, oneLine(c.countryCode)], ", ")}`,
          c.population === null ? ours`population not recorded` : ours`population ${num(c.population)}`,
          hotels,
        ],
        " · ",
      ),
    );
  }
  if (d.nameAsText !== null) {
    lines.push(
      ours`Also: ${plural(d.nameAsText, "hotel")} have "${d.name}" in their name or address: it can also be searched as text.`,
    );
  }
  return lines;
}

function notFound(d: Details<"destination_not_found">, surface: RenderSurface): Ours[] {
  switch (d.reason) {
    case "no_match": {
      const m = d as Extract<typeof d, { reason: "no_match" }>;
      const none = ours`No place named "${m.name}" in ${m.countryCode}. Names match exactly, accents and periods included: check the spelling, or try another name for the place.`;
      return [
        m.nameAsText === null
          ? none
          : ours`${none} ${plural(m.nameAsText, "hotel")} have "${m.name}" in their name or address: it can be searched as text.`,
      ];
    }
    case "unknown_id":
      return [ours`No place has the id ${(d as { placeId: string }).placeId}: use an id an earlier answer showed, exactly as shown.`];
    case "not_a_locality": {
      const n = d as Extract<typeof d, { reason: "not_a_locality" }>;
      const town =
        surface === "cli" ? ours`--place ${n.placeId}` : ours`{ kind: "place", placeId: "${n.placeId}" }`;
      if (n.locality === null) {
        return [ours`Place ${n.placeId} belongs to no locality: search ${town} for an 8 km circle around it.`];
      }
      const belongs = ours`Its hotels belong to the locality ${n.locality.name} ${n.locality.placeId}`;
      return [
        n.localityTotal === null
          ? ours`Place ${n.placeId} is not a locality. ${belongs}.`
          : ours`Place ${n.placeId} is not a locality. ${belongs} (${plural(n.localityTotal, "matching hotel")}).`,
        ours`Search ${surface === "cli" ? ours`--locality ${n.locality.placeId}` : ours`{ kind: "locality", placeId: "${n.locality.placeId}" }`} for those, or ${town} for an 8 km circle around the town itself.`,
      ];
    }
    default:
      return [ours`Details: ${raw(d)}`];
  }
}

/** Which of cancel and close applies to the order instead of the one asked
 *  for, or what blocks both. With cancel comes the cancel rule: the caller
 *  may have the order's penalty from this error alone. */
function notCancellable(d: Details<"order_not_cancellable">, surface: RenderSurface): Ours[] {
  const c = d.cancel;
  if (c.action === "close") {
    return [
      ours`This order isn't paid, so it is closed, not cancelled, and nothing is charged. Close it only if the user says they no longer want it (${CALLS[surface].close}).`,
    ];
  }
  if (c.action === "cancel") {
    return [
      ours`This order is paid, so it is cancelled under its terms, not closed: ${cancelFigures(c)}.`,
      ours`${cancelNextStep(surface)}`,
    ];
  }
  if (c.action !== null) {
    return [ours`What applies to this order now: ${code(c.action, ours`an action not recognized`)}.`];
  }
  return [
    ours`This order can be neither cancelled nor closed now: ${blockerText(c)}.`,
  ];
}

/** What happened in detail and what to do next, by code. */
function detailLines(e: KnownErrorBody, surface: RenderSurface): Ours[] {
  const getOrder = (id: string) => (surface === "cli" ? ours`\`fortrip orders get ${id}\`` : ours`get_order`);
  switch (e.code) {
    case "invalid_request": {
      const issues = e.details.issues.map((i) => ours`- Field ${i.pointer}: ${i.message}`);
      // With no issue to show, the message is all there is to fix it by.
      return issues.length > 0 ? issues : [ours`- What was refused: ${e.message}`];
    }
    case "cursor_invalid":
      return [
        ours`The cursor ${label(CURSOR_WORDS, e.details.reason, ours`can't be used`)}: start again from the first page, without a cursor.`,
      ];
    case "unauthenticated":
      return [
        surface === "cli"
          ? ours`The user signs in again through the browser. Never ask them to paste a token.`
          : ours`Ask the user to connect Fortrip again and sign in. Sign-in happens in the browser: never ask them to paste a token.`,
      ];
    case "forbidden":
      return [ours`Tell the user. Sending it again won't help.`];
    case "not_found":
      return [ours`Use an id an earlier answer showed, exactly as shown.`];
    case "offer_expired":
      return [
        ours`Offer ${e.details.offerId} expired at ${when(e.details.expiredAt, null)}: get offers again and let the user choose again.`,
      ];
    case "offer_changed":
      return [
        ours`Changes:`,
        ...e.details.changes.map(changeLine),
        ours`New offer, held for ordering:`,
        offerLine(e.details.offer),
        ours`Show the user these changes and ask again before ordering the new offer.`,
      ];
    case "offer_already_ordered":
      return [
        ours`Order ${e.details.orderId}: read it with ${getOrder(e.details.orderId)}. An offer is ordered once, even when its order failed or expired: for another order of the stay (another party, or a corrected guest name or contact), get offers again and order the new offer. When a new order replaces an unpaid one, tell the user to pay only the new link: the earlier one expires unpaid.`,
      ];
    case "order_in_progress":
      return [ours`Order ${e.details.orderId}: wait, then send the same call again with the same details.`];
    case "cancellation_changed":
      return [
        ours`Read the order again with ${getOrder("<orderId>")}, show the user the penalty and the refund now on its Cancel line, and ask them again before cancelling.`,
      ];
    case "order_not_cancellable":
      return notCancellable(e.details, surface);
    case "order_not_payable":
      return [
        ours`Order ${e.details.orderId}, ${label(ORDER_STATUS_WORDS, e.details.status, ours`status not recognized`)}: read it with ${getOrder(e.details.orderId)}; this call charged nothing.`,
      ];
    case "payment_in_progress":
      return [ours`Order ${e.details.orderId}: read it with ${getOrder(e.details.orderId)} in a few seconds.`];
    case "payment_total_mismatch": {
      const again =
        surface === "cli"
          ? ours`run the same \`fortrip orders pay ${e.details.orderId}\` command again with \`--total ${e.details.total.amount}\``
          : ours`call pay_order again with it and the same token`;
      return [
        ours`The total sent is not the order's: order ${e.details.orderId} totals ${money(e.details.total)}, and that has not changed. Confirm this total with the user, then ${again}. Nothing was charged.`,
      ];
    }
    case "payment_credential_invalid":
      return [
        ours`The token ${label(CREDENTIAL_INVALID_WORDS, e.details.reason, ours`was refused for a reason not recognized`)}: request a new one with the usage limits on the order's "Pay without the link" line. Nothing was charged.`,
      ];
    case "payment_method_unavailable": {
      const why = Object.hasOwn(PAYMENT_METHOD_UNAVAILABLE_WORDS, e.details.reason)
        ? label(PAYMENT_METHOD_UNAVAILABLE_WORDS, e.details.reason)
        : ours`This order takes no token now (reason ${code(e.details.reason, ours`not recognized`)}): the user pays by its payment link`;
      return [ours`${why}. Read the order with ${getOrder("<orderId>")}. This call charged nothing.`];
    }
    case "payment_declined": {
      const declined = e.details.declineCode ? ours`Declined (${e.details.declineCode})` : ours`Declined`;
      return [
        ours`${declined}: the user picks another card in their Link wallet for a new token, or pays by link: read the order with ${getOrder("<orderId>")} and give its payment link.`,
      ];
    }
    case "payment_action_required":
      return [
        ours`The user pays by link instead: read the order with ${getOrder("<orderId>")} and give its payment link.`,
      ];
    case "destination_ambiguous":
      return ambiguous(e.details, surface);
    case "destination_not_found":
      return notFound(e.details, surface);
    case "search_too_broad":
      return tooBroad(e.details, surface);
    case "stay_unsupported":
      return e.details.reason === "mixed_occupancy"
        ? [ours`Every room must have the same party: ask once per party.`]
        : e.details.reason === "max_nights"
          ? [
              ours`At most ${plural((e.details as { max: number }).max, "night")} per stay: ask the user whether to split it into consecutive stays, each its own order.`,
            ]
          : [ours`Details: ${raw(e.details)}`];
    case "stay_in_past":
      return [
        e.details.timeZone
          ? ours`Check-in ${e.details.checkIn} is already past in ${e.details.timeZone}: ask the user for new dates.`
          : ours`Check-in ${e.details.checkIn} is already past: ask the user for new dates.`,
      ];
    case "offer_unavailable":
      return [
        ours`Offer ${e.details.offerId}: ${label({ sold_out: "sold out", refused: "can no longer be booked" }, e.details.reason, ours`unavailable, for a reason not recognized`)}. Other offers for the same room may be gone too: get offers again.`,
      ];
    case "currency_unavailable":
      return [
        ours`Prices in ${e.details.currency} aren't available yet. Tell the user, and ask whether to see USD prices.`,
      ];
    case "rate_limited":
      return [
        ours`The limit reached counts ${label(RATE_LIMIT_WORDS, e.details.rateLimit, ours`calls of a kind not recognized`)}: wait, then retry once.`,
      ];
    case "ordering_paused":
      return [ours`Tell the user, and try again later: no sooner than the retry line says.`];
    case "service_unavailable":
      return [
        ours`Retry once with the same details (a payment with the same token, never a new one); if it fails again, tell the user.`,
      ];
    case "supplier_unavailable":
      return [
        Object.hasOwn(SUPPLIER_OUTCOME_WORDS, e.details.outcome)
          ? label(SUPPLIER_OUTCOME_WORDS, e.details.outcome)
          : ours`Outcome: ${code(e.details.outcome, ours`not recognized`)}.`,
        ours`Retry once with the same details; if it fails again, tell the user.`,
      ];
    case "internal":
      return [ours`Tell the user; for help they email ${SUPPORT_EMAIL} with the request id below.`];
    case "client_outdated":
      return [];
    default:
      return [ours`Details: ${raw((e as { details?: unknown }).details)}`];
  }
}

function retryLine(retryable: unknown, after: unknown): Ours {
  if (retryable === true) {
    return typeof after === "number" ? ours`Retryable: retry after ${after} s.` : ours`Retryable.`;
  }
  return retryable === false ? ours`Not retryable.` : ours`Retryable: unknown.`;
}

/** The error envelope as text; `status` is the HTTP status, when known.
 *  `surface` names the next calls: tools (`mcp`, the default) or commands
 *  (`cli`). */
export function renderError(
  envelope: unknown,
  status?: number,
  surface: RenderSurface = "mcp",
): string {
  let known: KnownErrorBody | null = null;
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = parseOpen(errorEnvelope, envelope).error;
    body = parsed as Record<string, unknown>;
    if (Object.hasOwn(ERROR_CODES, parsed.code)) known = parsed as KnownErrorBody;
  } catch {
    if (isObject(envelope) && isObject(envelope.error)) body = envelope.error;
  }
  if (body === null) {
    const lines = [
      status === undefined
        ? ours`Error: the answer carried no readable error.`
        : ours`Error (HTTP ${status}): the answer carried no readable error.`,
      ours`Retryable: unknown.`,
    ];
    return lines.join("\n");
  }

  // The code as it came only when it reads as one. What happened is ours
  // for a code this build knows; otherwise it is the server's message, which
  // may quote the caller: one line, after our words.
  const name = typeof body.code === "string" ? code(body.code, ours`unknown`) : ours`unknown`;
  const head = status === undefined ? ours`Error ${name}` : ours`Error ${name} (HTTP ${status})`;
  const happened =
    known && known.code !== "client_outdated"
      ? HAPPENED[known.code]
      : typeof body.message === "string"
        ? body.message
        : null;
  const lines = [
    happened === null ? head : ours`${head}: ${happened}`,
    retryLine(body.retryable, body.retryAfterSeconds),
  ];
  if (typeof body.pointer === "string") lines.push(ours`Field: ${body.pointer}`);
  if (known) lines.push(...detailLines(known, surface));
  else if (body.details !== undefined) lines.push(ours`Details: ${raw(body.details)}`);
  if (typeof body.requestId === "string") lines.push(ours`Request id: ${body.requestId}`);
  return lines.join("\n");
}
