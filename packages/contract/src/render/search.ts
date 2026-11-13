import { LIMITS } from "../limits.ts";
import { type HotelSummary, type SearchNote, type SearchNoteCode, searchNote, type SearchResult } from "../outputs/search.ts";
import type { RenderSurface } from "../tools.ts";
import { km, label, money, named, num, party, plural, stayLine } from "./format.ts";
import { code, joined, type Ours, ours, theirs, token } from "./third-party.ts";

/* `search_hotels` (spec §12, §7.6, §7.8). The names of places and hotels,
 * address lines and the caller's own text are in quotes; ids, country codes
 * and URLs are bare. */

type Destination = NonNullable<SearchResult["destination"]>;
type PlaceDestination = Extract<Destination, { kind: "place" }>;
type PointDestination = Extract<Destination, { kind: "point" }>;
type Localities = NonNullable<SearchResult["coverage"]["localities"]>;
/** The note of a code that carries details. */
type Note<C extends SearchNoteCode> = Extract<SearchNote, { code: C }>;

const SORTS: Record<string, string> = {
  distance: "nearest first",
  relevance: "best text match first",
  stars_desc: "most stars first",
  price_asc: "cheapest first",
  price_desc: "dearest first",
};

const CENTER_BASES: Record<string, string> = {
  seat: "the seat",
  capital: "the capital",
  busiest_settlement: "the settlement with the most hotels",
  locality: "the locality",
  point: "its location",
};

function radiusWords(meters: number, source: string | null): Ours {
  return source === "default" ? ours`within ${km(meters)}, the default radius` : ours`within ${km(meters)}`;
}

/** `Place: "Phuket" (locality) · 2,752 hotels · plc_… · "Phuket Province" plc_…, TH · also named "普吉"`. */
function placeHeader(d: PlaceDestination, matched: number): Ours {
  const p = d.place;
  const kind = code(p.kind, ours`kind not recognized`);
  const scope =
    d.scope === "locality"
      ? ours`locality`
      : d.scope === "area"
        ? d.radiusMeters === null
          ? kind
          : ours`${kind}, within ${km(d.radiusMeters)} of its center`
        : d.scope === "radius"
          ? d.radiusMeters === null
            ? ours`${kind}, radius not stated`
            : ours`${kind}, ${radiusWords(d.radiusMeters, d.radiusSource)}`
          : ours`${kind}, scope ${code(d.scope, ours`not recognized`)}`;
  const other = [p.names.en, p.names.zh].find((n) => n && n !== p.name);
  return joined(
    [
      ours`Place: ${theirs(p.name)} (${scope})`,
      plural(matched, "hotel"),
      token("id", p.placeId),
      joined([p.region && ours`${theirs(p.region.name)} ${token("id", p.region.placeId)}`, token("country", p.countryCode)], ", "),
      other ? ours`also named ${theirs(other)}` : "",
    ],
    " · ",
  );
}

function header(r: SearchResult): Ours {
  const d = r.destination;
  const hotels = plural(r.coverage.matched, "hotel");
  if (d === null) return r.text ? ours`Text ${theirs(r.text)} · ${hotels}` : ours`All hotels · ${hotels}`;
  let head: Ours;
  if (d.kind === "place") {
    head = placeHeader(d as PlaceDestination, r.coverage.matched);
  } else if (d.kind === "point") {
    const p = d as PointDestination;
    const { lat, lng } = p.center.location;
    head = ours`Point ${lat}, ${lng} (${radiusWords(p.radiusMeters, p.radiusSource)}) · ${hotels}`;
  } else {
    head = ours`Destination of kind ${code(d.kind, ours`not recognized`)} · ${hotels}`;
  }
  return r.text ? ours`${head} · text ${theirs(r.text)} (exact words)` : head;
}

function centerLine(d: Destination | null): Ours | null {
  if (d === null || (d.kind !== "place" && d.kind !== "point")) return null;
  const c = (d as PlaceDestination | PointDestination).center;
  const from = c.place ? ours`${theirs(c.place.name)} ${token("id", c.place.placeId)}` : ours`${c.location.lat}, ${c.location.lng}`;
  return ours`Distances from ${from} (${label(CENTER_BASES, c.basis, ours`basis not recognized`)}).`;
}

function pricingWords(r: SearchResult): Ours {
  const { mode, covers, status } = r.pricing;
  if (mode === "none") return ours`no prices (no stay given)`;
  if (mode === "indicative" && status === "unavailable") {
    return ours`indicative prices unavailable this time`;
  }
  if (mode === "indicative") {
    return ours`indicative prices per room-night: estimates from a price floor, not for this party, possibly a bed in a shared room, possibly days old; not bookable (only offers are)`;
  }
  const unknown = ours`not recognized`;
  return ours`prices ${joined([code(mode, unknown), covers && code(covers, unknown), status && code(status, unknown)], ", ")}`;
}

function countsLine(r: SearchResult): Ours {
  const c = r.coverage;
  const country =
    r.destination?.kind === "place"
      ? token("country", (r.destination as PlaceDestination).place.countryCode)
      : ours`the country`;
  const parts = [ours`${num(c.matched)} matched`];
  if (c.priced !== null) parts.push(ours`${num(c.priced)} priced`);
  if (c.withPrice !== null) parts.push(ours`${num(c.withPrice)} with a price`);
  else if (r.pricing.mode === "indicative") parts.push(ours`with a price: unknown`);
  if (c.excludedNoPrice !== null) {
    parts.push(ours`${num(c.excludedNoPrice)} left out for having no indicative price`);
  }
  if (c.excludedNoFacilityData !== null) {
    parts.push(ours`${num(c.excludedNoFacilityData)} left out for listing no facilities`);
  }
  if (c.withinMaxRadius !== null) {
    parts.push(ours`${num(c.withinMaxRadius)} within ${LIMITS.radiusMetersMax / 1000} km`);
  }
  if (c.textAnywhere !== null) {
    parts.push(ours`${num(c.textAnywhere)} match the text anywhere in ${country}`);
  }
  if (c.nameAsText !== null) parts.push(ours`${num(c.nameAsText)} have the name as text`);
  return ours`Counts: ${joined(parts, ", ")}.`;
}

/**
 * The localities block (§12), for a search and for `search_too_broad`.
 * `areaName` labels a locality named like the searched area.
 */
export function localitiesLines(
  loc: Localities,
  areaName: string | null,
  surface: RenderSurface = "mcp",
): Ours[] {
  const back =
    surface === "cli" ? "--locality <placeId>" : 'destination { kind: "locality", placeId }';
  const lines = [
    ours`Localities: pass one back as ${back}, never the name. The number is its matching hotels; "incl." lists places inside it, with all their hotels regardless of filters ("hotels overall").`,
  ];
  for (const item of loc.items) {
    let line = ours`- Locality: ${theirs(item.place.name)} ${token("id", item.place.placeId)} ${num(item.count)}`;
    if (item.localityTotal !== item.count) line = ours`${line} here, ${num(item.localityTotal)} as a locality`;
    const sameName =
      areaName !== null &&
      [item.place.name, item.place.names.en, item.place.names.zh].some(
        (n) => n?.toLowerCase() === areaName.toLowerCase(),
      );
    if (sameName) line = ours`${line} — the locality, not the whole of ${theirs(areaName)}`;
    if (item.includes.length > 0) {
      const inc = item.includes.map(
        (i) => ours`${theirs(i.place.name)} ${token("id", i.place.placeId)}, ${num(i.members)} hotels overall`,
      );
      line = ours`${line} (incl. ${joined(inc, "; ")})`;
    }
    lines.push(line);
  }
  if (loc.unassigned > 0) {
    lines.push(ours`Unassigned: ${plural(loc.unassigned, "hotel")} in this search belong to no locality.`);
  }
  if (loc.more > 0) {
    lines.push(
      ours`More: ${num(loc.more)} more localities; name one with ${surface === "cli" ? "--place-name and --country" : "place_name"}.`,
    );
  }
  return lines;
}

function priceWords(h: HotelSummary, status: string | null): Ours {
  const p = h.indicativePrice;
  if (p === null) {
    return status === "ok" ? ours`no indicative price` : ours`price unavailable this time`;
  }
  return ours`estimate from ${money(p.fromPerRoomNight)}/room-night (${money(p.fromPerRoomStay)} per room for the stay)`;
}

function hotelLine(h: HotelSummary, i: number, r: SearchResult): Ours {
  const region = h.address.region;
  return joined(
    [
      ours`${i + 1}. Hotel: ${named(h.name, h.names)}`,
      h.stars === null ? ours`stars not listed` : ours`${h.stars}★`,
      r.destination === null
        ? ""
        : h.distanceMeters === null
          ? ours`distance unknown`
          : km(h.distanceMeters),
      r.pricing.mode === "none" ? "" : priceWords(h, r.pricing.status),
      h.address.line ? theirs(h.address.line.text) : ours`address not listed`,
      joined([region && theirs(region.name), h.address.countryCode && token("country", h.address.countryCode)], ", "),
      h.photo ? ours`photo ${token("url", h.photo.url)}` : "",
      token("id", h.hotelId),
    ],
    " · ",
  );
}

const HINT_REASONS = {
  request_location: "this request comes from mainland China",
  sign_in_location: "the user's latest sign-in to Fortrip was from mainland China",
} as const;

/** The currency hint (`currencyHint`): a fact and a suggestion, the
 *  agent's to weigh. */
function currencyHintLine(hint: NonNullable<SearchResult["currencyHint"]>, surface: RenderSurface): Ours {
  const reason = HINT_REASONS[hint.reason as keyof typeof HINT_REASONS];
  const again =
    surface === "cli"
      ? "search and get offers with --currency CNY"
      : "search and get offers with currency CNY";
  const offer = ours`Prices are also available in CNY, paid through payment channels in mainland China; if the user may pay that way, offer them CNY prices: ${again}.`;
  return reason ? ours`Currency: ${reason}. ${offer}` : ours`Currency: ${offer}`;
}

/** The place a search is in, in words; a search with none still reads. */
function placeOf(r: SearchResult): { name: Ours; kind: Ours; countryCode: Ours } {
  const place = r.destination?.kind === "place" ? (r.destination as PlaceDestination).place : null;
  return {
    name: place ? theirs(place.name) : ours`This place`,
    kind: place ? code(place.kind, ours`area`) : ours`area`,
    countryCode: place ? token("country", place.countryCode) : ours`the country`,
  };
}

/** What to try when a search has no hotel to show, from what it counted. */
function nextSteps(r: SearchResult): Ours {
  const c = r.coverage;
  const steps: Ours[] = [];
  if (c.excludedNoPrice !== null) steps.push(ours`raise or drop the price limit`);
  if (c.excludedNoFacilityData !== null) steps.push(ours`drop an amenity filter`);
  if (r.text !== null) steps.push(ours`check the text's words (exact words only) or drop it`);
  if (r.destination !== null && c.textAnywhere !== null && c.textAnywhere > c.matched) {
    steps.push(ours`search the text without the destination`);
  }
  if (c.withinMaxRadius !== null && c.withinMaxRadius > c.matched) steps.push(ours`widen the search radius`);
  if (c.nameAsText !== null && c.nameAsText > 0) steps.push(ours`search the name as text`);
  if (steps.length === 0) steps.push(ours`try another destination or fewer filters`);
  return joined(steps, "; ");
}

/**
 * A note in Fortrip's words, from its code, the search it is on and, for
 * the two codes that carry them, its details (a count, a list of places):
 * its `message` is written for HTTP readers (it names JSON paths). Without
 * details the code's plain sentence stands. null for a code this build does
 * not know, whose message is then shown.
 */
function noteText(note: SearchNote, r: SearchResult, surface: RenderSurface): Ours | null {
  const c = r.coverage;
  const p = placeOf(r);
  const d = r.destination?.kind === "place" ? (r.destination as PlaceDestination) : null;
  switch (note.code as SearchNoteCode) {
    case "indicative_prices":
      return ours`the prices are estimates, in the currency asked for, and not bookable: offers give what the user pays.`;
    case "prices_unavailable":
      return ours`indicative prices are unavailable right now, so no hotel shows one. Try again shortly, or get offers for the hotels.`;
    case "pool_limited":
      return ours`more than ${num(LIMITS.poolLimit)} hotels match, so only the nearest were priced: the price order and the price filter cover those alone, and cheaper hotels farther out are not compared.`;
    case "amenities_listed_only":
      return c.excludedNoFacilityData === null
        ? ours`amenity filters match hotels that list the amenity; not listed is not absent.`
        : ours`amenity filters match hotels that list the amenity; not listed is not absent. ${plural(c.excludedNoFacilityData, "hotel")} here list no facilities at all and were left out.`;
    case "place_resolved_dominant":
      return d
        ? ours`the name also belongs to ${plural(d.otherMatches, "other place")} in ${p.countryCode}; this is the most populous, ${p.name} ${token("id", d.place.placeId)}.`
        : ours`the name also belongs to other places; this is the most populous.`;
    case "area_absorbed": {
      const inside = (note as Note<"area_absorbed">).details?.places ?? [];
      const whole = ours`${p.name} is searched as the whole ${p.kind}`;
      if (inside.length === 0) return ours`${whole}: smaller places of the same name are inside it.`;
      const places = inside.map(
        (a) => ours`${theirs(a.name)} ${token("id", a.placeId)} (${code(a.kind, ours`kind not recognized`)})`,
      );
      return ours`${whole}, which includes ${plural(inside.length, "smaller place")} of the same name: ${joined(places, "; ")}.`;
    }
    case "broad_area":
      return ours`${p.name} is a wide ${p.kind}, not one city: results run outward from its center. Search one of the localities listed above for one town.`;
    case "island_radius":
      return ours`this is a circle around the island's point: the island has no mapped outline, so the circle may miss parts of it or reach other shores.`;
    case "area_retired":
      return ours`this place id was retired: it now searches a circle around its last center. Search by name again for the current place.`;
    case "more_outside_radius": {
      const wider = surface === "cli" ? "--radius-meters" : "radiusMeters";
      return c.withinMaxRadius === null
        ? ours`more hotels match farther from the center: a larger ${wider} finds them.`
        : ours`${plural(c.withinMaxRadius, "hotel")} match within ${LIMITS.radiusMetersMax / 1000} km of the center (${num(c.matched)} in this circle): a larger ${wider} finds more.`;
    }
    case "more_elsewhere":
      return c.textAnywhere === null
        ? ours`more hotels match the text elsewhere in ${p.countryCode}: the words may also name places elsewhere.`
        : ours`${plural(c.textAnywhere, "hotel")} in ${p.countryCode} match the text (${num(c.matched)} here): the words may also name places elsewhere.`;
    case "few_hotels_in_scope":
      return c.matched === 0
        ? ours`no hotel matches here; the Counts line says how many match farther out or elsewhere.`
        : ours`only ${plural(c.matched, "hotel")} here; the Counts line says how many match farther out or elsewhere.`;
    case "party_split_required":
      return ours`the rooms are for different parties, so the search used only the dates. Offers take one party per call: get offers for each party separately.`;
    case "no_results":
      return ours`no hotels to show. Next: ${nextSteps(r)}.`;
    case "locality_available": {
      const total = (note as Note<"locality_available">).details?.localityTotal;
      const also =
        total === undefined
          ? ours`is also a locality`
          : ours`is also a locality, with ${plural(total, "matching hotel")}`;
      if (!d) return ours`this place ${also}: search it as a locality for exactly its hotels instead of this circle.`;
      const as = surface === "cli" ? ours`--locality ${token("id", d.place.placeId)}` : ours`{ kind: "locality", placeId: ${theirs(d.place.placeId)} }`;
      return ours`${p.name} ${also}: search ${as} for exactly its hotels instead of this circle.`;
    }
    default:
      return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A search as it came, the details of a note that do not parse left out, so
 * that they do not cost the search its text: such a note is worded from its
 * code alone, as one sent without details is.
 */
export function readableSearch(value: unknown): unknown {
  if (!isObject(value) || !Array.isArray(value.notes)) return value;
  const notes = value.notes.map((note: unknown) => {
    if (!isObject(note) || !("details" in note) || searchNote.safeParse(note).success) return note;
    const { details: _unread, ...coded } = note;
    return coded;
  });
  return { ...value, notes };
}

export function renderSearch(r: SearchResult, surface: RenderSurface = "mcp"): string {
  const lines: Ours[] = [header(r)];
  lines.push(
    joined(
      [
        r.stay ? ours`Stay ${stayLine(r.stay.checkIn, r.stay.checkOut)}, ${party(r.stay.rooms)}` : ours`No stay`,
        pricingWords(r),
        ours`sort: ${label(SORTS, r.sort, ours`not recognized`)}`,
      ],
      " · ",
    ),
  );
  const center = centerLine(r.destination);
  if (center) lines.push(center);
  lines.push(countsLine(r));

  const pool = r.coverage.poolRadiusMeters;
  if (pool !== null) {
    const d = r.destination;
    const known =
      d !== null && (d.kind === "place" || d.kind === "point")
        ? (d as PlaceDestination | PointDestination)
        : null;
    const name =
      known?.center.place?.name ?? (known?.kind === "place" ? (known as PlaceDestination).place.name : null);
    const around = name === null ? ours`the center` : theirs(name);
    const priced =
      r.coverage.priced === null
        ? ours`Only the nearest matches were priced`
        : ours`Only the nearest ${num(r.coverage.priced)} matches were priced`;
    lines.push(ours`${priced}: "cheapest" here means cheapest within ${km(pool)} of ${around}.`);
  }

  if (r.coverage.localities) {
    const areaName =
      r.destination?.kind === "place" ? (r.destination as PlaceDestination).place.name : null;
    lines.push(ours``, ...localitiesLines(r.coverage.localities, areaName, surface));
  }

  lines.push(ours``);
  if (r.data.length === 0) lines.push(ours`No hotels on this page.`);
  r.data.forEach((h, i) => lines.push(hotelLine(h, i, r)));

  if (r.notes.length > 0) {
    lines.push(
      ours``,
      ours`Notes:`,
      // Ours for a code this build knows; the server's message, quoted
      // after our words, only for one it does not.
      ...r.notes.map((n) => {
        const said = typeof n.message === "string" ? theirs(n.message) : ours`no words for it in this version.`;
        return ours`- Note ${code(n.code, ours`of a kind not recognized`)}: ${noteText(n, r, surface) ?? said}`;
      }),
    );
  }
  lines.push(
    ours``,
    r.nextCursor === null
      ? ours`Last page.`
      : surface === "cli"
        ? ours`Next page: run again with only --cursor ${token("cursor", r.nextCursor)} and, optionally, --limit.`
        : ours`Next page: call again with only the cursor and, optionally, limit: { cursor: ${theirs(r.nextCursor)} }.`,
  );
  if (r.currencyHint?.currency === "CNY") lines.push(ours``, currencyHintLine(r.currencyHint, surface));
  return lines.join("\n");
}
