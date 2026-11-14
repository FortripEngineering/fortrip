import type { RoomType } from "../outputs/hotel.ts";
import type { HotelOffersResult, Offer } from "../outputs/offer.ts";
import { LIMITS } from "../limits.ts";
import type { RenderSurface } from "../tools.ts";
import { label, money, named, party, plural, roomFacts, stayLine, when } from "./format.ts";
import { code, joined, type Ours, ours, own, theirs, token } from "./third-party.ts";

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
const MEALS_UNKNOWN = ours`meals not stated by the supplier — not known to be room only, may include breakfast; ask or check at booking`;

/** What the rate includes to eat, without the rate's own label. */
export function mealsText(m: Meals): Ours {
  if (!m.known) return MEALS_UNKNOWN;
  if (m.included === null) return ours`meals not stated`;
  let base: Ours;
  if (m.allInclusive) {
    base = ours`all inclusive`;
  } else {
    // `unspecifiedMainMeals: null` means unstated, never none.
    const extra = m.unspecifiedMainMeals;
    const parts = m.included.map((meal) => code(meal, ours`a meal not recognized`));
    if (extra !== null && extra > 0) parts.push(ours`${plural(extra, "more main meal")} (not named)`);
    if (parts.length === 0 && extra === 0) return ours`room only`;
    base = parts.length > 0 ? joined(parts, " + ") : ours`no meals named`;
    if (extra === null) base = ours`${base}; other main meals not stated`;
  }
  return m.guestsCoveredPerRoom === null
    ? ours`${base}, guests covered not stated`
    : ours`${base} for ${plural(m.guestsCoveredPerRoom, "guest")} per room`;
}

/** Meals with the rate's own label, for offer and order lines. */
export function mealsWithLabel(m: Meals): Ours {
  const text = mealsText(m);
  return m.label ? ours`${text} (labelled ${theirs(m.label.text)})` : text;
}

export function cancellationText(c: Cancellation): Ours {
  const unknown = ours`cancellation terms unknown`;
  if (c.status === "unknown") return unknown;
  const steps = joined(
    c.penalties.map(
      (p) => ours`${money(p.amount)} from ${p.startsAt === null ? "booking" : when(p.startsAt, c.timeZone)}`,
    ),
    "; ",
  );
  if (c.status === "free") {
    const head =
      c.freeCancellationEndsAt === null
        ? ours`free cancellation until check-in`
        : ours`free cancellation until ${when(c.freeCancellationEndsAt, c.timeZone)}`;
    return steps ? ours`${head}, then ${steps}` : head;
  }
  const head = label(
    { partial_penalty: "partial penalty now", non_refundable: "non-refundable" },
    c.status,
    unknown,
  );
  return steps ? ours`${head}: ${steps}` : head;
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
  other: "other fee",
  unknown: "fee of a kind not stated",
};

export function feesText(p: PayAtProperty): Ours {
  const items = joined(
    p.items.map((i) => {
      const kind = label(FEE_KINDS, i.kind, ours`fee of a kind not stated`);
      return joined(
        [
          i.amount ? ours`${kind} ${money(i.amount)}` : ours`${kind}, amount not stated`,
          label(BASES, i.basis, ours`basis unknown`),
          i.mandatory ? ours`mandatory` : ours`optional`,
        ],
        ", ",
      );
    }),
    "; ",
  );
  const listed = ours`fees not in the total: ${items}`;
  if (p.disclosure === "complete") {
    return items ? listed : ours`nothing to pay at the property`;
  }
  const caveat =
    p.disclosure === "incomplete"
      ? ours`fees not fully disclosed (fees or amounts may be missing)`
      : ours`fees not in the total: disclosure ${code(p.disclosure, ours`not recognized`)}`;
  return items ? ours`${listed}; ${caveat}` : caveat;
}

export function confirmationText(c: Confirmation): Ours {
  if (c.mode === "instant") return ours`instant confirmation`;
  if (c.mode === "on_request") {
    return c.withinMinutes === null
      ? ours`confirmation on request`
      : ours`confirmation on request, within ${c.withinMinutes} min`;
  }
  if (c.mode === "unknown") return ours`confirmation mode unknown`;
  return ours`confirmation ${code(c.mode, ours`mode unknown`)}`;
}

/** A room type's name and facts, for an offer's line and an order's room. */
export function roomTypeText(r: RoomType): Ours {
  return joined([r.name ? theirs(r.name.text) : ours`room name not listed`, ...roomFacts(r)], ", ");
}

/** One offer on one line: "Offer", then its id. */
export function offerLine(o: Offer): Ours {
  return joined(
    [
      ours`Offer ${token("id", o.offerId)}`,
      ours`${plural(o.roomCount, "room")}: ${roomTypeText(o.roomType)}`,
      ours`${money(o.total)} total (average ${money(o.perRoomNight)} per room-night)`,
      mealsWithLabel(o.meals),
      cancellationText(o.cancellation),
      confirmationText(o.confirmation),
      feesText(o.payAtProperty),
      ours`offer expires ${when(o.expiresAt, null)}`,
    ],
    " · ",
  );
}

const OMITTED: Record<string, string> = {
  byNationality: "restricted by nationality",
  byFilters: "removed by the filters",
  dominated: "beaten by or the same as another offer for the same room",
  unreadable: "unreadable",
};

/** How `surface` names the per-hotel limit and the two filters. */
function limitWords(surface: RenderSurface) {
  return surface === "cli"
    ? ({ limit: "--limit-per-hotel", filters: "--require-breakfast / --require-free-cancellation", sent: "given" } as const)
    : ({ limit: "limitPerHotel", filters: "requireBreakfast / requireFreeCancellation", sent: "sent" } as const);
}

/** Offers left out because the call's hotels share its offers: a call for
 *  the hotel alone shows them, with the limit the call gave when it gave
 *  one (`sent`): without it such a call takes the default again. */
function callLimitText(o: Record<string, unknown>, sent: number | null, surface: RenderSurface): Ours | null {
  const n = o.byCallLimit;
  if (typeof n !== "number" || n <= 0) return null;
  const alone = sent === null ? ours`A call for this hotel alone` : ours`A call for this hotel alone with the same ${limitWords(surface).limit}`;
  return ours`${alone} would show ${plural(n, "more offer")}: this call's offers are shared among its hotels`;
}

/**
 * Offers cut by the per-hotel limit exist: say so where they are missing,
 * by the limit that cut them. `sent` is the limit the call gave, or null:
 * then the default cut them, and no parameter is named as the caller's.
 * A limit already at the most there is leaves only a filter to show more.
 */
function limitText(o: Record<string, unknown>, sent: number | null, surface: RenderSurface): Ours | null {
  const n = o.byLimit;
  if (typeof n !== "number" || n <= 0) return null;
  const { limit, filters, sent: was } = limitWords(surface);
  const cut = ours`${plural(n, "more offer")} not shown`;
  const exist = ours`may show them — don't conclude they don't exist`;
  if (sent === null) {
    return ours`${cut}: no ${limit} was ${was}, so a hotel gets at most ${LIMITS.offersPerHotelDefault}; ${limit} up to ${LIMITS.offersPerHotelMax} in a call for this hotel alone, or a filtered request (${filters}), ${exist}`;
  }
  return sent >= LIMITS.offersPerHotelMax
    ? ours`${cut}: over your ${limit} (${sent}), the most a hotel gets; a filtered request (${filters}) ${exist}`
    : ours`${cut}: over your ${limit} (${sent}); a higher ${limit}, up to ${LIMITS.offersPerHotelMax}, or a filtered request (${filters}) ${exist}`;
}

function omittedText(o: Record<string, unknown>): Ours {
  return joined(
    Object.entries(OMITTED).map(([key, words]) => {
      const n = o[key];
      return typeof n === "number" && n > 0 && ours`${n} ${own(words)}`;
    }),
    ", ",
  );
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
  const lines: Ours[] = [
    ours`Live offers · ${stayLine(r.stay.checkIn, r.stay.checkOut)} · ${party(r.stay.rooms)}`,
    ours`total = the whole stay and every room, the amount charged; the average per room-night is that total divided by rooms and nights, for comparison only. Fees not in the total are in the property's currency, not converted. Times are UTC, then the hotel's time zone.`,
  ];
  if (r.hotels.length === 0) lines.push(ours``, ours`No hotel has offers for this stay.`);
  for (const h of r.hotels) {
    lines.push(ours``, ours`Hotel: ${named(h.name, h.names)} · ${token("id", h.hotelId)} · ${plural(h.offers.length, "offer")}`);
    h.offers.forEach((o, i) => lines.push(ours`${i + 1}. ${offerLine(o)}`));
    const omitted = omittedText(h.omitted);
    if (omitted) lines.push(ours`Not shown: ${omitted}.`);
    const callLimit = callLimitText(h.omitted, r.limitPerHotel, surface);
    if (callLimit) lines.push(ours`${callLimit}.`);
    const limit = limitText(h.omitted, r.limitPerHotel, surface);
    if (limit) lines.push(ours`Limit: ${limit}.`);
  }
  if (r.unavailable.length > 0) {
    lines.push(ours``, ours`Unavailable:`);
    for (const u of r.unavailable) {
      const why = ours`- Hotel ${token("id", u.hotelId)}: ${label(UNAVAILABLE, u.reason, ours`reason not recognized`)}`;
      const omitted = u.omitted && joined([omittedText(u.omitted), limitText(u.omitted, r.limitPerHotel, surface)], "; ");
      lines.push(omitted ? ours`${why} (${omitted})` : why);
    }
  }
  return lines.join("\n");
}
