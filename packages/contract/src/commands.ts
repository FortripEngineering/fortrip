import { z } from "zod";

import {
  cancelOrderInput,
  payOrderInput,
  createOrderInput,
  getHotelInput,
  getOrderInput,
  hotelOffersInput,
  listOrdersInput,
  searchHotelsInput,
} from "./inputs.ts";
import { CURRENCIES, LIMITS } from "./limits.ts";
import type { ToolName } from "./tools.ts";
import { FILTERABLE_AMENITIES, SEARCH_SORTS } from "./vocabulary.ts";

/*
 * The CLI's commands and flags: what `fortrip --help` lists and the docs
 * render, and what the CLI builds its argument parser from. A flag is a field
 * of the tool's input, so its description is the field's own unless the CLI
 * words it differently.
 *
 * Commands that act on one kind of thing are typed after its group
 * (`fortrip hotels search`, `fortrip orders list`); the CLI's own account and
 * meta commands are typed on their own (`fortrip login`). Adding a group is
 * adding it to `CommandGroupSpec` and `COMMAND_GROUPS`, and its commands to
 * `COMMANDS`.
 */

/** A flag that sets one field of a tool's input. */
export interface FlagSpec {
  /** The long name without dashes: `check-in` for `--check-in`. */
  flag: string;
  /**
   * The input field it sets; dots step into objects, the items of a list and
   * the variant of a union that `sets` picks (`destination.placeId`).
   */
  field: string;
  /**
   * How the CLI reads the value. A `boolean` flag takes none: it sends true,
   * or `value` when it has one. A `string` flag whose field is an object or
   * a list of objects is one value the CLI parses into that shape:
   * `--point` `lat,lng`; `--room` `adults[:age,…]` (`2:6,9` is two adults
   * and children of 6 and 9); `--price-max-per-room-night` an amount in
   * the request's currency; `--guest` `room:first:last`, into that room's
   * guests.
   */
  type: "string" | "number" | "boolean";
  /** Given once per item; its field is a list. */
  multiple?: boolean;
  /** What a `boolean` flag sends when its field isn't boolean:
   *  `--room-types` sends `include: "roomTypes"`. */
  value?: string;
  /**
   * Fields the flag also sends, each with a constant: the variant of a union
   * it picks. `--place` sends `destination.kind: "place"`. Flags that pick
   * different variants of one union can't be given together.
   */
  sets?: Readonly<Record<string, string>>;
  /**
   * What the value looks like in help, as it follows the flag name: `<n>`,
   * `YYYY-MM-DD`, `en|zh` (an enum's values), `<plc_>`. Every flag that takes
   * a value has one.
   */
  placeholder?: string;
  /** The command needs the field: `always`, or `unless-body` for a field
   *  `--body` can give instead. Its description says so first. */
  required?: "always" | "unless-body";
  description: string;
}

/** An argument given by position. */
export interface PositionalSpec {
  /** As help shows it: `<hotelId>`. */
  name: string;
  /** The input field it sets. */
  field: string;
  description: string;
}

/** An option of the CLI itself that no tool takes: not a field of any input. */
export interface OptionSpec {
  /** The long name without dashes. */
  flag: string;
  /** The one-letter name without its dash. */
  short?: string;
  type: "string" | "boolean";
  /** As on `FlagSpec`; every option that takes a value has one. */
  placeholder?: string;
  description: string;
}

/** A group of commands, typed after its name: `fortrip hotels`. */
export interface CommandGroupSpec {
  name: "hotels" | "orders";
  summary: string;
}

export interface CommandSpec {
  /** The group it is typed after; `null` for a command typed on its own. */
  group: CommandGroupSpec["name"] | null;
  /** Unique within its group. */
  name:
    | "search"
    | "get"
    | "offers"
    | "create"
    | "list"
    | "cancel"
    | "pay"
    | "login"
    | "logout"
    | "whoami"
    | "mcp";
  summary: string;
  /** The MCP tool the command mirrors; `null` for one that is the CLI's own. */
  tool: ToolName | null;
  /** The tool's input fields the command sets. */
  flags: readonly FlagSpec[];
  positionals?: readonly PositionalSpec[];
  /** Options that are not input fields, such as `--body`. */
  options?: readonly OptionSpec[];
}

type JsonSchema = {
  description?: string;
  type?: string;
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
};

/**
 * The description of an input field. Dots step into objects and lists, and
 * into the union variant whose constants are in `sets`.
 */
function fieldDescription(
  json: JsonSchema,
  field: string,
  sets: Readonly<Record<string, string>> = {},
): string {
  let node: JsonSchema | undefined = json;
  const path: string[] = [];
  for (const part of field.split(".")) {
    if (node?.type === "array") node = node.items;
    const at = path.join(".");
    const variants: JsonSchema[] = node?.oneOf ?? node?.anyOf ?? (node ? [node] : []);
    node = variants.find(
      (variant) =>
        variant.properties?.[part] &&
        Object.entries(sets).every(
          ([key, value]) =>
            !key.startsWith(`${at}.`) ||
            variant.properties?.[key.slice(at.length + 1)]?.const === value,
        ),
    )?.properties?.[part];
    path.push(part);
  }
  if (!node?.description) throw new Error(`No description for field ${field}`);
  return node.description;
}

/** A flag before its description is settled: a required one's help starts
 *  with "Required." or, for a field `--body` can give instead, "Required
 *  unless --body gives it." */
type FlagDef = Omit<FlagSpec, "description"> & { description?: string };

/** The flags of a command that sends `input`, each with its field's
 *  description unless the definition words it otherwise. */
function flagsOf(
  input: z.ZodType,
  defs: readonly FlagDef[],
): readonly FlagSpec[] {
  const json = z.toJSONSchema(input, { io: "input" }) as JsonSchema;
  return defs.map((def) => {
    const description = def.description ?? fieldDescription(json, def.field, def.sets);
    const prefix =
      def.required === "always"
        ? "Required. "
        : def.required === "unless-body"
          ? "Required unless --body gives it. "
          : "";
    return { ...def, description: `${prefix}${description}` };
  });
}

function positional(
  input: z.ZodType,
  name: string,
  description?: string,
): PositionalSpec {
  const json = z.toJSONSchema(input, { io: "input" }) as JsonSchema;
  return {
    name,
    field: name,
    description: description ?? fieldDescription(json, name),
  };
}

const COUNT = "<n>";
const DATE = "YYYY-MM-DD";
const ROOM = "<adults[:age,…]>";
const LOCALES = "en|zh";

const kind = (value: string) => ({ "destination.kind": value });

const localeFlag: FlagDef = {
  flag: "locale",
  field: "locale",
  type: "string",
  placeholder: LOCALES,
};

const currencyFlag: FlagDef = {
  flag: "currency",
  field: "currency",
  type: "string",
  placeholder: CURRENCIES.join("|"),
};

/** `stay` as flags, the same in search and offers. */
function stayFlags(roomDescription: string): FlagDef[] {
  return [
    { flag: "check-in", field: "stay.checkIn", type: "string", placeholder: DATE },
    { flag: "check-out", field: "stay.checkOut", type: "string", placeholder: DATE },
    {
      flag: "room",
      field: "stay.rooms",
      type: "string",
      multiple: true,
      placeholder: ROOM,
      description: roomDescription,
    },
  ];
}

const ROOM_FORMAT =
  "as `adults` or `adults:age,age` with each child's age, e.g. `2` or `2:6,9`";

const searchFlags = flagsOf(searchHotelsInput, [
  {
    flag: "place-name",
    field: "destination.name",
    type: "string",
    sets: kind("place_name"),
    placeholder: "<name>",
    description:
      "Search a place by its name, in any language (e.g. Tokyo or 东京), with its country in `--country`.",
  },
  {
    flag: "country",
    field: "destination.countryCode",
    type: "string",
    sets: kind("place_name"),
    placeholder: "<CC>",
    description: "The country of `--place-name`, ISO 3166-1 alpha-2, e.g. JP.",
  },
  {
    flag: "place",
    field: "destination.placeId",
    type: "string",
    sets: kind("place"),
    placeholder: "<plc_>",
    description: "Search a place by its placeId from an earlier answer.",
  },
  {
    flag: "locality",
    field: "destination.placeId",
    type: "string",
    sets: kind("locality"),
    placeholder: "<plc_>",
    description:
      "Search a locality by its placeId, as an earlier search listed it under localities.",
  },
  {
    flag: "point",
    field: "destination.location",
    type: "string",
    sets: kind("point"),
    placeholder: "<lat,lng>",
    description: "Search around a point, as `lat,lng` (WGS84), e.g. `13.75,100.5`.",
  },
  {
    flag: "country-only",
    field: "destination.countryCode",
    type: "string",
    sets: kind("country"),
    placeholder: "<CC>",
    description: "Search a whole country, ISO 3166-1 alpha-2, e.g. JP.",
  },
  {
    flag: "radius-meters",
    field: "destination.radiusMeters",
    type: "number",
    placeholder: COUNT,
  },
  {
    flag: "text",
    field: "text",
    type: "string",
    placeholder: "<text>",
    description: `Hotel name, brand or area to match, 1 to ${LIMITS.textLength} characters. A first page needs this or a destination.`,
  },
  ...stayFlags(
    `A room, ${ROOM_FORMAT}. Repeat for each room, up to ${LIMITS.rooms}; rooms may differ.`,
  ),
  {
    flag: "pricing",
    field: "pricing",
    type: "string",
    placeholder: "indicative|none",
  },
  { flag: "stars-min", field: "filters.stars.min", type: "number", placeholder: COUNT },
  { flag: "stars-max", field: "filters.stars.max", type: "number", placeholder: COUNT },
  {
    flag: "amenity",
    field: "filters.amenities",
    type: "string",
    multiple: true,
    placeholder: FILTERABLE_AMENITIES.join("|"),
    description: `An amenity every hotel must list; repeat for each, up to ${LIMITS.amenityFilters}.`,
  },
  {
    flag: "price-max-per-room-night",
    field: "filters.price.maxPerRoomNight",
    type: "string",
    placeholder: "<decimal>",
    description:
      "Highest indicative price per room per night, in the search's currency (`--currency`, else USD), e.g. `150` or `149.50`. Needs a stay.",
  },
  {
    flag: "sort",
    field: "sort",
    type: "string",
    placeholder: SEARCH_SORTS.join("|"),
  },
  { flag: "limit", field: "limit", type: "number", placeholder: COUNT },
  {
    flag: "cursor",
    field: "cursor",
    type: "string",
    placeholder: "<cursor>",
    description:
      "The cursor the previous page gave for the next one. A next page takes only `--cursor` and `--limit`.",
  },
  localeFlag,
  currencyFlag,
]);

const hotelFlags = flagsOf(getHotelInput, [
  {
    flag: "room-types",
    field: "include",
    type: "boolean",
    value: "roomTypes",
    description: "Add the hotel's room types.",
  },
  localeFlag,
]);

const offersFlags = flagsOf(hotelOffersInput, [
  {
    flag: "hotel",
    field: "hotelIds",
    type: "string",
    multiple: true,
    placeholder: "<htl_>",
    description: `A hotel to price, by hotelId from \`hotels search\`; repeat for each, up to ${LIMITS.offersHotels}.`,
  },
  ...stayFlags(
    `A room, ${ROOM_FORMAT}. Repeat for each room, up to ${LIMITS.rooms}; every room must be the same.`,
  ),
  { flag: "require-breakfast", field: "filters.requireBreakfast", type: "boolean" },
  {
    flag: "require-free-cancellation",
    field: "filters.requireFreeCancellation",
    type: "boolean",
  },
  { flag: "limit-per-hotel", field: "limitPerHotel", type: "number", placeholder: COUNT },
  localeFlag,
  currencyFlag,
]);

const createFlags = flagsOf(createOrderInput, [
  {
    flag: "offer",
    field: "items.offerId",
    type: "string",
    placeholder: "<off_>",
    required: "unless-body",
    description: "The offer to order, by offerId from `hotels offers`.",
  },
  {
    flag: "guest",
    field: "items.hotel.rooms.guests",
    type: "string",
    multiple: true,
    placeholder: "<room>:<first>:<last>",
    required: "unless-body",
    description:
      "A guest, as `room:first:last`, e.g. `1:John:Smith` for room 1. Repeat for each guest: at least one per room of the offer, no more than the room sleeps. Names in Latin letters as on the passport; transliterate accents (Müller → Mueller).",
  },
  { flag: "name", field: "contact.name", type: "string", placeholder: "<name>", required: "unless-body" },
  { flag: "email", field: "contact.email", type: "string", placeholder: "<email>", required: "unless-body" },
  { flag: "phone", field: "contact.phone", type: "string", placeholder: "<phone>", required: "unless-body" },
  {
    flag: "special-requests",
    field: "items.hotel.specialRequests",
    type: "string",
    placeholder: "<english text>",
  },
]);

const orderFlags = flagsOf(getOrderInput, [localeFlag]);

const ordersListFlags = flagsOf(listOrdersInput, [
  { flag: "cursor", field: "cursor", type: "string", placeholder: "<cursor>" },
  { flag: "limit", field: "limit", type: "number", placeholder: COUNT },
  localeFlag,
]);

const cancelFlags = flagsOf(cancelOrderInput, [
  {
    flag: "max-penalty",
    field: "maximumPenalty",
    type: "string",
    placeholder: "<amount>",
    description:
      "To cancel a paid order: the penalty the user agreed to, exactly as `orders get` shows it, in the order's currency, e.g. `12.50`. Give exactly one of it and --close: with neither the command is refused and nothing is sent, and `orders get` shows the penalty and the refund, or that the order can be closed.",
  },
  {
    flag: "close",
    field: "close",
    type: "boolean",
    description:
      "Close an unpaid order, one whose Cancel line says it can be closed, only once the user says they no longer want it: nothing is charged, and it can no longer be paid. Nothing is sent for a paid order, which is cancelled with --max-penalty.",
  },
]);

const payFlags = flagsOf(payOrderInput, [
  {
    flag: "token",
    field: "sharedPaymentToken",
    type: "string",
    placeholder: "<spt_…>",
    required: "always",
    description:
      "The spt_… token the user's Link wallet issued for this order. For agents that can request a token from the user's Link wallet; people pay by the order's link.",
  },
  {
    flag: "total",
    field: "total",
    type: "string",
    placeholder: "<decimal>",
    required: "always",
    description:
      "The total the user approved, exactly as `orders get` shows it, e.g. `125.00`. In USD: a token pays a USD order only.",
  },
]);

/** The request body, which the flags then override field by field. */
const BODY_OPTION: OptionSpec = {
  flag: "body",
  type: "string",
  placeholder: "<json|@file.json>",
  description:
    "The raw request body as a JSON object, or `@file.json` to read it from a file. Flags override its fields.",
};

export const COMMAND_GROUPS: readonly CommandGroupSpec[] = [
  { name: "hotels", summary: "Search hotels, read one's details and get live offers" },
  { name: "orders", summary: "Create an order from an offer; your orders, their status, paying and cancelling one" },
];

export const COMMANDS: readonly CommandSpec[] = [
  {
    group: "hotels",
    name: "search",
    summary: "Find hotels in a place, near a point or by name, with indicative prices",
    tool: "search_hotels",
    flags: searchFlags,
    options: [BODY_OPTION],
  },
  {
    group: "hotels",
    name: "get",
    summary: "Hotel details: description, policies, amenities and room types",
    tool: "get_hotel",
    flags: hotelFlags,
    positionals: [positional(getHotelInput, "hotelId")],
  },
  {
    group: "hotels",
    name: "offers",
    summary: `Live bookable offers for up to ${LIMITS.offersHotels} hotels`,
    tool: "get_hotel_offers",
    flags: offersFlags,
    options: [BODY_OPTION],
  },
  {
    group: "orders",
    name: "create",
    summary: "Create an unpaid order for an offer, with a payment link",
    tool: "create_order",
    flags: createFlags,
    options: [BODY_OPTION],
  },
  {
    group: "orders",
    name: "get",
    summary: "Show an order and its status",
    tool: "get_order",
    flags: orderFlags,
    positionals: [positional(getOrderInput, "orderId")],
  },
  {
    group: "orders",
    name: "list",
    summary: "List your orders, newest first",
    tool: "list_orders",
    flags: ordersListFlags,
  },
  {
    group: "orders",
    name: "cancel",
    summary:
      "Cancel a paid order under its terms (--max-penalty), or close an unpaid one (--close)",
    tool: "cancel_order",
    flags: cancelFlags,
    positionals: [positional(cancelOrderInput, "orderId")],
  },
  {
    group: "orders",
    name: "pay",
    summary: "Pay an order with a Link token (US and Canada), instead of its payment link",
    tool: "pay_order",
    flags: payFlags,
    positionals: [positional(payOrderInput, "orderId")],
  },
  {
    group: null,
    name: "login",
    summary: "Sign in through the browser",
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
    group: null,
    name: "logout",
    summary: "Revoke and forget the saved token",
    tool: null,
    flags: [],
  },
  {
    group: null,
    name: "whoami",
    summary: "Show the signed-in account",
    tool: null,
    flags: [],
  },
  {
    group: null,
    name: "mcp",
    summary:
      "Run an MCP server over stdio for local clients, bridged to Fortrip's hosted server",
    tool: null,
    flags: [],
  },
];

/** `fortrip hotels search`, `fortrip login`: a command as it is typed,
 *  without its arguments. */
export function commandInvocation(
  spec: Pick<CommandSpec, "group" | "name">,
): string {
  return spec.group === null
    ? `fortrip ${spec.name}`
    : `fortrip ${spec.group} ${spec.name}`;
}

/** Options of the CLI itself: `--help` after any command, `--version` on
 *  its own, `--json` with any command. */
export const GLOBAL_FLAGS: readonly OptionSpec[] = [
  {
    flag: "help",
    short: "h",
    type: "boolean",
    description:
      "Show help for the command or group, or for the CLI when no command is given.",
  },
  {
    flag: "version",
    short: "v",
    type: "boolean",
    description: "Print the CLI version.",
  },
  {
    flag: "json",
    type: "boolean",
    description:
      "Print the answer as its JSON on one line instead of text; an error prints its JSON envelope, on stderr.",
  },
];
