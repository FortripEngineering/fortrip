import type { Money } from "../conventions/money.ts";
import { countIsoDateDays } from "../dates.ts";

/*
 * Small pieces every renderer shares. Values reach these after `parseOpen`,
 * so an open enum can hold any string: callers map the values they know and
 * show any other value as it came.
 */

export type Names = { en: string | null; zh: string | null };
type Room = { adults: number; childrenAges: number[] };

/** 31205 → "31,205". */
export function num(n: number): string {
  return n.toLocaleString("en-US");
}

/** Meters as kilometres with one decimal: 9012 → "9.0 km". */
export function km(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

export function money(m: Money): string {
  return `${m.currency} ${m.amount}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

/** The name, plus the other language's form when it differs. */
export function named(name: string, names: Names): string {
  const other = [names.en, names.zh].find((n) => n && n !== name);
  return other ? `${name} (${other})` : name;
}

/** A known value's wording, or the raw value. */
export function label(words: Record<string, string>, value: string): string {
  return Object.hasOwn(words, value) ? words[value]! : value;
}

export function stayLine(checkIn: string, checkOut: string): string {
  const nights = countIsoDateDays(checkIn, checkOut);
  return `${checkIn} → ${checkOut} (${plural(nights, "night")})`;
}

function partyOf(room: Room): string {
  const adults = plural(room.adults, "adult");
  const n = room.childrenAges.length;
  if (n === 0) return adults;
  const ages = room.childrenAges.join(", ");
  return `${adults} and ${plural(n, "child", "children")} (${n === 1 ? "age" : "ages"} ${ages})`;
}

/** "1 room: 2 adults", "2 rooms, each 2 adults", or each room in turn. */
export function party(rooms: Room[]): string {
  const parties = rooms.map(partyOf);
  if (parties.length === 1) return `1 room: ${parties[0]}`;
  if (parties.every((p) => p === parties[0])) {
    return `${parties.length} rooms, each ${parties[0]}`;
  }
  return `${parties.length} rooms: ${parties.map((p, i) => `room ${i + 1} ${p}`).join("; ")}`;
}

/**
 * An instant in UTC, and in `timeZone` when one is given:
 * "2026-11-12 16:00 UTC (2026-11-13 00:00 Asia/Shanghai)".
 */
export function when(instant: string, timeZone: string | null): string {
  const utc = `${instant.slice(0, 10)} ${instant.slice(11, 16)} UTC`;
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
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    return `${utc} (${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} ${timeZone})`;
  } catch {
    return utc;
  }
}

/** JSON text of a value that may not be JSON at all. */
export function raw(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "no value";
  } catch {
    return String(value);
  }
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
export function roomFacts(r: RoomFacts): string[] {
  const area = r.areaSqm
    ? r.areaSqm.min === r.areaSqm.max
      ? `${r.areaSqm.min} m²`
      : `${r.areaSqm.min}–${r.areaSqm.max} m²`
    : "size not stated";
  return [
    r.beds ? `beds: ${r.beds.text}` : "beds not listed",
    area,
    r.maxOccupancy === null ? "max occupancy not listed" : `max ${plural(r.maxOccupancy, "guest")}`,
    r.window === null ? "window not listed" : label(WINDOWS, r.window),
  ];
}
