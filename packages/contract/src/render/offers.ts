import type { RoomType } from "../outputs/hotel.ts";
import type { HotelOffersResult, Offer } from "../outputs/offer.ts";
import type { RenderSurface } from "../tools.ts";
import { label, money, named, party, plural, roomFacts, stayLine, when } from "./format.ts";

/* `get_hotel_offers` (spec §9), and the terms orders and errors share. */

type Meals = Offer["meals"];
type Cancellation = Offer["cancellation"];
type PayAtProperty = Offer["payAtProperty"];
type Confirmation = Offer["confirmation"];

/*
 * Each unknown carries its own negation in place: the v1 output eval found
 * models turning an unknown into the fact around it ("room only", "paid on
 * arrival", "no such room") unless the text beside the data says otherwise.
 */
const MEALS_UNKNOWN =
  "meals not stated by the supplier — not known to be room only, may include breakfast; ask or check at booking";

/** What the rate includes to eat, without the rate's own label. */
export function mealsText(m: Meals): string {
  if (!m.known) return MEALS_UNKNOWN;
  if (m.included === null) return "meals not stated";
  let base: string;
  if (m.allInclusive) {
    base = "all inclusive";
  } else {
    // `unspecifiedMainMeals: null` means unstated, never none.
    const extra = m.unspecifiedMainMeals;
    const parts: string[] = [...m.included];
    if (extra !== null && extra > 0) parts.push(`${plural(extra, "more main meal")} (not named)`);
    if (parts.length === 0 && extra === 0) return "room only";
    base = parts.length > 0 ? parts.join(" + ") : "no meals named";
    if (extra === null) base += "; other main meals not stated";
  }
  return m.guestsCoveredPerRoom === null
    ? `${base}, guests covered not stated`
    : `${base} for ${plural(m.guestsCoveredPerRoom, "guest")} per room`;
}

/** Meals with the rate's own label, for offer and order lines. */
export function mealsWithLabel(m: Meals): string {
  const text = mealsText(m);
  return m.label ? `${text} (labelled "${m.label.text}")` : text;
}

export function cancellationText(c: Cancellation): string {
  if (c.status === "unknown") return "cancellation terms unknown";
  const steps = c.penalties.map(
    (p) => `${money(p.amount)} from ${p.startsAt === null ? "booking" : when(p.startsAt, c.timeZone)}`,
  );
  if (c.status === "free") {
    const head =
      c.freeCancellationEndsAt === null
        ? "free cancellation until check-in"
        : `free cancellation until ${when(c.freeCancellationEndsAt, c.timeZone)}`;
    return steps.length ? `${head}, then ${steps.join("; ")}` : head;
  }
  const head = label(
    { partial_penalty: "partial penalty now", non_refundable: "non-refundable" },
    c.status,
  );
  return steps.length ? `${head}: ${steps.join("; ")}` : head;
}

const BASES: Record<string, string> = {
  per_stay: "per stay",
  per_night: "per night",
  per_person: "per person",
  per_person_per_night: "per person per night",
  unknown: "basis unknown",
};

const FEE_KINDS: Record<string, string> = {
  tax: "tax",
  resort_fee: "resort fee",
  cleaning_fee: "cleaning fee",
  deposit: "deposit",
  other: "other fee",
  unknown: "fee of a kind not stated",
};

export function feesText(p: PayAtProperty): string {
  const items = p.items.map((i) =>
    [
      `${label(FEE_KINDS, i.kind)}${i.amount ? ` ${money(i.amount)}` : ", amount not stated"}`,
      label(BASES, i.basis),
      i.mandatory ? "mandatory" : "optional",
    ].join(", "),
  );
  const listed = `fees not in the total: ${items.join("; ")}`;
  if (p.disclosure === "complete") {
    return items.length ? listed : "nothing to pay at the property";
  }
  const caveat =
    p.disclosure === "incomplete"
      ? "fees not fully disclosed (fees or amounts may be missing)"
      : `fees not in the total: disclosure ${p.disclosure}`;
  return items.length ? `${listed}; ${caveat}` : caveat;
}

export function confirmationText(c: Confirmation): string {
  if (c.mode === "instant") return "instant confirmation";
  if (c.mode === "on_request") {
    return c.withinMinutes === null
      ? "confirmation on request"
      : `confirmation on request, within ${c.withinMinutes} min`;
  }
  if (c.mode === "unknown") return "confirmation mode unknown";
  return `confirmation ${c.mode}`;
}

function roomTypeText(r: RoomType): string {
  return [r.name ? r.name.text : "room name not listed", ...roomFacts(r)].join(", ");
}

/** One offer on one line, its id first. */
export function offerLine(o: Offer): string {
  return [
    o.offerId,
    `${plural(o.roomCount, "room")}: ${roomTypeText(o.roomType)}`,
    `${money(o.total)} total (average ${money(o.perRoomNight)} per room-night)`,
    mealsWithLabel(o.meals),
    cancellationText(o.cancellation),
    confirmationText(o.confirmation),
    feesText(o.payAtProperty),
    `offer expires ${when(o.expiresAt, null)}`,
  ].join(" · ");
}

const OMITTED: Record<string, string> = {
  byNationality: "restricted by nationality",
  byFilters: "removed by the filters",
  dominated: "beaten by or the same as another offer for the same room",
  unreadable: "unreadable",
};

/** Offers left out because the call's hotels share its offers: a call for
 *  the hotel alone shows them. */
function callLimitText(o: Record<string, unknown>): string {
  const n = o.byCallLimit;
  return typeof n === "number" && n > 0
    ? `A call for this hotel alone would show ${plural(n, "more offer")}: this call's offers are shared among its hotels`
    : "";
}

/** Offers cut by `limitPerHotel` exist: say so where they are missing. */
function limitText(o: Record<string, unknown>, surface: RenderSurface): string {
  const n = o.byLimit;
  const [limit, filters] =
    surface === "cli"
      ? ["--limit-per-hotel", "--require-breakfast / --require-free-cancellation"]
      : ["limitPerHotel", "requireBreakfast / requireFreeCancellation"];
  return typeof n === "number" && n > 0
    ? `${plural(n, "more offer")} not shown (${limit}); a filtered request (${filters}) or a higher ${limit} may show them — don't conclude they don't exist`
    : "";
}

function omittedText(o: Record<string, unknown>): string {
  return Object.entries(OMITTED)
    .filter(([key]) => typeof o[key] === "number" && (o[key] as number) > 0)
    .map(([key, words]) => `${o[key]} ${words}`)
    .join(", ");
}

const UNAVAILABLE: Record<string, string> = {
  sold_out: "sold out",
  no_matching_offers: "no offer matches the filters",
  nationality_restricted: "restricted by nationality",
  offers_unreadable: "offers unreadable",
  not_found: "hotel not found",
  supplier_unavailable: "offers could not be fetched this time",
  stay_in_past: "check-in is already past",
};

export function renderOffers(r: HotelOffersResult, surface: RenderSurface = "mcp"): string {
  const lines = [
    `Live offers · ${stayLine(r.stay.checkIn, r.stay.checkOut)} · ${party(r.stay.rooms)}`,
    "total = the whole stay and every room, the amount charged; the average per room-night is that total divided by rooms and nights, for comparison only. Fees not in the total are in the property's currency, not converted. Times are UTC, then the hotel's time zone.",
  ];
  if (r.hotels.length === 0) lines.push("", "No hotel has offers for this stay.");
  for (const h of r.hotels) {
    lines.push("", `${named(h.name, h.names)} · ${h.hotelId} · ${plural(h.offers.length, "offer")}`);
    h.offers.forEach((o, i) => lines.push(`${i + 1}. ${offerLine(o)}`));
    const omitted = omittedText(h.omitted);
    if (omitted) lines.push(`Not shown: ${omitted}.`);
    for (const more of [callLimitText(h.omitted), limitText(h.omitted, surface)]) {
      if (more) lines.push(`${more}.`);
    }
  }
  if (r.unavailable.length > 0) {
    lines.push("", "Unavailable:");
    for (const u of r.unavailable) {
      const omitted = u.omitted
        ? [omittedText(u.omitted), limitText(u.omitted, surface)].filter(Boolean).join("; ")
        : "";
      lines.push(`- ${u.hotelId}: ${label(UNAVAILABLE, u.reason)}${omitted ? ` (${omitted})` : ""}`);
    }
  }
  return lines.join("\n");
}
