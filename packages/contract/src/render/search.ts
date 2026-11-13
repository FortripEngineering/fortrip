import { LIMITS } from "../limits.ts";
import type { HotelSummary, SearchResult } from "../outputs/search.ts";
import type { RenderSurface } from "../tools.ts";
import { km, label, money, named, num, party, plural, stayLine } from "./format.ts";
import { code, joined, oneLine, type Ours, ours } from "./third-party.ts";

/* `search_hotels` (spec §12, §7.6, §7.8). */

type Destination = NonNullable<SearchResult["destination"]>;
type PlaceDestination = Extract<Destination, { kind: "place" }>;
type PointDestination = Extract<Destination, { kind: "point" }>;
type Localities = NonNullable<SearchResult["coverage"]["localities"]>;

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

/** "Place: Phuket (locality) · 2,752 hotels · plc_… · Phuket Province, TH · also named 普吉". */
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
      ours`Place: ${p.name} (${scope})`,
      plural(matched, "hotel"),
      oneLine(p.placeId),
      joined([p.region && ours`${p.region.name} ${p.region.placeId}`, oneLine(p.countryCode)], ", "),
      other ? ours`also named ${other}` : "",
    ],
    " · ",
  );
}

function header(r: SearchResult): Ours {
  const d = r.destination;
  const hotels = plural(r.coverage.matched, "hotel");
  if (d === null) return r.text ? ours`Text "${r.text}" · ${hotels}` : ours`All hotels · ${hotels}`;
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
  return r.text ? ours`${head} · text "${r.text}" (exact words)` : head;
}

function centerLine(d: Destination | null): Ours | null {
  if (d === null || (d.kind !== "place" && d.kind !== "point")) return null;
  const c = (d as PlaceDestination | PointDestination).center;
  const from = c.place ? ours`${c.place.name} ${c.place.placeId}` : ours`${c.location.lat}, ${c.location.lng}`;
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
      ? (r.destination as PlaceDestination).place.countryCode
      : "the country";
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
    let line = ours`- Locality: ${item.place.name} ${item.place.placeId} ${num(item.count)}`;
    if (item.total !== item.count) line = ours`${line} here, ${num(item.total)} as a locality`;
    const sameName =
      areaName !== null &&
      [item.place.name, item.place.names.en, item.place.names.zh].some(
        (n) => n?.toLowerCase() === areaName.toLowerCase(),
      );
    if (sameName) line = ours`${line} — the locality, not the whole of ${areaName}`;
    if (item.includes.length > 0) {
      const inc = item.includes.map(
        (i) => ours`${i.place.name} ${i.place.placeId}, ${num(i.members)} hotels overall`,
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
      h.address.line ? oneLine(h.address.line.text) : ours`address not listed`,
      joined([region && oneLine(region.name), h.address.countryCode && oneLine(h.address.countryCode)], ", "),
      h.photo ? ours`photo ${h.photo.url}` : "",
      oneLine(h.hotelId),
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
    const around =
      known?.center.place?.name ??
      (known?.kind === "place" ? (known as PlaceDestination).place.name : "the center");
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
      ...r.notes.map((n) => ours`- Note ${code(n.code, ours`of a kind not recognized`)}: ${n.message}`),
    );
  }
  lines.push(
    ours``,
    r.nextCursor === null
      ? ours`Last page.`
      : surface === "cli"
        ? ours`Next page: run again with only --cursor ${r.nextCursor} and, optionally, --limit.`
        : ours`Next page: call again with only the cursor and, optionally, limit: { cursor: "${r.nextCursor}" }.`,
  );
  if (r.currencyHint?.currency === "CNY") lines.push(ours``, currencyHintLine(r.currencyHint, surface));
  return lines.join("\n");
}
