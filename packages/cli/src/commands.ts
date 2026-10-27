import { readFileSync } from "node:fs";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";

import {
  API,
  commandInvocation,
  type CommandSpec,
  type FlagSpec,
  LIMITS,
  type ToolName,
  TOOLS,
} from "@fortrip/agent-contract";

import { CliError, EXIT, usageError } from "./errors.ts";
import { usageLine } from "./help.ts";

type Body = Record<string, unknown>;
type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

/** The request a command sends. */
export interface ApiRequest {
  method: "GET" | "POST";
  path: string;
  body?: Body;
}

/** Fields the API takes in upper case, which a user may type in lower. */
const UPPER_CASE = new Set(["displayCurrency", "destination.countryCode"]);

/** Fields an environment variable sets when neither a flag nor `--body` does. */
const FROM_ENV: Record<string, string> = { displayCurrency: "FORTRIP_DISPLAY_CURRENCY" };

/** Lists a dot steps into the one item of: a v1 order holds one item. */
const ONE_ITEM_LISTS = new Set(["items"]);

/** `--guest room:first:last` sets this field of its room, one of these. */
const GUEST_FIELD = "items.hotel.rooms.guests";
const ROOMS_FIELD = "items.hotel.rooms";

const locale = (input: Body) => input.locale as "en" | "zh" | undefined;

/** Where each command sends its request, by the tool it mirrors, from its
 *  input once the contract has accepted it. A POST sends the input as its
 *  body, but for the fields in its path; a GET carries it in its path and
 *  query. */
const ROUTES: Partial<Record<ToolName, { method: "GET" | "POST"; path: (input: Body) => string }>> = {
  search_hotels: { method: "POST", path: () => API.hotelSearch },
  get_hotel: {
    method: "GET",
    path: (input) =>
      API.hotel(input.hotelId as string, { rooms: input.include === "rooms", locale: locale(input) }),
  },
  get_hotel_offers: { method: "POST", path: () => API.hotelOffers },
  book_hotel: { method: "POST", path: () => API.orders },
  get_order: {
    method: "GET",
    path: (input) => API.order(input.orderId as string, { locale: locale(input) }),
  },
  list_orders: {
    method: "GET",
    path: (input) => {
      const query = new URLSearchParams();
      for (const name of ["cursor", "limit", "locale"]) {
        if (input[name] !== undefined) query.set(name, String(input[name]));
      }
      const text = query.toString();
      return text ? `${API.orders}?${text}` : API.orders;
    },
  },
  cancel_order: { method: "POST", path: (input) => API.orderCancel(input.orderId as string) },
};

/** Fields of an input that are in its path; a GET's others are its query. */
const PATH_FIELDS = new Set(["hotelId", "orderId"]);

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
      ...("short" in option && option.short ? { short: option.short } : {}),
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
 * The request a command sends. Its input is built from `--body` (the raw
 * body, for the commands that take one), then the positionals and flags,
 * each setting the field its spec names, then the environment's defaults.
 * The contract's input schema must accept it: otherwise nothing is sent and
 * the command exits 2, listing the issues as the API would.
 */
export function parseCommand(
  spec: CommandSpec,
  argv: string[],
  env: NodeJS.ProcessEnv,
): ApiRequest {
  const route = spec.tool ? ROUTES[spec.tool] : undefined;
  if (!route) throw new Error(`${commandInvocation(spec)} sends no request`);
  const { values, positionals } = parseOptions(spec, argv);
  const input = baseBody(values.body);

  const wanted = spec.positionals ?? [];
  if (positionals.length !== wanted.length) throw usageError(`Usage: ${usageLine(spec)}`);
  wanted.forEach((positional, index) => {
    if (positional.field) input[positional.field] = positionals[index];
  });

  setFlags(spec, values, input);

  /** Fields the environment set, and the variable that did. */
  const fromEnv = new Map<string, string>();
  for (const [field, name] of Object.entries(FROM_ENV)) {
    const fallback = env[name]?.trim().toUpperCase();
    if (fallback && input[field] === undefined && spec.flags.some((flag) => flag.field === field)) {
      input[field] = fallback;
      fromEnv.set(`/${field}`, name);
    }
  }

  check(spec, input, route.method === "GET", fromEnv);
  const path = route.path(input);
  if (route.method === "GET") return { method: "GET", path };
  const body = Object.fromEntries(Object.entries(input).filter(([field]) => !PATH_FIELDS.has(field)));
  return { method: "POST", path, body };
}

/** Refuses an input the contract's schema doesn't accept, with the issues
 *  the API's `invalid_request` would list (pointers into the body, or
 *  `/path/<name>`, and `/query/<name>` for a GET). An issue with a value an
 *  environment variable set (`fromEnv`, by pointer) names the variable. */
function check(spec: CommandSpec, input: Body, isGet: boolean, fromEnv: Map<string, string>): void {
  const schema = TOOLS.find((tool) => tool.name === spec.tool)?.input;
  const result = schema?.safeParse(input);
  if (!result || result.success) return;
  const pointer = (path: readonly PropertyKey[]) => {
    const keys = path.map((key) => String(key).replaceAll("~", "~0").replaceAll("/", "~1"));
    const where =
      keys[0] === undefined ? [] : PATH_FIELDS.has(keys[0]) ? ["path"] : isGet ? ["query"] : [];
    return [...where, ...keys].map((key) => `/${key}`).join("");
  };
  const issues = result.error.issues.flatMap((issue) =>
    issue.code === "unrecognized_keys"
      ? issue.keys.map((key) => ({
          pointer: pointer([...issue.path, key]),
          message: `Unknown field: ${key}`,
        }))
      : [{ pointer: pointer(issue.path), message: issue.message }],
  ).map(({ pointer, message }) => {
    // A value no flag gave: say where it came from.
    const name = fromEnv.get(pointer);
    return { pointer, message: name ? `${name}: ${message}` : message };
  });
  throw new CliError(
    `Not sent: ${commandInvocation(spec)} was given an invalid request.`,
    EXIT.usage,
    { details: { issues } },
  );
}

/**
 * Sets each given flag's field. A flag with `sets` also picks a union
 * variant (`--place` sends `destination.kind: "place"`): flags that pick
 * different variants of one union can't be given together, and a variant
 * from `--body` other than the one picked is replaced, not merged into.
 */
function setFlags(spec: CommandSpec, values: Values, input: Body): void {
  const given = spec.flags.filter((flag) => values[flag.flag] !== undefined);
  const picked = new Map<string, { value: string; flag: string }>();
  for (const flag of given) {
    for (const [field, value] of Object.entries(flag.sets ?? {})) {
      const earlier = picked.get(field);
      if (earlier && earlier.value !== value) {
        throw usageError(
          `--${earlier.flag} and --${flag.flag} can't be given together: they set ${field} to "${earlier.value}" and "${value}"`,
        );
      }
      if (!earlier) picked.set(field, { value, flag: flag.flag });
    }
  }
  for (const [field, { value }] of picked) {
    const parent = field.split(".").slice(0, -1).join(".");
    const key = field.split(".").at(-1) as string;
    const existing = parent ? getField(input, parent) : input;
    if (isObject(existing) && existing[key] !== undefined && existing[key] !== value) {
      setField(input, parent, {});
    }
    setField(input, field, value);
  }
  for (const flag of given) {
    const raw = values[flag.flag] as NonNullable<Values[string]>;
    if (flag.field === GUEST_FIELD) {
      setField(input, ROOMS_FIELD, withGuests(getField(input, ROOMS_FIELD), parseGuests(raw as string[])));
    } else {
      setField(input, flag.field, readFlag(flag, raw));
    }
  }
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
    if (isObject(parsed)) return parsed;
  } catch {}
  throw usageError("--body must be a JSON object");
}

function isObject(value: unknown): value is Body {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The object a part of a dotted field steps into: the item of a one-item
 *  list, or the object at that key. Created (or replacing a value that
 *  isn't one) when `create`. */
function step(node: Body, part: string, create: boolean): Body | undefined {
  if (ONE_ITEM_LISTS.has(part)) {
    let list = node[part];
    if (!Array.isArray(list)) {
      if (!create) return undefined;
      list = node[part] = [];
    }
    const items = list as unknown[];
    if (!isObject(items[0])) {
      if (!create) return undefined;
      items[0] = {};
    }
    return items[0] as Body;
  }
  if (!isObject(node[part])) {
    if (!create) return undefined;
    node[part] = {};
  }
  return node[part] as Body;
}

function getField(body: Body, field: string): unknown {
  let node: Body | undefined = body;
  const path = field.split(".");
  const last = path.pop() as string;
  for (const part of path) {
    node = node && step(node, part, false);
  }
  return node?.[last];
}

/** Sets a field; dots step into objects and one-item lists. */
function setField(body: Body, field: string, value: unknown): void {
  const path = field.split(".");
  const last = path.pop() as string;
  let node = body;
  for (const part of path) node = step(node, part, true) as Body;
  node[last] = value;
}

/** What a flag's value means for its field. */
function readFlag(flag: FlagSpec, raw: NonNullable<Values[string]>): unknown {
  if (flag.type === "boolean") return flag.value ?? true;
  const given = (Array.isArray(raw) ? raw : [raw]) as string[];
  switch (flag.field) {
    case "destination.location":
      return parsePoint(given[0] as string);
    case "stay.rooms":
      return given.map(parseRoom);
    case "filters.price.maxPerRoomNight":
      return { amount: (given[0] as string).trim(), currency: "USD" };
  }
  const parsed = given.map((value) => {
    if (flag.type === "number") return num(flag.flag, value);
    return UPPER_CASE.has(flag.field) ? value.trim().toUpperCase() : value;
  });
  return flag.multiple ? parsed : parsed[0];
}

/** A decimal number: `Number` would also read "0x10" as 16 or "1e3" as 1000. */
function num(flag: string, value: string): number {
  const text = value.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) {
    throw usageError(`--${flag} must be a number, got "${value}"`);
  }
  return Number(text);
}

/** `--point lat,lng`. */
function parsePoint(value: string): Body {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => !/^[+-]?\d+(\.\d+)?$/.test(part))) {
    throw usageError(`--point must be lat,lng (e.g. 13.75,100.5), got "${value}"`);
  }
  const [lat, lng] = parts.map(Number);
  return { lat, lng };
}

/** `--room 2` or `--room 2:6,9`: the adults, and each child's age. */
function parseRoom(value: string): Body {
  const match = value.replace(/\s+/g, "").match(/^(\d+)(?::(\d+(?:,\d+)*))?$/);
  if (!match) {
    throw usageError(
      `--room must be adults or adults:age,age with each child's age (e.g. 2 or 2:6,9), got "${value}"`,
    );
  }
  return {
    adults: Number(match[1]),
    childrenAges: match[2] ? match[2].split(",").map(Number) : [],
  };
}

/** `--guest room:first:last`, once per guest: each room's guests, by room
 *  number, in the order given. */
function parseGuests(values: string[]): Map<number, Body[]> {
  const rooms = new Map<number, Body[]>();
  for (const value of values) {
    const parts = value.split(":").map((part) => part.trim());
    const [room, firstName, lastName] = parts;
    const number = Number(room);
    if (parts.length !== 3 || !/^\d+$/.test(room ?? "")) {
      throw usageError(`--guest must be room:first:last (e.g. 1:John:Smith), got "${value}"`);
    }
    if (number < 1 || number > LIMITS.rooms) {
      throw usageError(`--guest room must be 1 to ${LIMITS.rooms}, got "${value}"`);
    }
    rooms.set(number, [...(rooms.get(number) ?? []), { firstName, lastName }]);
  }
  return rooms;
}

/** The order's rooms with the flags' guests: a room the flags name gets
 *  their guests in place of `--body`'s, and the other rooms are kept.
 *  Rooms are numbered from 1, none skipped. */
function withGuests(fromBody: unknown, guests: Map<number, Body[]>): unknown[] {
  const rooms = Array.isArray(fromBody) ? [...fromBody] : [];
  for (const [number, list] of guests) {
    const room = rooms[number - 1];
    rooms[number - 1] = { ...(isObject(room) ? room : {}), guests: list };
  }
  for (let index = 0; index < rooms.length; index++) {
    if (rooms[index] === undefined) {
      throw usageError(
        `--guest rooms are numbered from 1 with none skipped: no guest for room ${index + 1}`,
      );
    }
  }
  return rooms;
}
