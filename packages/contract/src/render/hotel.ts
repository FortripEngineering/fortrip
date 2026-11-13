import type { Hotel, RoomType } from "../outputs/hotel.ts";
import { label, money, named, roomFacts } from "./format.ts";
import { code, FROM_THE_HOTEL, joined, oneLine, type Ours, ours, quoted } from "./third-party.ts";

/*
 * `get_hotel` (spec §8): the full description and every policy (C8), as
 * quoted blocks: they are the hotel's words, not Fortrip's.
 */

type Times = Hotel["checkInTimes"];
type Policy = Hotel["policies"]["items"][number];

function times(what: "Check-in" | "Check-out", range: Times): Ours {
  if (range.from === null && range.until === null) return ours`${what}: not listed`;
  return ours`${what} from ${range.from ?? "not listed"}, until ${range.until ?? "not listed"}`;
}

function deposit(d: Hotel["deposit"]): Ours {
  if (d.required === null) return ours`Deposit: not stated`;
  if (!d.required) return ours`Deposit: not required`;
  return ours`Deposit: required, ${d.amount ? money(d.amount) : "amount not stated"}`;
}

function roomTypeLine(r: RoomType): Ours {
  return joined([ours`- Room type: ${r.name ? r.name.text : "name not listed"}`, ...roomFacts(r)], " · ");
}

/** The longest website shown. */
const WEBSITE_MAX = 2048;

/**
 * The website as its parsed, normalised URL. It is shown only when it is an
 * `http:` or `https:` URL (which always has a host) with no username or
 * password, no whitespace, control or bidirectional character, and at most
 * 2,048 characters; anything else is not shown.
 */
function website(value: string | null): Ours | null {
  const text = value?.trim();
  if (!text || text.includes(" ") || oneLine(text) !== text) return null;
  try {
    const url = new URL(text);
    const web = url.protocol === "http:" || url.protocol === "https:";
    const plain = !url.username && !url.password;
    return web && plain && url.href.length <= WEBSITE_MAX ? oneLine(url.href) : null;
  } catch {
    return null;
  }
}

/** A list or an object, which a list sets apart in brackets. */
const isNested = (value: unknown) => typeof value === "object" && value !== null;

/** A JSON value on one line: "key: value, key: value", a list's items
 *  joined by "; ", nulls and empty strings left out. An object or a list
 *  inside a list, and an object inside an object, is in brackets, so two of
 *  them cannot run together. */
function flat(value: unknown): Ours {
  if (value === null) return ours``;
  if (Array.isArray(value)) {
    return joined(
      value.map((item) => {
        const text = flat(item);
        return text && isNested(item) ? ours`(${text})` : text;
      }),
      "; ",
    );
  }
  if (typeof value !== "object") return oneLine(String(value));
  return joined(
    Object.entries(value).map(([key, v]) => {
      const text = flat(v);
      return text && ours`${key}: ${isNested(v) && !Array.isArray(v) ? ours`(${text})` : text}`;
    }),
    ", ",
  );
}

/** The lines of a policy the catalogue holds as a JSON string: one per item
 *  of a list or per field of an object. null when the text is not that, or
 *  nests too deep to be read. */
function dataLines(text: string): Ours[] | null {
  if (!/^\s*[[{]/.test(text)) return null;
  try {
    const value: unknown = JSON.parse(text);
    const lines = Array.isArray(value)
      ? value.map(flat).filter(Boolean).map((item) => ours`- ${item}`)
      : Object.entries(value as object).map(([key, v]) => flat({ [key]: v })).filter(Boolean);
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}

/** A policy topic in words. */
const TOPICS: Record<string, string> = {
  check_in: "Check-in",
  important_notices: "Important notices",
  booking: "Booking",
  booking_tips: "Booking tips",
  check_in_out: "Check-in and check-out",
  check_in_tips: "Check-in tips",
  reception: "Reception",
  deposit: "Deposit",
  meal: "Meals",
  extra_bed: "Extra beds",
  pets: "Pets",
  surroundings: "Surroundings",
  meetings: "Meetings",
  non_smoking: "Non-smoking",
  other: "Other",
};

/** A policy's topic, then its text as a quoted block. */
function policyLines(p: Policy): Ours[] {
  const topic = Object.hasOwn(TOPICS, p.topic)
    ? label(TOPICS, p.topic)
    : ours`Topic ${code(p.topic, ours`not recognized`)}`;
  return [ours`- ${topic}:`, ...(dataLines(p.text)?.flatMap(quoted) ?? quoted(p.text))];
}

/** Photo URLs a hotel's text shows; the object holds them all. */
const PHOTOS_SHOWN = 4;

export function renderHotel(h: Hotel): string {
  const region = h.address.region;
  const lines: Ours[] = [
    joined(
      [
        ours`Hotel: ${named(h.name, h.names)}`,
        h.stars === null ? ours`stars not listed` : ours`${h.stars}★`,
        oneLine(h.hotelId),
        !h.bookable && ours`no longer bookable (it has left the catalogue)`,
      ],
      " · ",
    ),
    joined(
      [
        ours`Address: ${h.address.line ? h.address.line.text : "not listed"}`,
        region && ours`${region.name} ${region.placeId}`,
        h.address.countryCode && oneLine(h.address.countryCode),
        h.location ? ours`${h.location.lat}, ${h.location.lng}` : ours`location not listed`,
        ours`time zone ${h.timeZone ?? "not listed"}`,
      ],
      " · ",
    ),
    ours`${times("Check-in", h.checkInTimes)} · ${times("Check-out", h.checkOutTimes)} (local time)`,
    ours`Breakfast served: ${h.breakfastServed === null ? "not stated" : h.breakfastServed ? "yes" : "no"}`,
    deposit(h.deposit),
    ours`Phone: ${h.contact.phone ?? "not listed"} · Website: ${website(h.contact.website) ?? "not listed"}`,
  ];
  if (h.photos?.length) {
    const shown = joined(h.photos.slice(0, PHOTOS_SHOWN).map((p) => oneLine(p.url)), " · ");
    const more = h.photos.length - PHOTOS_SHOWN;
    lines.push(more > 0 ? ours`Photos: ${shown} (+${more} more)` : ours`Photos: ${shown}`);
  }

  if (!h.amenities.listed) {
    lines.push(ours`Amenities: not listed (unknown, not "none")`);
  } else if (h.amenities.items.length === 0) {
    lines.push(ours`Amenities: none listed`);
  } else {
    const items = h.amenities.items.map(
      (a) => ours`${a.name.text} (${code(a.code, ours`code not recognized`)})`,
    );
    lines.push(ours`Amenities listed (others may exist): ${joined(items, ", ")}`);
  }

  if (!h.policies.listed) {
    lines.push(ours`Policies: not listed`);
  } else if (h.policies.items.length === 0) {
    lines.push(ours`Policies: none listed`);
  } else {
    lines.push(ours`Policies (${FROM_THE_HOTEL}):`, ...h.policies.items.flatMap(policyLines));
  }

  // Absent unless asked for; null when the catalogue lists none.
  if (h.roomTypes !== undefined) {
    if (h.roomTypes?.length) lines.push(ours`Room types:`, ...h.roomTypes.map(roomTypeLine));
    else lines.push(ours`Room types: not listed`);
  }

  if (h.description === null) {
    lines.push(ours`Description: not listed`);
  } else {
    lines.push(ours`Description (${h.description.locale}; ${FROM_THE_HOTEL}):`, ...quoted(h.description.text));
  }
  return lines.join("\n");
}
