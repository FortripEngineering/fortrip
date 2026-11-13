import type { Money } from "../conventions/money.ts";
import { countIsoDateDays } from "../dates.ts";
import { code, joined, oneLine, type Ours, ours } from "./third-party.ts";

/*
 * Small pieces every renderer shares. Values reach these after `parseOpen`,
 * so an open enum can hold any string: callers map the values they know,
 * and show any other value as it came only when it reads as a code.
 */

export type Names = { en: string | null; zh: string | null };
type Room = { adults: number; childrenAges: number[] };

/** 31205 → "31,205". */
export function num(n: number): Ours {
  return ours`${n.toLocaleString("en-US")}`;
}

/** Meters as kilometres with one decimal: 9012 → "9.0 km". */
export function km(meters: number): Ours {
  return ours`${(meters / 1000).toFixed(1)} km`;
}

export function money(m: Money): Ours {
  return ours`${m.currency} ${m.amount}`;
}

export function plural(n: number, one: string, many = `${one}s`): Ours {
  return ours`${num(n)} ${n === 1 ? one : many}`;
}

/** The name, plus the other language's form when it differs. */
export function named(name: string, names: Names): Ours {
  const other = [names.en, names.zh].find((n) => n && n !== name);
  return other ? ours`${name} (${other})` : oneLine(name);
}

/** A known value's wording. A value the package does not know is shown as
 *  it came when it reads as a code, otherwise as `unknown`. */
export function label(
  words: Record<string, string>,
  value: string,
  unknown: Ours = ours`unknown`,
): Ours {
  return Object.hasOwn(words, value) ? (words[value] as Ours) : code(value, unknown);
}

export function stayLine(checkIn: string, checkOut: string): Ours {
  const nights = countIsoDateDays(checkIn, checkOut);
  return ours`${checkIn} → ${checkOut} (${plural(nights, "night")})`;
}

function partyOf(room: Room): Ours {
  const adults = plural(room.adults, "adult");
  const n = room.childrenAges.length;
  if (n === 0) return adults;
  const ages = room.childrenAges.join(", ");
  return ours`${adults} and ${plural(n, "child", "children")} (${n === 1 ? "age" : "ages"} ${ages})`;
}

/** "1 room: 2 adults", "2 rooms, each 2 adults", or each room in turn. */
export function party(rooms: Room[]): Ours {
  const parties = rooms.map(partyOf);
  if (parties.length === 1) return ours`1 room: ${parties[0]!}`;
  if (parties.every((p) => p === parties[0])) {
    return ours`${parties.length} rooms, each ${parties[0]!}`;
  }
  return ours`${parties.length} rooms: ${joined(parties.map((p, i) => ours`room ${i + 1} ${p}`), "; ")}`;
}

/**
 * An instant in UTC, and in `timeZone` when one is given:
 * "2026-11-12 16:00 UTC (2026-11-13 00:00 Asia/Shanghai)".
 */
export function when(instant: string, timeZone: string | null): Ours {
  const utc = ours`${instant.slice(0, 10)} ${instant.slice(11, 16)} UTC`;
  if (!timeZone) return utc;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const part = (type: string) => String(parts.find((p) => p.type === type)?.value);
    return ours`${utc} (${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} ${timeZone})`;
  } catch {
    return utc;
  }
}

/** The characters `JSON.stringify` leaves as they are that a reader or a
 *  terminal could take as a line break or a control. */
const UNESCAPED = /[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** JSON text of a value that may not be JSON at all, on one line. */
export function raw(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? "no value";
  } catch {
    text = oneLine(String(value));
  }
  return text.replace(UNESCAPED, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const WINDOWS: Record<string, string> = {
  yes: "window",
  no: "no window",
  partial: "window in some rooms",
};

type RoomFacts = {
  beds: { text: string } | null;
  areaSqm: { min: number; max: number } | null;
  maxOccupancy: number | null;
  window: string | null;
};

/** A room type's facts, each written out when not listed. */
export function roomFacts(r: RoomFacts): Ours[] {
  const area = r.areaSqm
    ? r.areaSqm.min === r.areaSqm.max
      ? ours`${r.areaSqm.min} m²`
      : ours`${r.areaSqm.min}–${r.areaSqm.max} m²`
    : ours`size not stated`;
  const notListed = ours`window not listed`;
  return [
    r.beds ? ours`beds: ${r.beds.text}` : ours`beds not listed`,
    area,
    r.maxOccupancy === null ? ours`max occupancy not listed` : ours`max ${plural(r.maxOccupancy, "guest")}`,
    r.window === null ? notListed : label(WINDOWS, r.window, notListed),
  ];
}
