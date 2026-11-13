import type { Hotel, RoomType } from "../outputs/hotel.ts";
import { money, named, roomFacts } from "./format.ts";
import { FROM_THE_HOTEL, oneLine, quoted } from "./third-party.ts";

/*
 * `get_hotel` (spec §8): the full description and every policy (C8), as
 * quoted blocks: they are the hotel's words, not Fortrip's.
 */

type Times = Hotel["checkInTimes"];
type Policy = Hotel["policies"]["items"][number];

function times(what: string, t: Times): string {
  if (t.from === null && t.until === null) return `${what}: not listed`;
  return `${what} from ${t.from ?? "not listed"}, until ${t.until ?? "not listed"}`;
}

function deposit(d: Hotel["deposit"]): string {
  if (d.required === null) return "Deposit: not stated";
  if (!d.required) return "Deposit: not required";
  return `Deposit: required, ${d.amount ? money(d.amount) : "amount not stated"}`;
}

function roomTypeLine(r: RoomType): string {
  return [`- ${r.name ? oneLine(r.name.text) : "room name not listed"}`, ...roomFacts(r)].join(" · ");
}

/** The website, when it is an `http:` or `https:` URL; anything else is not shown. */
function website(value: string | null): string | null {
  const text = value?.trim();
  if (!text || /[\s\u0085]/.test(text)) return null;
  try {
    const { protocol } = new URL(text);
    return protocol === "http:" || protocol === "https:" ? text : null;
  } catch {
    return null;
  }
}

/** A JSON value on one line: "key: value, key: value", a list's items
 *  joined by "; ", nulls and empty strings left out. */
function flat(value: unknown): string {
  if (value === null) return "";
  if (Array.isArray(value)) return value.map(flat).filter(Boolean).join("; ");
  if (typeof value !== "object") return oneLine(String(value));
  return Object.entries(value)
    .map(([key, v]) => {
      const text = flat(v);
      const nested = typeof v === "object" && v !== null && !Array.isArray(v);
      return text ? `${oneLine(key)}: ${nested ? `(${text})` : text}` : "";
    })
    .filter(Boolean)
    .join(", ");
}

/** The lines of a policy the catalogue holds as a JSON string: one per item
 *  of a list or per field of an object. null when the text is not that. */
function dataLines(text: string): string[] | null {
  if (!/^\s*[[{]/.test(text)) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const lines = Array.isArray(value)
    ? value.map(flat).filter(Boolean).map((item) => `- ${item}`)
    : Object.entries(value as object).map(([key, v]) => flat({ [key]: v })).filter(Boolean);
  return lines.length > 0 ? lines : null;
}

/** A policy's topic, then its text as a quoted block. */
function policyLines(p: Policy): string[] {
  return [`- ${p.topic}:`, ...(dataLines(p.text)?.map((line) => `> ${line}`) ?? quoted(p.text))];
}

/** Photo URLs a hotel's text shows; the object holds them all. */
const PHOTOS_SHOWN = 4;

export function renderHotel(h: Hotel): string {
  const region = h.address.region;
  const lines = [
    [
      named(h.name, h.names),
      h.stars === null ? "stars not listed" : `${h.stars}★`,
      h.hotelId,
      h.bookable ? "" : "no longer bookable (it has left the catalogue)",
    ]
      .filter(Boolean)
      .join(" · "),
    [
      `Address: ${h.address.line ? oneLine(h.address.line.text) : "not listed"}`,
      region ? `${oneLine(region.name)} ${region.placeId}` : "",
      h.address.countryCode ?? "",
      h.location ? `${h.location.lat}, ${h.location.lng}` : "location not listed",
      `time zone ${h.timeZone ?? "not listed"}`,
    ]
      .filter(Boolean)
      .join(" · "),
    `${times("Check-in", h.checkInTimes)} · ${times("Check-out", h.checkOutTimes)} (local time)`,
    `Breakfast served: ${h.breakfastServed === null ? "not stated" : h.breakfastServed ? "yes" : "no"}`,
    deposit(h.deposit),
    `Phone: ${h.contact.phone === null ? "not listed" : oneLine(h.contact.phone)} · Website: ${website(h.contact.website) ?? "not listed"}`,
  ];
  if (h.photos?.length) {
    const shown = h.photos.slice(0, PHOTOS_SHOWN).map((p) => p.url);
    const more = h.photos.length - shown.length;
    lines.push(`Photos: ${shown.join(" · ")}${more > 0 ? ` (+${more} more)` : ""}`);
  }

  if (!h.amenities.listed) {
    lines.push('Amenities: not listed (unknown, not "none")');
  } else if (h.amenities.items.length === 0) {
    lines.push("Amenities: none listed");
  } else {
    const items = h.amenities.items.map((a) => `${oneLine(a.name.text)} (${a.code})`);
    lines.push(`Amenities listed (others may exist): ${items.join(", ")}`);
  }

  if (!h.policies.listed) {
    lines.push("Policies: not listed");
  } else if (h.policies.items.length === 0) {
    lines.push("Policies: none listed");
  } else {
    lines.push(`Policies (${FROM_THE_HOTEL}):`, ...h.policies.items.flatMap(policyLines));
  }

  // Absent unless asked for; null when the catalogue lists none.
  if (h.roomTypes !== undefined) {
    if (h.roomTypes?.length) lines.push("Room types:", ...h.roomTypes.map(roomTypeLine));
    else lines.push("Room types: not listed");
  }

  if (h.description === null) {
    lines.push("Description: not listed");
  } else {
    lines.push(`Description (${h.description.locale}; ${FROM_THE_HOTEL}):`, ...quoted(h.description.text));
  }
  return lines.join("\n");
}
