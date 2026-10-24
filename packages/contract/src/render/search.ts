import type { HotelSummary, SearchResult } from "../outputs/search.ts";
import { km, label, money, named, num, party, plural, stayLine } from "./format.ts";

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
  hub: "the locality's hub",
  point: "its location",
};

function radiusWords(meters: number, source: string | null): string {
  return `within ${km(meters)}${source === "default" ? ", the default radius" : ""}`;
}

/** "Phuket (locality) · 2,752 hotels · plc_… · Phuket Province, TH · also named 普吉". */
function placeHeader(d: PlaceDestination, matched: number): string {
  const p = d.place;
  const scope =
    d.scope === "locality"
      ? "locality"
      : d.scope === "area"
        ? d.radiusMeters === null
          ? p.kind
          : `${p.kind}, within ${km(d.radiusMeters)} of its center`
        : d.scope === "radius"
          ? d.radiusMeters === null
            ? `${p.kind}, radius not stated`
            : `${p.kind}, ${radiusWords(d.radiusMeters, d.radiusSource)}`
          : `${p.kind}, scope ${d.scope}`;
  const where = [p.region && `${p.region.name} ${p.region.placeId}`, p.countryCode]
    .filter(Boolean)
    .join(", ");
  const other = [p.names.en, p.names.zh].find((n) => n && n !== p.name);
  return [
    `${p.name} (${scope})`,
    plural(matched, "hotel"),
    p.placeId,
    where,
    other ? `also named ${other}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function header(r: SearchResult): string {
  const d = r.destination;
  const matched = r.coverage.matched;
  let head: string;
  if (d === null) {
    head = `${r.text ? `Text "${r.text.value}"` : "All hotels"} · ${plural(matched, "hotel")}`;
  } else if (d.kind === "place") {
    head = placeHeader(d as PlaceDestination, matched);
  } else if (d.kind === "point") {
    const p = d as PointDestination;
    const { lat, lng } = p.center.location;
    head = `Point ${lat}, ${lng} (${radiusWords(p.radiusMeters, p.radiusSource)}) · ${plural(matched, "hotel")}`;
  } else {
    head = `Destination of kind ${d.kind} · ${plural(matched, "hotel")}`;
  }
  if (d !== null && r.text) head += ` · text "${r.text.value}" (exact words)`;
  return head;
}

function centerLine(d: Destination | null): string | null {
  if (d === null || (d.kind !== "place" && d.kind !== "point")) return null;
  const c = (d as PlaceDestination | PointDestination).center;
  const from = c.place
    ? `${c.place.name} ${c.place.placeId}`
    : `${c.location.lat}, ${c.location.lng}`;
  return `Distances from ${from} (${label(CENTER_BASES, c.basis)}).`;
}

function pricingWords(r: SearchResult): string {
  const { mode, scope, status } = r.pricing;
  if (mode === "none") return "no prices (no stay given)";
  if (mode === "indicative" && status === "unavailable") {
    return "indicative prices unavailable this time";
  }
  if (mode === "indicative") {
    return "indicative prices per room-night: estimates, not bookable (only offers are)";
  }
  return `prices ${[mode, scope, status].filter(Boolean).join(", ")}`;
}

function countsLine(r: SearchResult): string {
  const c = r.coverage;
  const country =
    r.destination?.kind === "place"
      ? (r.destination as PlaceDestination).place.countryCode
      : "the country";
  const parts = [`${num(c.matched)} matched`];
  if (c.priced !== null) parts.push(`${num(c.priced)} priced`);
  if (c.withPrice !== null) parts.push(`${num(c.withPrice)} with a price`);
  else if (r.pricing.mode === "indicative") parts.push("with a price: unknown");
  if (c.excludedNoPrice !== null) {
    parts.push(`${num(c.excludedNoPrice)} left out for having no indicative price`);
  }
  if (c.excludedNoFacilityData !== null) {
    parts.push(`${num(c.excludedNoFacilityData)} left out for listing no facilities`);
  }
  if (c.withinMaxRadius !== null) parts.push(`${num(c.withinMaxRadius)} within 80 km`);
  if (c.textAnywhere !== null) {
    parts.push(`${num(c.textAnywhere)} match the text anywhere in ${country}`);
  }
  if (c.nameAsText !== null) parts.push(`${num(c.nameAsText)} have the name as text`);
  return `Counts: ${parts.join(", ")}.`;
}

/**
 * The localities block (§12), for a search and for `search_too_broad`.
 * `areaName` labels a hub named like the searched area.
 */
export function localitiesLines(loc: Localities, areaName: string | null): string[] {
  const lines = [
    'Localities: pass one back as destination { kind: "locality", placeId }, never the name. The number is its matching hotels; "incl." lists places inside it, with all their hotels regardless of filters ("hotels overall").',
  ];
  for (const item of loc.items) {
    let line = `- ${item.place.name} ${item.place.placeId} ${num(item.count)}`;
    if (item.total !== item.count) line += ` here, ${num(item.total)} as a locality`;
    const sameName =
      areaName !== null &&
      [item.place.name, item.place.names.en, item.place.names.zh].some(
        (n) => n?.toLowerCase() === areaName.toLowerCase(),
      );
    if (sameName) line += ` — the locality, not the whole of ${areaName}`;
    if (item.includes.length > 0) {
      const inc = item.includes.map(
        (i) => `${i.place.name} ${i.place.placeId}, ${num(i.members)} hotels overall`,
      );
      line += ` (incl. ${inc.join("; ")})`;
    }
    lines.push(line);
  }
  if (loc.unassigned > 0) {
    lines.push(`${plural(loc.unassigned, "hotel")} in this search belong to no locality.`);
  }
  if (loc.more > 0) {
    lines.push(`${num(loc.more)} more localities; name one with place_name.`);
  }
  return lines;
}

function priceWords(h: HotelSummary, status: string | null): string {
  const p = h.price;
  if (p === null) {
    return status === "ok" ? "no indicative price" : "price unavailable this time";
  }
  let text = `from ${money(p.fromPerRoomNight)}/room-night (${money(p.fromPerRoomStay)} per room for the stay)`;
  if (p.approx) {
    text += ` ≈ ${money(p.approx.fromPerRoomNight)}/room-night (${money(p.approx.fromPerRoomStay)}), exchange rate of ${p.approx.rateDate}`;
  }
  if (p.kind !== "indicative" || p.basis !== "lowest_unit") {
    text += ` [${p.kind}, ${p.basis}]`;
  }
  return text;
}

function hotelLine(h: HotelSummary, i: number, r: SearchResult): string {
  const where = [h.address.region?.name, h.address.countryCode].filter(Boolean).join(", ");
  return [
    `${i + 1}. ${named(h.name, h.names)}`,
    h.stars === null ? "stars not listed" : `${h.stars}★`,
    r.destination === null
      ? ""
      : h.distanceMeters === null
        ? "distance unknown"
        : km(h.distanceMeters),
    r.pricing.mode === "none" ? "" : priceWords(h, r.pricing.status),
    h.address.line ? h.address.line.text : "address not listed",
    where,
    h.hotelId,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function renderSearch(r: SearchResult): string {
  const lines = [header(r)];
  lines.push(
    [
      r.stay ? `Stay ${stayLine(r.stay.checkIn, r.stay.checkOut)}, ${party(r.stay.rooms)}` : "No stay",
      pricingWords(r),
      `sort: ${label(SORTS, r.sort)}`,
    ].join(" · "),
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
    const priced = r.coverage.priced === null ? "" : ` ${num(r.coverage.priced)}`;
    lines.push(
      `Only the nearest${priced} matches were priced: "cheapest" here means cheapest within ${km(pool)} of ${around}.`,
    );
  }

  if (r.coverage.localities) {
    const areaName =
      r.destination?.kind === "place" ? (r.destination as PlaceDestination).place.name : null;
    lines.push("", ...localitiesLines(r.coverage.localities, areaName));
  }

  lines.push("");
  if (r.data.length === 0) lines.push("No hotels on this page.");
  r.data.forEach((h, i) => lines.push(hotelLine(h, i, r)));

  if (r.notes.length > 0) {
    lines.push("", "Notes:", ...r.notes.map((n) => `- ${n.code}: ${n.message}`));
  }
  lines.push(
    "",
    r.nextCursor === null
      ? "Last page."
      : `Next page: call again with only the cursor and, optionally, limit: { cursor: "${r.nextCursor}" }.`,
  );
  return lines.join("\n");
}
