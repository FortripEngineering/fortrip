import { z } from "zod";

import {
  createBookingInput,
  getHotelInput,
  getRatesInput,
  searchHotelsInput,
} from "./inputs.ts";
import { LIMITS } from "./limits.ts";
import type { ToolName } from "./tools.ts";

/*
 * The CLI's commands and flags: what `fortrip --help` lists and the docs
 * render, and what the CLI builds its argument parser from. A flag is a field
 * of the tool's input, so its description is the field's own unless the CLI
 * words it differently.
 */

/** A flag that sets one field of a tool's input. */
export interface FlagSpec {
  /** The long name without dashes: `check-in` for `--check-in`. */
  flag: string;
  /** The one-letter name without its dash: `q` for `-q`. */
  short?: string;
  /** The input field it sets; dots step into an object (`near.lat`). */
  field: string;
  /**
   * How the CLI reads the value. `id` is digits only, a positive whole
   * number. A `boolean` flag sets its field to true, except where the field
   * defaults to true (`bookableOnly`): `--include-unbookable` sets it to
   * false. A `string` flag whose field is an object (`near`, read as
   * `lat,lng,radiusKm`) or a list of objects (`guests`, read as
   * `First Last[:roomNo]`) is one value the CLI parses into that shape.
   */
  type: "string" | "number" | "boolean" | "id";
  /** Given once per item; its field is a list. */
  multiple?: boolean;
  description: string;
}

/** An option of the CLI itself that no tool takes: not a field of any input. */
export interface OptionSpec {
  /** The long name without dashes. */
  flag: string;
  /** The one-letter name without its dash. */
  short?: string;
  type: "string" | "boolean";
  description: string;
}

export interface CommandSpec {
  name:
    | "search"
    | "hotel"
    | "rates"
    | "book"
    | "login"
    | "logout"
    | "whoami"
    | "guide"
    | "mcp";
  summary: string;
  /** The MCP tool the command mirrors; `null` for one that is the CLI's own. */
  tool: ToolName | null;
  /** The tool's input fields the command sets. */
  flags: readonly FlagSpec[];
  /** Named after the input field they set, except `guide`'s `topic`. */
  positionals?: readonly string[];
  /** Options that are not input fields, such as `--body`. */
  options?: readonly OptionSpec[];
}

type JsonSchema = {
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
};

/** The description of an input field (dots step into objects and lists). */
function fieldDescription(json: JsonSchema, field: string): string {
  let node: JsonSchema | undefined = json;
  for (const part of field.split(".")) {
    node = (node?.properties ?? node?.items?.properties)?.[part];
  }
  if (!node?.description) throw new Error(`No description for field ${field}`);
  return node.description;
}

type FlagDef = Omit<FlagSpec, "description"> & { description?: string };

/** The flags of a command that sends `input`, each with its field's
 *  description unless the definition words it otherwise. */
function flagsOf(
  input: z.ZodType,
  defs: readonly FlagDef[],
): readonly FlagSpec[] {
  const json = z.toJSONSchema(input, { io: "input" }) as JsonSchema;
  return defs.map((def) => ({
    ...def,
    description: def.description ?? fieldDescription(json, def.field),
  }));
}

// The CLI sends the HTTP API's requests, so its flags read from the HTTP
// schemas (rates differs from the MCP tool in `maxRoomsPerHotel`).

const searchFlags = flagsOf(searchHotelsInput, [
  {
    flag: "query",
    short: "q",
    field: "query",
    type: "string",
    description:
      "Hotel name, brand or city to search for. Provide at least one of `--query`, `--city-code` or `--near`.",
  },
  { flag: "city-code", field: "cityCode", type: "id" },
  {
    flag: "near",
    field: "near",
    type: "string",
    description: `Search around a point, as \`lat,lng,radiusKm\` (radius up to ${LIMITS.nearRadiusKm}), e.g. \`13.75,100.5,5\`.`,
  },
  { flag: "check-in", field: "checkIn", type: "string" },
  { flag: "check-out", field: "checkOut", type: "string" },
  { flag: "star-min", field: "starMin", type: "number" },
  { flag: "star-max", field: "starMax", type: "number" },
  { flag: "facility", field: "facilities", type: "string", multiple: true },
  { flag: "price-min", field: "priceMin", type: "number" },
  { flag: "price-max", field: "priceMax", type: "number" },
  { flag: "sort", field: "sortBy", type: "string" },
  { flag: "page", field: "page", type: "number" },
  { flag: "page-size", field: "pageSize", type: "number" },
  { flag: "currency", field: "currency", type: "string" },
]);

const hotelFlags = flagsOf(getHotelInput, [
  { flag: "with-rooms", field: "includeRooms", type: "boolean" },
]);

const ratesFlags = flagsOf(getRatesInput, [
  {
    flag: "hotel",
    field: "hotelIds",
    type: "id",
    multiple: true,
    description: `Hotels to price, by id from \`search\`: repeat the flag or comma-separate, up to ${LIMITS.ratesHotels}. Each call takes about 15 seconds.`,
  },
  { flag: "check-in", field: "checkIn", type: "string" },
  { flag: "check-out", field: "checkOut", type: "string" },
  { flag: "rooms", field: "rooms", type: "number" },
  {
    flag: "adults",
    field: "adults",
    type: "number",
    description:
      "Adults per room, not in total (2 rooms for 4 adults = `--rooms 2 --adults 2`)",
  },
  { flag: "child-age", field: "childrenAges", type: "number", multiple: true },
  { flag: "nationality", field: "nationality", type: "string" },
  { flag: "board", field: "boardCodes", type: "string", multiple: true },
  { flag: "free-cancellation", field: "freeCancellation", type: "boolean" },
  {
    flag: "include-unbookable",
    field: "bookableOnly",
    type: "boolean",
    description:
      "Also keep rates that are not bookable on every night (by default only bookable rates are returned).",
  },
  {
    flag: "max-rooms",
    field: "maxRoomsPerHotel",
    type: "number",
    description: "Return the N cheapest rooms per hotel. Default 10.",
  },
  { flag: "currency", field: "currency", type: "string" },
]);

const bookFlags = flagsOf(createBookingInput, [
  { flag: "hotel", field: "hotelId", type: "id" },
  {
    flag: "room-id",
    field: "roomId",
    type: "string",
    description: "`roomId` from `rates`",
  },
  {
    flag: "rate-plan",
    field: "ratePlanCode",
    type: "string",
    description: "`ratePlanCode` from `rates`",
  },
  { flag: "check-in", field: "checkIn", type: "string" },
  { flag: "check-out", field: "checkOut", type: "string" },
  {
    flag: "rooms",
    field: "rooms",
    type: "number",
    description:
      "Number of rooms, as in `rates`; every room has the same occupancy",
  },
  {
    flag: "adults",
    field: "adults",
    type: "number",
    description:
      "Adults per room, not in total, as in `rates` (2 rooms for 4 adults = `--rooms 2 --adults 2`)",
  },
  {
    flag: "child-age",
    field: "childrenAges",
    type: "number",
    multiple: true,
    description:
      "Age of each child in one room (0-17), per room, as in `rates`",
  },
  {
    flag: "guest",
    field: "guests",
    type: "string",
    multiple: true,
    description:
      'A guest, as "First Last" (room 1) or "First Last:roomNo", e.g. "Mary Ann Lee:2": the last word is the last name, the rest the first name. Repeat for each guest. At least one guest per room, no more than the room sleeps. Names in Latin letters as on the passport; transliterate accents (Müller → Mueller).',
  },
  { flag: "contact-name", field: "contactName", type: "string" },
  { flag: "contact-phone", field: "contactPhone", type: "string" },
  { flag: "contact-email", field: "contactEmail", type: "string" },
  { flag: "special-requests", field: "specialRequests", type: "string" },
]);

/** The request body, which the flags then override field by field. */
const BODY_OPTION: OptionSpec = {
  flag: "body",
  type: "string",
  description:
    "The raw request body as a JSON object, or `@file.json` to read it from a file. Flags override its fields.",
};

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: "search",
    summary: "Find hotels with indicative prices",
    tool: "search_hotels",
    flags: searchFlags,
    options: [BODY_OPTION],
  },
  {
    name: "hotel",
    summary: "Static hotel detail: description, policies, facilities and photos",
    tool: "get_hotel",
    flags: hotelFlags,
    positionals: ["hotelId"],
  },
  {
    name: "rates",
    summary: `Live rooms and rates for up to ${LIMITS.ratesHotels} hotels`,
    tool: "get_rates",
    flags: ratesFlags,
    options: [BODY_OPTION],
  },
  {
    name: "book",
    summary: "Create an order and get a payment link",
    tool: "create_booking",
    flags: bookFlags,
    options: [BODY_OPTION],
  },
  {
    name: "login",
    summary: "Sign in through the browser (device code)",
    tool: null,
    flags: [],
    options: [
      {
        flag: "no-browser",
        type: "boolean",
        description:
          "Don't open a browser: only print the sign-in code and link.",
      },
    ],
  },
  {
    name: "logout",
    summary: "Revoke and forget the saved token",
    tool: null,
    flags: [],
  },
  {
    name: "whoami",
    summary: "Show the signed-in account",
    tool: null,
    flags: [],
  },
  {
    name: "guide",
    summary: "Print the guide for AI agents (Markdown)",
    tool: "get_planning_guide",
    flags: [],
    positionals: ["topic"],
  },
  {
    name: "mcp",
    summary:
      "Run an MCP server over stdio for local clients, bridged to Fortrip's hosted server",
    tool: null,
    flags: [],
  },
];

/** Options of the CLI itself: `--help` after any command, `--version` on its own. */
export const GLOBAL_FLAGS: readonly OptionSpec[] = [
  {
    flag: "help",
    short: "h",
    type: "boolean",
    description:
      "Show help for the command, or for the CLI when no command is given.",
  },
  {
    flag: "version",
    short: "v",
    type: "boolean",
    description: "Print the CLI version.",
  },
];
