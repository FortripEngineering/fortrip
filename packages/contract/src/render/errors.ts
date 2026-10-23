import type { z } from "zod";

import { parseOpen } from "../conventions/open.ts";
import { ERROR_CODES, type ErrorCode } from "../errors.ts";
import { LIMITS } from "../limits.ts";
import {
  errorEnvelope,
  type ERROR_DETAILS,
  type KnownErrorBody,
} from "../outputs/error-details.ts";
import type { OfferChange } from "../outputs/order.ts";
import { km, label, money, num, plural, raw, when } from "./format.ts";
import {
  cancellationText,
  confirmationText,
  feesText,
  mealsText,
  offerLine,
} from "./offers.ts";
import { ORDER_STATUS_WORDS } from "./order.ts";
import { localitiesLines } from "./search.ts";

/*
 * The error envelope (spec §11) as text. An error that leads to a next call
 * renders that call (§12). Never throws: an unknown code, or a body that
 * does not parse, falls back to the HTTP status, `retryable` and the raw
 * details.
 */

type DetailSchemas = typeof ERROR_DETAILS;
type Details<C extends ErrorCode> = z.output<Exclude<DetailSchemas[C], null>>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function changeLine(c: OfferChange): string {
  const worse = c.worse === true ? " (worse)" : c.worse === false ? " (not worse)" : "";
  const pair = (show: (v: never) => string) =>
    `${show(c.previous as never)} → ${show(c.current as never)}`;
  switch (c.field) {
    case "price":
      return `- price: ${pair(money)}${worse}`;
    case "meals":
      return `- meals: ${pair(mealsText)}${worse}`;
    case "cancellation":
      return `- cancellation: ${pair(cancellationText)}${worse}`;
    case "confirmation":
      return `- confirmation: ${pair(confirmationText)}${worse}`;
    case "pay_at_property":
      return `- fees at the property: ${pair(feesText)}${worse}`;
    default:
      return `- ${c.field}: ${raw(c.previous)} → ${raw(c.current)}${worse}`;
  }
}

function tooBroad(d: Details<"search_too_broad">): string[] {
  const lines = [
    'Next: search again with destination { kind: "locality", placeId: "<id>" } and the same text, filters, stay and sort.',
    ...localitiesLines(d.localities, null),
  ];
  // A locality over the pool is priced from its nearest hotels only; when it
  // is the area's center, a radius around the center prices nearly the same.
  const top = d.localities.items[0];
  if (top && top.total > d.poolLimit && d.center?.place?.placeId === top.place.placeId) {
    lines.push(
      `Or: ${top.place.name}, the area's center, alone has ${num(top.total)} matching hotels: the same destination with radiusMeters (up to ${LIMITS.radiusMetersMax}) prices nearly the same hotels (the nearest ${num(d.poolLimit)} around ${top.place.name}).`,
    );
  }
  return lines;
}

function ambiguous(d: Details<"destination_ambiguous">): string[] {
  const shown =
    d.candidatesTotal > d.candidates.length
      ? `${d.candidates.length} of ${d.candidatesTotal} shown`
      : `${d.candidatesTotal}`;
  const lines = [
    `Places named "${d.name}" in ${d.countryCode} (${shown}). Ask the user which one, then search with destination { kind: "place", placeId: "<id>" }:`,
  ];
  for (const c of d.candidates) {
    const other = [c.names.en, c.names.zh].find((n) => n && n !== c.name);
    const where = [c.region && `${c.region.name} ${c.region.placeId}`, c.countryCode]
      .filter(Boolean)
      .join(", ");
    const hotels =
      c.hotels.scope === "area"
        ? `${plural(c.hotels.count, "hotel")} in the area`
        : c.hotels.radiusMeters === null
          ? plural(c.hotels.count, "hotel")
          : `${plural(c.hotels.count, "hotel")} within ${km(c.hotels.radiusMeters)}`;
    lines.push(
      [
        `- ${c.name}${other ? ` (${other})` : ""} ${c.placeId}`,
        `${c.kind} in ${where}`,
        c.population === null ? "population not recorded" : `population ${num(c.population)}`,
        hotels,
      ].join(" · "),
    );
  }
  if (d.nameAsText !== null) {
    lines.push(`${plural(d.nameAsText, "hotel")} have "${d.name}" in their name or address: it can also be searched as text.`);
  }
  return lines;
}

function notFound(d: Details<"destination_not_found">): string[] {
  switch (d.reason) {
    case "no_match": {
      const m = d as Extract<typeof d, { reason: "no_match" }>;
      const text =
        m.nameAsText === null
          ? ""
          : ` ${plural(m.nameAsText, "hotel")} have "${m.name}" in their name or address: it can be searched as text.`;
      return [`No place named "${m.name}" in ${m.countryCode}.${text}`];
    }
    case "unknown_id":
      return [`Unknown placeId ${(d as { placeId: string }).placeId}.`];
    case "not_a_locality": {
      const n = d as Extract<typeof d, { reason: "not_a_locality" }>;
      const town = `{ kind: "place", placeId: "${n.placeId}" }`;
      if (n.hub === null) {
        return [`${n.placeId} belongs to no locality: search ${town} for an 8 km circle around it.`];
      }
      const total = n.hubTotal === null ? "" : ` (${plural(n.hubTotal, "matching hotel")})`;
      return [
        `${n.placeId} is not a locality. Its hotels belong to the locality ${n.hub.name} ${n.hub.placeId}${total}.`,
        `Search { kind: "locality", placeId: "${n.hub.placeId}" } for those, or ${town} for an 8 km circle around the town itself.`,
      ];
    }
    default:
      return [`Details: ${raw(d)}`];
  }
}

function detailLines(e: KnownErrorBody): string[] {
  if (!("details" in e) || e.details === undefined) return [];
  switch (e.code) {
    case "invalid_request": {
      const d = e.details;
      const lines = d.issues.map((i) => `- ${i.pointer}: ${i.message}`);
      if (d.filterable) lines.push(`Filterable amenities: ${d.filterable.join(", ")}.`);
      if (d.share) {
        lines.push(
          `${d.share.code} is listed by ${(d.share.listedShare * 100).toFixed(1)} % of hotels that list any facility.`,
        );
      }
      return lines;
    }
    case "cursor_invalid":
      return [`The cursor is ${e.details.reason}: search again without a cursor.`];
    case "order_removed":
      return [`Order ${e.details.orderId}, reference ${e.details.reference}.`];
    case "offer_expired":
      return [`Offer ${e.details.offerId} expired at ${when(e.details.expiredAt, null)}: get fresh offers.`];
    case "offer_changed":
      return [
        "Changes:",
        ...e.details.changes.map(changeLine),
        "New offer, held for ordering:",
        offerLine(e.details.offer),
        "Show the user these changes and ask again before ordering the new offer.",
      ];
    case "offer_already_ordered":
    case "order_in_progress":
    case "order_attempts_exhausted":
      return [`Order ${e.details.orderId}.`];
    case "order_exists":
      return [`Order ${e.details.orderId}, ${label(ORDER_STATUS_WORDS, e.details.status)}.`];
    case "destination_ambiguous":
      return ambiguous(e.details);
    case "destination_not_found":
      return notFound(e.details);
    case "search_too_broad":
      return tooBroad(e.details);
    case "stay_unsupported":
      return e.details.reason === "mixed_occupancy"
        ? ["Every room must have the same party: ask once per party."]
        : e.details.reason === "max_nights"
          ? [`At most ${plural((e.details as { max: number }).max, "night")} per stay.`]
          : [`Details: ${raw(e.details)}`];
    case "stay_in_past":
      return [`Check-in ${e.details.checkIn} is already past${e.details.timeZone ? ` in ${e.details.timeZone}` : ""}.`];
    case "offer_unavailable":
      return [
        `Offer ${e.details.offerId}: ${label({ sold_out: "sold out", refused: "can no longer be booked" }, e.details.reason)}. Get fresh offers.`,
      ];
    case "rate_limited":
      return [`Limit reached for: ${e.details.scope}.`];
    case "supplier_unavailable":
      return [
        label(
          {
            not_started: "Nothing was sent to the hotel's supplier.",
            unknown: "The request was sent and timed out: its outcome is unknown.",
          },
          e.details.outcome,
        ),
      ];
    default:
      return [`Details: ${raw((e as { details: unknown }).details)}`];
  }
}

function retryLine(retryable: unknown, after: unknown): string {
  if (retryable === true) {
    return typeof after === "number" ? `Retryable: retry after ${after} s.` : "Retryable.";
  }
  return retryable === false ? "Not retryable." : "Retryable: unknown.";
}

/** The error envelope as text; `status` is the HTTP status, when known. */
export function renderError(envelope: unknown, status?: number): string {
  const http = status === undefined ? "" : ` (HTTP ${status})`;
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
    return `Error${http}: the answer carried no readable error.\nRetryable: unknown.`;
  }

  const code = typeof body.code === "string" ? body.code : "unknown";
  const lines = [
    `Error ${code}${http}${typeof body.message === "string" ? `: ${body.message}` : ""}`,
    retryLine(body.retryable, body.retryAfterSeconds),
  ];
  if (typeof body.param === "string") lines.push(`Field: ${body.param}`);
  if (known) lines.push(...detailLines(known));
  else if (body.details !== undefined) lines.push(`Details: ${raw(body.details)}`);
  if (typeof body.requestId === "string") lines.push(`Request id: ${body.requestId}`);
  return lines.join("\n");
}
