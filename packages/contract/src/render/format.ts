import type { Money } from "../conventions/money.ts";
import { countIsoDateDays } from "../dates.ts";
import { code, joined, type Ours, ours, own, theirs, token } from "./third-party.ts";

/*
 * Small pieces every renderer shares. Values reach these after `parseOpen`,
 * so an open enum can hold any string: callers map the values they know,
 * and show any other value as it came only when it reads as a code. A name
 * is `theirs`, in quotes; an amount, a date or a time zone is a `token`.
 */

export type Names = { en: string | null; zh: string | null };
type Room = { adults: number; childrenAges: number[] };

/** 31205 → "31,205". */
export function num(n: number): Ours {
  return own(n.toLocaleString("en-US"));
}

/** Meters as kilometres with one decimal: 9012 → "9.0 km". */
export function km(meters: number): Ours {
  return ours`${own((meters / 1000).toFixed(1))} km`;
}

export function money(m: Money): Ours {
  return ours`${token(m.currency)} ${token(m.amount)}`;
}

/** A count of things Fortrip names: `one` and `many` are words of ours. */
export function plural(n: number, one: string, many = `${one}s`): Ours {
  return ours`${num(n)} ${own(n === 1 ? one : many)}`;
}

/** The name in quotes, plus the other language's form when it differs:
 *  "Lakeside Garden Resort" ("湖畔花园度假酒店"). */
export function named(name: string, names: Names): Ours {
  const other = [names.en, names.zh].find((n) => n && n !== name);
  return other ? ours`${theirs(name)} (${theirs(other)})` : theirs(name);
}

/** A known value's wording. A value the package does not know is shown as
 *  it came when it reads as a code, otherwise as `unknown`. */
export function label(
  words: Record<string, string>,
  value: string,
  unknown: Ours = ours`unknown`,
): Ours {
  return Object.hasOwn(words, value) ? own(words[value] as string) : code(value, unknown);
}

export function stayLine(checkIn: string, checkOut: string): Ours {
  const nights = countIsoDateDays(checkIn, checkOut);
  return ours`${token(checkIn)} → ${token(checkOut)} (${plural(nights, "night")})`;
}

function partyOf(room: Room): Ours {
  const adults = plural(room.adults, "adult");
  const n = room.childrenAges.length;
  if (n === 0) return adults;
  const ages = joined(room.childrenAges.map((age) => ours`${age}`), ", ");
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
  // The date and the minute of an RFC 3339 instant; anything else is shown whole.
  const read = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(instant);
  if (!read) return token(instant);
  const utc = ours`${own(read[1]!)} ${own(read[2]!)} UTC`;
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
    // The formatter's own digits.
    const part = (type: string) => own(String(parts.find((p) => p.type === type)?.value));
    return ours`${utc} (${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} ${token(timeZone)})`;
  } catch {
    return utc;
  }
}

/** The characters `JSON.stringify` leaves as they are that a reader or a
 *  terminal could take as a line break or a control, or that a reader does
 *  not see (the set `oneLine` removes). */
const UNESCAPED = /[\u007f-\u009f\u2028\u2029\p{Default_Ignorable_Code_Point}\ufff9-\ufffb]/gu;

/** A character as JSON escapes it, a surrogate pair for one past U+FFFF. */
function escaped(character: string): string {
  return Array.from({ length: character.length }, (_, i) =>
    `\\u${character.charCodeAt(i).toString(16).padStart(4, "0")}`,
  ).join("");
}

/** JSON text of a value that may not be JSON at all, on one line: its
 *  strings are in JSON's quotes, as `theirs` are. */
export function raw(value: unknown): Ours {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    // A value JSON can't write (a cycle, a BigInt): its own words, quoted.
    return theirs(String(value));
  }
  return text === undefined ? ours`no value` : own(text.replace(UNESCAPED, escaped));
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
    r.beds ? ours`beds: ${theirs(r.beds.text)}` : ours`beds not listed`,
    area,
    r.maxOccupancy === null ? ours`max occupancy not listed` : ours`max ${plural(r.maxOccupancy, "guest")}`,
    r.window === null ? notListed : label(WINDOWS, r.window, notListed),
  ];
}
