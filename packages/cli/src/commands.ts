import { readFileSync } from "node:fs";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";

import {
  API,
  commandInvocation,
  type CommandSpec,
  type FlagSpec,
  type ToolName,
} from "@fortrip/agent-contract";

import { usageError } from "./errors.ts";
import { usageLine } from "./help.ts";

type Body = Record<string, unknown>;
type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

/** What the spec can't say about how a flag is read. */

/** Fields given as a comma-separated list, and also by repeating the flag. */
const COMMA_LISTS = new Set(["hotelIds", "childrenAges", "boardCodes"]);

/** Fields the API takes in upper case, which a user may type in lower. */
const UPPER_CASE = new Set(["nationality", "boardCodes", "currency"]);

/** Boolean fields that default to true: their flag turns them off. */
const TURNS_OFF = new Set(["bookableOnly"]);

/** Where the commands that send a request post, by the tool each mirrors
 *  (a tool name is unique; a command name only within its group).
 *  `hotels get` is a GET of `API.hotel`. */
const POSTS: Partial<Record<ToolName, string>> = {
  search_hotels: API.search,
  get_hotel_rates: API.rates,
  book_hotel: API.bookings,
};

/**
 * Parses `argv` with the options a command's spec declares. Unknown flags,
 * missing values, a single-value flag given twice (which value would win?)
 * and arguments the command doesn't take all exit 2.
 */
export function parseOptions(spec: CommandSpec, argv: string[]) {
  const options: ParseArgsOptionsConfig = {};
  for (const option of [...spec.flags, ...(spec.options ?? [])]) {
    options[option.flag] = {
      type: option.type === "boolean" ? "boolean" : "string",
      ...(option.short ? { short: option.short } : {}),
      ...("multiple" in option && option.multiple ? { multiple: true } : {}),
    };
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options,
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
  } catch (error) {
    throw usageError((error as Error).message);
  }
  const seen = new Set<string>();
  for (const token of parsed.tokens) {
    if (token.kind !== "option" || options[token.name]?.multiple) continue;
    if (seen.has(token.name)) {
      throw usageError(`--${token.name} was given more than once`);
    }
    seen.add(token.name);
  }
  if (!spec.positionals && parsed.positionals.length) {
    throw usageError(
      `${commandInvocation(spec)} takes no arguments, got "${parsed.positionals[0]}"`,
    );
  }
  return { values: parsed.values as Values, positionals: parsed.positionals };
}

/**
 * The request a command sends: the endpoint, and the JSON body of a POST.
 * Each flag sets the input field its spec names; `--body` is the raw body
 * that flags then override.
 */
export function parseCommand(
  spec: CommandSpec,
  argv: string[],
  env: NodeJS.ProcessEnv,
): { body?: Body; path: string } {
  const post = spec.tool ? POSTS[spec.tool] : undefined;
  if (!post && spec.tool !== "get_hotel") {
    throw new Error(`${commandInvocation(spec)} sends no request`);
  }
  const { values, positionals } = parseOptions(spec, argv);
  const input = baseBody(values.body);
  for (const flag of spec.flags) {
    const raw = values[flag.flag];
    if (raw !== undefined) setField(input, flag.field, readFlag(flag, raw));
  }

  if (spec.tool === "get_hotel") {
    const [hotelId, ...extra] = positionals;
    const parsed = Number(hotelId);
    if (!hotelId || extra.length || !/^\d+$/.test(hotelId) || !Number.isSafeInteger(parsed)) {
      throw usageError(`Usage: ${usageLine(spec)}`);
    }
    return { path: API.hotel(parsed, input.includeRooms === true) };
  }

  // The API answers in CNY when nothing sets a currency.
  if (spec.flags.some((flag) => flag.field === "currency") && input.currency === undefined) {
    const fallback = env.FORTRIP_CURRENCY?.trim().toUpperCase();
    if (fallback) input.currency = fallback;
  }
  // No defaults: a guessed room count would price, or book, the wrong stay.
  const occupancy = spec.flags.filter(
    (flag) => flag.field === "rooms" || flag.field === "adults",
  );
  const missing = occupancy.filter((flag) => input[flag.field] === undefined);
  if (occupancy.length === 2 && missing.length) {
    throw usageError(
      `${commandInvocation(spec)} needs ${missing.map((flag) => `--${flag.flag}`).join(" and ")}, per room and the same for every room (2 rooms for 4 adults is --rooms 2 --adults 2)`,
    );
  }
  return { body: input, path: post as string };
}

/** `--body '<json>'` or `--body @file.json`: the raw request body. */
function baseBody(raw: Values[string]): Body {
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

/** Sets a field; dots step into an object, and replace a value that isn't one. */
function setField(body: Body, field: string, value: unknown): void {
  const path = field.split(".");
  const last = path.pop() as string;
  let node = body;
  for (const part of path) {
    const next = node[part];
    node[part] =
      next && typeof next === "object" && !Array.isArray(next) ? next : {};
    node = node[part] as Body;
  }
  node[last] = value;
}

/** What a flag's value means for its field. */
function readFlag(flag: FlagSpec, raw: NonNullable<Values[string]>): unknown {
  if (flag.type === "boolean") return !TURNS_OFF.has(flag.field);
  const given = (Array.isArray(raw) ? raw : [raw]) as string[];
  if (flag.field === "near") return parseNear(given[0] as string);
  if (flag.field === "guests") return given.map(parseGuest);
  const parts = COMMA_LISTS.has(flag.field)
    ? given.flatMap((value) => value.split(",")).map((part) => part.trim())
    : given;
  const values = parts.map((part) => {
    const text = UPPER_CASE.has(flag.field) ? part.trim().toUpperCase() : part;
    if (flag.field === "currency" && text === "") {
      throw usageError(`--${flag.flag} must not be empty`);
    }
    if (flag.type === "number") return num(flag.flag, text);
    return flag.type === "id" ? id(flag.flag, text) : text;
  });
  return flag.multiple ? values : values[0];
}

function num(flag: string, value: string): number {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) {
    throw usageError(`--${flag} must be a number, got "${value}"`);
  }
  return parsed;
}

/** Ids are digits only: `Number` would also read "0x10" as 16 or "1e3" as
 *  1000. */
function id(flag: string, value: string): number {
  const parsed = Number(value.trim());
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(parsed)) {
    throw usageError(`--${flag} must be a numeric id, got "${value}"`);
  }
  return parsed;
}

/** `--near lat,lng,radiusKm`. */
function parseNear(value: string): Body {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw usageError("--near must be lat,lng,radiusKm (e.g. 13.75,100.5,5)");
  }
  const [lat, lng, radiusKm] = parts.map((part) => num("near", part));
  return { lat, lng, radiusKm };
}

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
