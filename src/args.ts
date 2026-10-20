import { readFileSync } from "node:fs";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";

import { usageError } from "./errors.ts";

type Body = Record<string, unknown>;
type Values = Record<string, string | boolean | string[] | undefined>;

const BODY_OPTION = { body: { type: "string" } } as const;
const CURRENCY_OPTION = { currency: { type: "string" } } as const;

/** Wraps `util.parseArgs` so unknown flags and missing values exit 2. */
export function parse<const O extends ParseArgsOptionsConfig>(
  argv: string[],
  options: O,
) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw usageError((error as Error).message);
  }
}

/** `--body '<json>'` or `--body @file.json`: the raw request body, which
 *  individual flags then override. */
function baseBody(values: Values): Body {
  const raw = values.body;
  if (typeof raw !== "string") return {};
  let text = raw;
  if (raw.startsWith("@")) {
    try {
      text = readFileSync(raw.slice(1), "utf8");
    } catch (error) {
      throw usageError(`Cannot read --body file: ${(error as Error).message}`);
    }
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Body;
    }
  } catch {}
  throw usageError("--body must be a JSON object");
}

function num(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) {
    throw usageError(`--${flag} must be a number, got "${value}"`);
  }
  return parsed;
}

function nums(flag: string, values: string[] | undefined): number[] | undefined {
  if (!values?.length) return undefined;
  return values
    .flatMap((value) => value.split(","))
    .map((value) => num(flag, value.trim()) as number);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function list(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length ? value : undefined;
}

/** `--currency` beats a `--body` currency, which beats `FORTRIP_CURRENCY`;
 *  with none of them the API answers in CNY. */
function currency(values: Values, base: Body, env: NodeJS.ProcessEnv) {
  const flag = str(values.currency)?.trim().toUpperCase();
  if (flag) return flag;
  if (base.currency !== undefined) return undefined;
  return env.FORTRIP_CURRENCY?.trim().toUpperCase() || undefined;
}

/** Drops undefined so flags left out don't erase `--body` fields. */
function merge(base: Body, overrides: Body): Body {
  const body = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) body[key] = value;
  }
  return body;
}

export const SEARCH_OPTIONS = {
  ...BODY_OPTION,
  ...CURRENCY_OPTION,
  query: { type: "string", short: "q" },
  "city-code": { type: "string" },
  near: { type: "string" },
  "check-in": { type: "string" },
  "check-out": { type: "string" },
  "star-min": { type: "string" },
  "star-max": { type: "string" },
  facility: { type: "string", multiple: true },
  "price-min": { type: "string" },
  "price-max": { type: "string" },
  sort: { type: "string" },
  page: { type: "string" },
  "page-size": { type: "string" },
} as const;

export function searchBody(
  values: Values,
  env: NodeJS.ProcessEnv = process.env,
): Body {
  const base = baseBody(values);
  let near: Body | undefined;
  const nearRaw = str(values.near);
  if (nearRaw !== undefined) {
    const [lat, lng, radiusKm] = nearRaw.split(",").map((part) => part.trim());
    if (!lat || !lng || !radiusKm) {
      throw usageError("--near must be lat,lng,radiusKm (e.g. 13.75,100.5,5)");
    }
    near = {
      lat: num("near", lat),
      lng: num("near", lng),
      radiusKm: num("near", radiusKm),
    };
  }
  return merge(base, {
    query: str(values.query),
    cityCode: num("city-code", str(values["city-code"])),
    near,
    checkIn: str(values["check-in"]),
    checkOut: str(values["check-out"]),
    starMin: num("star-min", str(values["star-min"])),
    starMax: num("star-max", str(values["star-max"])),
    facilities: list(values.facility),
    priceMin: num("price-min", str(values["price-min"])),
    priceMax: num("price-max", str(values["price-max"])),
    sortBy: str(values.sort),
    page: num("page", str(values.page)),
    pageSize: num("page-size", str(values["page-size"])),
    currency: currency(values, base, env),
  });
}

export const HOTEL_OPTIONS = {
  "with-rooms": { type: "boolean" },
} as const;

export function hotelPath(positionals: string[], values: Values): string {
  const [id, ...extra] = positionals;
  if (!id || extra.length || !/^\d+$/.test(id)) {
    throw usageError("Usage: fortrip hotel <hotelId> [--with-rooms]");
  }
  return `/api/huizhi/hotels/${id}${values["with-rooms"] ? "?include=rooms" : ""}`;
}

const STAY_OPTIONS = {
  "check-in": { type: "string" },
  "check-out": { type: "string" },
  rooms: { type: "string" },
  adults: { type: "string" },
  "child-age": { type: "string", multiple: true },
} as const;

function stayFields(values: Values, base: Body): Body {
  return {
    checkIn: str(values["check-in"]),
    checkOut: str(values["check-out"]),
    rooms: num("rooms", str(values.rooms)) ?? (base.rooms === undefined ? 1 : undefined),
    adults: num("adults", str(values.adults)) ?? (base.adults === undefined ? 2 : undefined),
    childrenAges: nums("child-age", list(values["child-age"])),
  };
}

export const RATES_OPTIONS = {
  ...BODY_OPTION,
  ...CURRENCY_OPTION,
  ...STAY_OPTIONS,
  hotel: { type: "string", multiple: true },
  nationality: { type: "string" },
  board: { type: "string", multiple: true },
  "free-cancellation": { type: "boolean" },
  "include-unbookable": { type: "boolean" },
  "max-rooms": { type: "string" },
} as const;

export function ratesBody(
  values: Values,
  env: NodeJS.ProcessEnv = process.env,
): Body {
  const base = baseBody(values);
  return merge(base, {
    hotelIds: nums("hotel", list(values.hotel)),
    ...stayFields(values, base),
    nationality: str(values.nationality)?.toUpperCase(),
    boardCodes: list(values.board)?.flatMap((code) =>
      code.split(",").map((part) => part.trim().toUpperCase()),
    ),
    freeCancellation: values["free-cancellation"] ? true : undefined,
    bookableOnly: values["include-unbookable"] ? false : undefined,
    maxRoomsPerHotel: num("max-rooms", str(values["max-rooms"])),
    currency: currency(values, base, env),
  });
}

export const BOOK_OPTIONS = {
  ...BODY_OPTION,
  ...STAY_OPTIONS,
  hotel: { type: "string" },
  "room-id": { type: "string" },
  "rate-plan": { type: "string" },
  guest: { type: "string", multiple: true },
  "contact-name": { type: "string" },
  "contact-phone": { type: "string" },
  "contact-email": { type: "string" },
  "special-requests": { type: "string" },
} as const;

/** `--guest "John Smith"` (room 1) or `--guest "Mary Ann Lee:2"`: the last
 *  word is the last name, the rest the first name. */
export function parseGuest(value: string): Body {
  const match = value.trim().match(/^(.+?)(?::(\d+))?$/);
  const words = match?.[1]?.trim().split(/\s+/) ?? [];
  if (words.length < 2) {
    throw usageError(
      `--guest must be "First Last" or "First Last:roomNo", got "${value}"`,
    );
  }
  return {
    firstName: words.slice(0, -1).join(" "),
    lastName: words.at(-1),
    roomNo: match?.[2] ? Number(match[2]) : 1,
  };
}

export function bookBody(values: Values): Body {
  const base = baseBody(values);
  return merge(base, {
    hotelId: num("hotel", str(values.hotel)),
    roomId: str(values["room-id"]),
    ratePlanCode: str(values["rate-plan"]),
    ...stayFields(values, base),
    guests: list(values.guest)?.map(parseGuest),
    contactName: str(values["contact-name"]),
    contactPhone: str(values["contact-phone"]),
    contactEmail: str(values["contact-email"]),
    specialRequests: str(values["special-requests"]),
  });
}
