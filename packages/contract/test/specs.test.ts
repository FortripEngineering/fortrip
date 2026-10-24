import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import {
  COMMAND_GROUPS,
  COMMANDS,
  commandInvocation,
  GLOBAL_FLAGS,
  type CommandSpec,
  type FlagSpec,
} from "../src/commands.ts";
import { ERROR_CODES } from "../src/errors.ts";
import {
  createOrderInput,
  getHotelInput,
  getOrderInput,
  hotelOffersInput,
  listOrdersInput,
  searchHotelsInput,
} from "../src/inputs.ts";
import { LIMITS, SUPPORT_EMAIL } from "../src/limits.ts";
import { hotel } from "../src/outputs/hotel.ts";
import { hotelOffersResult } from "../src/outputs/offer.ts";
import { order, orderList } from "../src/outputs/order.ts";
import { searchResult } from "../src/outputs/search.ts";
import {
  MCP_OUTPUT,
  ORDER_NEXT_STEP,
  TOOLS,
  type ToolName,
  type ToolSpec,
} from "../src/tools.ts";
import { FILTERABLE_AMENITIES } from "../src/vocabulary.ts";

// The production bundle never runs zod's `config(en())`: messages asserted
// here must be our own.
z.config({ localeError: undefined });

type Json = {
  type?: string;
  description?: string;
  properties?: Record<string, Json>;
  items?: Json;
  oneOf?: Json[];
  anyOf?: Json[];
  required?: string[];
  default?: unknown;
  const?: unknown;
  enum?: unknown[];
  [key: string]: unknown;
};

function jsonOf(schema: z.ZodType, io: "input" | "output" = "input"): Json {
  return z.toJSONSchema(schema, { io }) as Json;
}

/** The branches a node may be: itself, or each branch of its union. */
function branches(node: Json): Json[] {
  return node.oneOf ?? node.anyOf ?? [node];
}

/**
 * The JSON schema of `path`: dots step into objects, into the items of a
 * list and into the branches of a union. In a union, the branch is the one
 * whose constants match `sets` (`destination.kind: "place"`), else the first
 * that has the field.
 */
function fieldOf(
  json: Json,
  path: string,
  sets: Readonly<Record<string, string>> = {},
): Json | undefined {
  let node: Json | undefined = json;
  const walked: string[] = [];
  for (const part of path.split(".")) {
    if (node?.type === "array" && node.items) node = node.items;
    const prefix = walked.join(".");
    const matches: Json[] = node
      ? branches(node).filter((branch) => {
          if (!branch.properties?.[part]) return false;
          return Object.entries(sets).every(([key, value]) => {
            const [head, ...rest] = key.split(".");
            if (rest.length !== 1 || head !== prefix) return true;
            return branch.properties?.[rest[0] as string]?.const === value;
          });
        })
      : [];
    node = matches[0]?.properties?.[part];
    walked.push(part);
  }
  return node;
}

function tool(name: ToolName): ToolSpec {
  const found = TOOLS.find((spec) => spec.name === name);
  assert.ok(found, name);
  return found;
}

/** A command as typed after `fortrip`: `hotels search`, `login`. */
function typed(spec: CommandSpec): string {
  return commandInvocation(spec).replace(/^fortrip /, "");
}

function command(name: string): CommandSpec {
  const found = COMMANDS.find((spec) => typed(spec) === name);
  assert.ok(found, name);
  return found;
}

/** The input a command's tool takes; throws for a command without one. */
function inputOf(spec: CommandSpec): z.ZodType {
  assert.ok(spec.tool, `${typed(spec)} has no tool`);
  const input = tool(spec.tool).input;
  assert.ok(input, `${spec.tool} has no input`);
  return input;
}

/** The supplier's name, assembled so this file doesn't carry it. */
const SUPPLIER = new RegExp(["hui" + "zhi", "汇" + "智"].join("|"), "i");

/** Every string in a value, however deep. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => [
      key,
      ...strings(item),
    ]);
  }
  return [];
}

const HTL = "htl_0123456789abcdefABCD";
const ORD = "ord_0123456789abcdefABCD";
const usd = (amount: string) => ({ amount, currency: "USD" });

const orderFixture = {
  orderId: ORD,
  reference: "FT-7KQ2MX",
  status: "awaiting_payment",
  createdAt: "2026-10-24T08:00:00Z",
  updatedAt: "2026-10-24T08:01:00Z",
  items: [
    {
      type: "hotel",
      hotel: {
        hotelId: HTL,
        name: "Hotel A",
        names: { en: "Hotel A", zh: null },
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
        timeZone: "Asia/Shanghai",
        rooms: [{ adults: 2, childrenAges: [] }],
        room: { name: { text: "Deluxe King", locale: "en" }, beds: null },
        meals: {
          known: false,
          included: null,
          unspecifiedMainMeals: null,
          allInclusive: null,
          guestsCoveredPerRoom: null,
          label: null,
        },
        cancellation: {
          status: "unknown",
          asOf: "2026-10-24T08:00:00Z",
          freeCancellationEndsAt: null,
          penalties: [],
          timeZone: "Asia/Shanghai",
        },
        payAtProperty: { disclosure: "incomplete", items: [] },
        confirmationNumber: null,
      },
    },
  ],
  price: { total: usd("132.40") },
  payment: {
    status: "unpaid",
    url: "https://fortrip.ai/booking-status?session_id=cs_test_1",
    requiresSignIn: false,
    expiresAt: "2026-10-25T08:00:00Z",
    chargeCurrency: "USD",
    localCurrencyAtCheckout: true,
    localCharge: null,
  },
  manageUrl: "https://fortrip.ai/orders/ord_0123456789abcdefABCD",
};

const TOOL_NAMES = [
  "get_planning_guide",
  "search_hotels",
  "get_hotel",
  "get_hotel_offers",
  "book_hotel",
  "get_order",
  "list_orders",
] as const;

describe("TOOLS", () => {
  it("lists the seven tools in call order", () => {
    assert.deepEqual(
      TOOLS.map((spec) => spec.name),
      [...TOOL_NAMES],
    );
  });

  // Titles are what MCP clients show people.
  it("titles every tool", () => {
    assert.deepEqual(
      Object.fromEntries(TOOLS.map((spec) => [spec.name, spec.title])),
      {
        get_planning_guide: "Get hotel planning guide",
        search_hotels: "Search hotels",
        get_hotel: "Get hotel details",
        get_hotel_offers: "Get live hotel offers",
        book_hotel: "Create hotel order and payment link",
        get_order: "Get order",
        list_orders: "List orders",
      },
    );
  });

  it("gives every tool a title and a description of at most 1,024 characters", () => {
    for (const spec of TOOLS) {
      assert.ok(spec.title.trim(), `${spec.name} title`);
      assert.ok(spec.description.trim(), `${spec.name} description`);
      assert.ok(
        spec.description.length <= 1024,
        `${spec.name}: ${spec.description.length} characters`,
      );
    }
  });

  // Spec §6: MCP tool inputs mirror the HTTP bodies and query exactly.
  it("every tool's input is the HTTP request schema", () => {
    assert.equal(tool("get_planning_guide").input, null);
    assert.equal(tool("search_hotels").input, searchHotelsInput);
    assert.equal(tool("get_hotel").input, getHotelInput);
    assert.equal(tool("get_hotel_offers").input, hotelOffersInput);
    assert.equal(tool("book_hotel").input, createOrderInput);
    assert.equal(tool("get_order").input, getOrderInput);
    assert.equal(tool("list_orders").input, listOrdersInput);
  });

  it("every tool but the planning guide has an output schema", () => {
    assert.equal(tool("get_planning_guide").output, null);
    assert.equal(tool("search_hotels").output, searchResult);
    assert.equal(tool("get_hotel").output, hotel);
    assert.equal(tool("get_hotel_offers").output, hotelOffersResult);
    assert.equal(tool("book_hotel").output, MCP_OUTPUT.book_hotel);
    assert.equal(tool("get_order").output, MCP_OUTPUT.get_order);
    assert.equal(tool("list_orders").output, MCP_OUTPUT.list_orders);
  });

  it("states all four hints on every tool, and only book_hotel writes", () => {
    for (const spec of TOOLS) {
      assert.deepEqual(
        Object.keys(spec.annotations).sort(),
        ["destructiveHint", "idempotentHint", "openWorldHint", "readOnlyHint"],
        spec.name,
      );
      assert.equal(spec.annotations.destructiveHint, false, spec.name);
      assert.equal(
        spec.annotations.readOnlyHint,
        spec.name !== "book_hotel",
        spec.name,
      );
      assert.equal(
        spec.annotations.idempotentHint,
        spec.name !== "book_hotel",
        spec.name,
      );
    }
    assert.deepEqual(
      Object.fromEntries(
        TOOLS.map((spec) => [spec.name, spec.annotations.openWorldHint]),
      ),
      {
        get_planning_guide: false,
        search_hotels: true,
        get_hotel: true,
        get_hotel_offers: true,
        book_hotel: true,
        get_order: false,
        list_orders: false,
      },
    );
  });

  it("book_hotel's hints are not destructive, not idempotent, open world", () => {
    const { annotations } = tool("book_hotel");
    assert.equal(annotations.destructiveHint, false);
    assert.equal(annotations.idempotentHint, false);
    assert.equal(annotations.openWorldHint, true);
  });

  it("get_hotel_offers names the hotel limit and the default offers per hotel from the code", () => {
    const { description } = tool("get_hotel_offers");
    assert.ok(description.includes(`up to ${LIMITS.offersHotels} hotels`), description);
    assert.ok(
      description.includes(`default ${LIMITS.offersPerHotelDefault}`),
      description,
    );
  });

  // C2: the result is an unpaid order with a payment link.
  it("book_hotel says it answers an unpaid order with a payment link, and where changes go", () => {
    const { description } = tool("book_hotel");
    assert.match(description, /unpaid order/);
    assert.match(description, /payment link/);
    assert.ok(description.includes(SUPPORT_EMAIL), description);
  });

  it("a description names only tools there are", () => {
    const names = new Set<string>(TOOLS.map((spec) => spec.name));
    // Snake-case words a text may name besides tools: the contract's own
    // codes and enum values.
    const vocabulary = new Set<string>([
      ...Object.keys(ERROR_CODES),
      ...TOOLS.flatMap((spec) =>
        [
          spec.input && jsonOf(spec.input),
          spec.output && jsonOf(spec.output, "output"),
        ].flatMap((json) => (json ? strings(json) : [])),
      ),
    ]);
    const texts = [
      ...TOOLS.map((spec) => spec.description),
      ...TOOLS.flatMap((spec) =>
        [spec.input, spec.output].flatMap((schema) =>
          schema ? strings(jsonOf(schema)) : [],
        ),
      ),
      ORDER_NEXT_STEP,
    ];
    for (const text of texts) {
      for (const [word] of text.matchAll(/\b(get|search|book|list)_[a-z_]+\b/g)) {
        assert.ok(names.has(word) || vocabulary.has(word), `${word} in: ${text}`);
      }
    }
  });
});

describe("ORDER_NEXT_STEP", () => {
  // The consent phrases 2.0's BOOKING_NEXT_STEP was pinned to, reworded
  // for an order's `payment.url`.
  it("tells the model to show the order, ask, and give the link only after a yes", () => {
    assert.match(
      ORDER_NEXT_STEP,
      /[Ss]how them [^.]*total[^.]*currency[^.]*stay[^.]*every term/,
    );
    assert.match(ORDER_NEXT_STEP, /end your reply by asking them to confirm, and wait for a clear yes/);
    assert.match(
      ORDER_NEXT_STEP,
      /Only after they say yes, give them payment\.url exactly as returned\.$/,
    );
  });

  it("names no tool", () => {
    for (const name of TOOL_NAMES) {
      assert.ok(!ORDER_NEXT_STEP.includes(name), name);
    }
    assert.doesNotMatch(ORDER_NEXT_STEP, /\b[a-z]+_[a-z_]+\b/);
  });
});

describe("MCP_OUTPUT", () => {
  it("covers the tools whose answer can carry a payment.url", () => {
    assert.deepEqual(Object.keys(MCP_OUTPUT), [
      "book_hotel",
      "get_order",
      "list_orders",
    ]);
  });

  it("accepts an order with and without nextStep", () => {
    for (const name of ["book_hotel", "get_order"] as const) {
      const schema = MCP_OUTPUT[name];
      assert.ok(schema.safeParse(orderFixture).success, `${name} without`);
      const parsed = schema.parse({ ...orderFixture, nextStep: ORDER_NEXT_STEP }) as {
        nextStep?: string;
      };
      assert.equal(parsed.nextStep, ORDER_NEXT_STEP, name);
      assert.equal(
        schema.safeParse({ ...orderFixture, nextStep: 1 }).success,
        false,
        `${name}: nextStep is text`,
      );
    }
  });

  it("accepts an order list with and without nextStep", () => {
    const list = { data: [orderFixture], nextCursor: null };
    const schema = MCP_OUTPUT.list_orders;
    assert.ok(schema.safeParse(list).success);
    assert.ok(schema.safeParse({ data: [], nextCursor: null }).success);
    const parsed = schema.parse({ ...list, nextStep: ORDER_NEXT_STEP }) as {
      nextStep?: string;
    };
    assert.equal(parsed.nextStep, ORDER_NEXT_STEP);
  });

  // Spec §6: `nextStep` is declared only in the MCP output schemas.
  it("is the HTTP schema plus an optional nextStep, and nothing else", () => {
    const pairs = [
      [MCP_OUTPUT.book_hotel, order],
      [MCP_OUTPUT.get_order, order],
      [MCP_OUTPUT.list_orders, orderList],
    ] as const;
    for (const [mcp, http] of pairs) {
      const mcpJson = jsonOf(mcp, "output");
      const httpJson = jsonOf(http, "output");
      assert.equal(httpJson.properties?.nextStep, undefined);
      const nextStep = mcpJson.properties?.nextStep;
      assert.equal(nextStep?.type, "string");
      assert.ok(nextStep?.description?.trim());
      assert.equal(mcpJson.required?.includes("nextStep"), false);
      const { nextStep: _, ...rest } = mcpJson.properties ?? {};
      assert.deepEqual({ ...mcpJson, properties: rest }, httpJson);
    }
  });
});

describe("COMMAND_GROUPS", () => {
  it("is the hotels and the orders group", () => {
    assert.deepEqual(
      COMMAND_GROUPS.map((group) => group.name),
      ["hotels", "orders"],
    );
    for (const group of COMMAND_GROUPS) {
      assert.ok(group.summary.trim(), `${group.name} summary`);
    }
  });

  it("every group has commands, and every command's group is listed", () => {
    const groups = new Set<string>(COMMAND_GROUPS.map((group) => group.name));
    for (const group of COMMAND_GROUPS) {
      assert.ok(
        COMMANDS.some((spec) => spec.group === group.name),
        `${group.name} has no commands`,
      );
    }
    for (const spec of COMMANDS) {
      if (spec.group !== null) assert.ok(groups.has(spec.group), typed(spec));
    }
  });

  // The CLI reads its first argument as a group before a command, so a
  // command named like a group could never run.
  it("no group is named like a command typed on its own, or like an option", () => {
    const topLevel = new Set<string>(
      COMMANDS.filter((spec) => spec.group === null).map((spec) => spec.name),
    );
    for (const group of COMMAND_GROUPS) {
      assert.equal(topLevel.has(group.name), false, group.name);
      assert.match(group.name, /^[a-z]+$/, group.name);
      assert.notEqual(group.name, "help");
    }
  });
});

describe("COMMANDS", () => {
  it("lists the eleven commands, as typed, each with the tool it mirrors", () => {
    const tools: Record<string, ToolName | null> = {
      "hotels search": "search_hotels",
      "hotels get": "get_hotel",
      "hotels offers": "get_hotel_offers",
      "hotels book": "book_hotel",
      "orders get": "get_order",
      "orders list": "list_orders",
      login: null,
      logout: null,
      whoami: null,
      guide: "get_planning_guide",
      mcp: null,
    };
    assert.deepEqual(COMMANDS.map(typed), Object.keys(tools));
    for (const spec of COMMANDS) {
      assert.ok(spec.summary.trim(), `${typed(spec)} summary`);
      assert.equal(spec.tool, tools[typed(spec)], typed(spec));
    }
  });

  it("names a command once within its group", () => {
    const invocations = COMMANDS.map(commandInvocation);
    assert.equal(new Set(invocations).size, invocations.length);
    for (const spec of COMMANDS) {
      assert.match(spec.name, /^[a-z]+$/, typed(spec));
    }
  });

  it("commandInvocation puts the group, if any, between fortrip and the name", () => {
    assert.equal(commandInvocation(command("orders list")), "fortrip orders list");
    assert.equal(commandInvocation(command("hotels offers")), "fortrip hotels offers");
    assert.equal(commandInvocation(command("whoami")), "fortrip whoami");
  });

  it("pins every flag to its field", () => {
    const fields = (name: string) =>
      Object.fromEntries(
        command(name).flags.map((flag) => [
          flag.flag,
          flag.sets
            ? `${flag.field} ${JSON.stringify(flag.sets)}`
            : flag.field,
        ]),
      );
    const kind = (value: string) => `{"destination.kind":"${value}"}`;
    assert.deepEqual(fields("hotels search"), {
      "place-name": `destination.name ${kind("place_name")}`,
      country: `destination.countryCode ${kind("place_name")}`,
      place: `destination.placeId ${kind("place")}`,
      locality: `destination.placeId ${kind("locality")}`,
      point: `destination.location ${kind("point")}`,
      "country-only": `destination.countryCode ${kind("country")}`,
      "radius-meters": "destination.radiusMeters",
      text: "text",
      "check-in": "stay.checkIn",
      "check-out": "stay.checkOut",
      room: "stay.rooms",
      pricing: "pricing",
      "stars-min": "filters.stars.min",
      "stars-max": "filters.stars.max",
      amenity: "filters.amenities",
      "price-max-per-room-night": "filters.price.maxPerRoomNight",
      sort: "sort",
      limit: "limit",
      cursor: "cursor",
      locale: "locale",
      "display-currency": "displayCurrency",
    });
    assert.deepEqual(fields("hotels get"), {
      rooms: "include",
      locale: "locale",
    });
    assert.deepEqual(fields("hotels offers"), {
      hotel: "hotelIds",
      "check-in": "stay.checkIn",
      "check-out": "stay.checkOut",
      room: "stay.rooms",
      "require-breakfast": "filters.requireBreakfast",
      "require-free-cancellation": "filters.requireFreeCancellation",
      "limit-per-hotel": "limitPerHotel",
      locale: "locale",
      "display-currency": "displayCurrency",
    });
    assert.deepEqual(fields("hotels book"), {
      offer: "items.offerId",
      guest: "items.hotel.rooms.guests",
      "first-name": "contact.firstName",
      "last-name": "contact.lastName",
      email: "contact.email",
      phone: "contact.phone",
      "special-requests": "items.hotel.specialRequests",
    });
    assert.deepEqual(fields("orders get"), { locale: "locale" });
    assert.deepEqual(fields("orders list"), {
      cursor: "cursor",
      limit: "limit",
      locale: "locale",
    });
    for (const name of ["login", "logout", "whoami", "guide", "mcp"]) {
      assert.deepEqual(command(name).flags, [], name);
    }
  });

  it("pins the positionals", () => {
    const positionals = Object.fromEntries(
      COMMANDS.map((spec) => [
        typed(spec),
        (spec.positionals ?? []).map(
          (p) => `${p.optional ? `[${p.name}]` : `<${p.name}>`} ${p.field}`,
        ),
      ]),
    );
    assert.deepEqual(positionals, {
      "hotels search": [],
      "hotels get": ["<hotelId> hotelId"],
      "hotels offers": [],
      "hotels book": [],
      "orders get": ["<orderId> orderId"],
      "orders list": [],
      login: [],
      logout: [],
      whoami: [],
      guide: ["[topic] null"],
      mcp: [],
    });
    for (const spec of COMMANDS) {
      for (const positional of spec.positionals ?? []) {
        assert.ok(positional.description.trim(), `${typed(spec)} ${positional.name}`);
      }
    }
  });

  it("repeats exactly the flags whose field is a list", () => {
    const repeated = COMMANDS.flatMap((spec) =>
      spec.flags.filter((flag) => flag.multiple).map((flag) => `${typed(spec)} ${flag.flag}`),
    );
    assert.deepEqual(repeated, [
      "hotels search room",
      "hotels search amenity",
      "hotels offers hotel",
      "hotels offers room",
      "hotels book guest",
    ]);
  });

  it("spells flags in kebab case, once per command, one flag per field and variant", () => {
    for (const spec of COMMANDS) {
      const flags = spec.flags.map((flag) => flag.flag);
      for (const flag of flags) {
        assert.match(flag, /^[a-z]+(-[a-z]+)*$/, `${typed(spec)} --${flag}`);
      }
      assert.equal(new Set(flags).size, flags.length, typed(spec));
      const targets = spec.flags.map(
        (flag) => `${flag.field} ${JSON.stringify(flag.sets ?? {})}`,
      );
      assert.equal(new Set(targets).size, targets.length, typed(spec));
    }
  });

  it("every flag's field resolves in its tool's input JSON Schema, in the variant it picks", () => {
    for (const spec of COMMANDS) {
      if (!spec.tool || !tool(spec.tool).input) {
        assert.deepEqual(spec.flags, [], `${typed(spec)} takes no input`);
        continue;
      }
      const json = jsonOf(inputOf(spec));
      for (const flag of spec.flags) {
        const label = `${typed(spec)} --${flag.flag}`;
        assert.ok(fieldOf(json, flag.field, flag.sets), `${label}: no ${flag.field}`);
        for (const [key, value] of Object.entries(flag.sets ?? {})) {
          assert.equal(fieldOf(json, key, flag.sets)?.const, value, `${label}: ${key}`);
        }
      }
      for (const positional of spec.positionals ?? []) {
        if (positional.field === null) continue;
        assert.ok(fieldOf(json, positional.field), `${typed(spec)} <${positional.name}>`);
      }
    }
  });

  it("resolves dotted fields through objects, lists and union variants", () => {
    const search = jsonOf(searchHotelsInput);
    assert.equal(
      fieldOf(search, "destination.location.lat", { "destination.kind": "point" })?.description,
      "Latitude, WGS84.",
    );
    assert.equal(
      fieldOf(search, "destination.countryCode", { "destination.kind": "country" })?.description,
      "ISO 3166-1 alpha-2 country, e.g. JP.",
    );
    assert.equal(fieldOf(search, "destination.location", { "destination.kind": "place" }), undefined);
    assert.equal(fieldOf(search, "destination.nope"), undefined);
    const booking = jsonOf(createOrderInput);
    assert.match(
      fieldOf(booking, "items.hotel.rooms.guests.firstName")?.description ?? "",
      /first name/,
    );
  });

  it("every input field has a flag or a positional, so the CLI can send any valid request", () => {
    for (const spec of COMMANDS) {
      if (!spec.tool || !tool(spec.tool).input) continue;
      const json = jsonOf(inputOf(spec));
      const reachable = new Set([
        ...spec.flags.map((flag) => flag.field.split(".")[0]),
        ...(spec.positionals ?? []).map((p) => p.field),
      ]);
      assert.deepEqual(
        Object.keys(json.properties ?? {}).filter((key) => !reachable.has(key)),
        [],
        typed(spec),
      );
    }
  });

  it("types each flag after its field", () => {
    // One flag value the CLI parses into an object: `lat,lng`,
    // `adults[:age,…]`, a USD amount, `room:first:last`.
    const composite = new Set([
      "hotels search point",
      "hotels search room",
      "hotels search price-max-per-room-night",
      "hotels offers room",
      "hotels book guest",
    ]);
    for (const spec of COMMANDS) {
      if (!spec.flags.length) continue;
      const json = jsonOf(inputOf(spec));
      for (const flag of spec.flags) {
        const label = `${typed(spec)} --${flag.flag}`;
        const field = fieldOf(json, flag.field, flag.sets);
        assert.ok(field, label);
        assert.equal(Boolean(flag.multiple), field.type === "array", label);
        const item = field.type === "array" ? field.items : field;
        assert.ok(item, label);
        if (composite.has(`${typed(spec)} ${flag.flag}`)) {
          assert.equal(flag.type, "string", label);
          assert.equal(item.type, "object", label);
        } else if (flag.value !== undefined) {
          // A boolean flag that sends one value of a field that isn't boolean.
          assert.equal(flag.type, "boolean", label);
          assert.ok(item.enum?.includes(flag.value), label);
        } else if (flag.type === "number") {
          assert.ok(["number", "integer"].includes(item.type ?? ""), label);
        } else {
          assert.equal(item.type, flag.type, label);
        }
      }
    }
  });

  it("only --rooms sends a value instead of true", () => {
    const valued = COMMANDS.flatMap((spec) =>
      spec.flags
        .filter((flag) => flag.value !== undefined)
        .map((flag) => `${typed(spec)} --${flag.flag}=${flag.value}`),
    );
    assert.deepEqual(valued, ["hotels get --rooms=rooms"]);
  });

  it("every flag description is non-empty", () => {
    for (const spec of COMMANDS) {
      for (const flag of spec.flags) {
        assert.ok(flag.description.trim(), `${typed(spec)} --${flag.flag}`);
      }
    }
  });

  it("every non-boolean flag has a placeholder, and a boolean flag has none", () => {
    for (const spec of COMMANDS) {
      for (const flag of spec.flags) {
        const label = `${typed(spec)} --${flag.flag}`;
        if (flag.type === "boolean") {
          assert.equal(flag.placeholder, undefined, label);
        } else {
          assert.ok(flag.placeholder?.trim(), label);
        }
      }
    }
  });

  it("a flag on an enum field lists the enum's values as its placeholder; --amenity the filterable ones", () => {
    const listed: string[] = [];
    for (const spec of COMMANDS) {
      if (!spec.flags.length) continue;
      const json = jsonOf(inputOf(spec));
      for (const flag of spec.flags) {
        if (flag.type === "boolean") continue;
        const field = fieldOf(json, flag.field, flag.sets);
        const item = field?.type === "array" ? field.items : field;
        const values = item?.enum as string[] | undefined;
        if (!values) continue;
        const label = `${typed(spec)} --${flag.flag}`;
        listed.push(label);
        const expected =
          label === "hotels search --amenity" ? [...FILTERABLE_AMENITIES] : values;
        assert.equal(flag.placeholder, expected.join("|"), label);
      }
    }
    assert.deepEqual(listed, [
      "hotels search --pricing",
      "hotels search --amenity",
      "hotels search --sort",
      "hotels search --locale",
      "hotels search --display-currency",
      "hotels get --locale",
      "hotels offers --locale",
      "hotels offers --display-currency",
      "orders get --locale",
      "orders list --locale",
    ]);
  });

  it("pins the placeholders of the flags that take ids, dates and composite values", () => {
    const placeholder = (name: string, flag: string) =>
      command(name).flags.find((f) => f.flag === flag)?.placeholder;
    assert.equal(placeholder("hotels search", "place-name"), "<name>");
    assert.equal(placeholder("hotels search", "country"), "<CC>");
    assert.equal(placeholder("hotels search", "place"), "<plc_>");
    assert.equal(placeholder("hotels search", "locality"), "<plc_>");
    assert.equal(placeholder("hotels search", "point"), "<lat,lng>");
    assert.equal(placeholder("hotels search", "country-only"), "<CC>");
    assert.equal(placeholder("hotels search", "room"), "<adults[:age,…]>");
    assert.equal(placeholder("hotels search", "price-max-per-room-night"), "<USD decimal>");
    assert.equal(placeholder("hotels search", "check-in"), "YYYY-MM-DD");
    assert.equal(placeholder("hotels offers", "hotel"), "<htl_>");
    assert.equal(placeholder("hotels offers", "room"), "<adults[:age,…]>");
    assert.equal(placeholder("hotels book", "offer"), "<off_>");
    assert.equal(placeholder("hotels book", "guest"), "<room>:<first>:<last>");
  });

  it("no flag or positional description names an MCP tool", () => {
    const toolNames = new RegExp(TOOLS.map((spec) => spec.name).join("|"));
    for (const spec of COMMANDS) {
      for (const text of [
        ...spec.flags.map((flag) => flag.description),
        ...(spec.positionals ?? []).map((p) => p.description),
      ]) {
        assert.doesNotMatch(text, toolNames, typed(spec));
      }
    }
  });

  it("a flag description names a command as it is typed after fortrip", () => {
    const typedNames = new Set(COMMANDS.map(typed));
    const words = new Set<string>([
      ...COMMANDS.map((spec) => spec.name),
      ...COMMAND_GROUPS.map((group) => group.name),
    ]);
    const named: string[] = [];
    for (const spec of COMMANDS) {
      for (const flag of spec.flags) {
        for (const [, code] of flag.description.matchAll(/`([^`]+)`/g)) {
          if (!words.has(code?.split(" ")[0] ?? "")) continue;
          named.push(code as string);
          assert.ok(typedNames.has(code as string), `${typed(spec)} --${flag.flag}: \`${code}\``);
        }
      }
    }
    assert.ok(named.includes("hotels offers"), "the walk found the commands named");
  });

  it("offers and book have no occupancy defaults", () => {
    const stayJson = fieldOf(jsonOf(hotelOffersInput), "stay");
    assert.ok(stayJson?.required?.includes("rooms"));
    assert.equal(stayJson?.properties?.rooms?.default, undefined);
    for (const flag of command("hotels offers").flags) {
      if (flag.field !== "stay.rooms") continue;
      assert.doesNotMatch(flag.description, /default/i);
    }
  });

  it("the guide command takes no input", () => {
    assert.equal(tool("get_planning_guide").input, null);
    assert.equal(tool("get_planning_guide").output, null);
    assert.deepEqual(command("guide").flags, []);
  });
});

describe("CLI-only options", () => {
  const all = (flags: readonly { flag: string }[]) =>
    flags.map((flag) => flag.flag);

  it("GLOBAL_FLAGS are --help, --version and --json", () => {
    assert.deepEqual(
      GLOBAL_FLAGS.map((flag) => [flag.flag, flag.short, flag.type]),
      [
        ["help", "h", "boolean"],
        ["version", "v", "boolean"],
        ["json", undefined, "boolean"],
      ],
    );
  });

  it("--body is taken by the commands that send a body, --no-browser by login", () => {
    const options = Object.fromEntries(
      COMMANDS.map((spec) => [typed(spec), all(spec.options ?? [])]),
    );
    assert.deepEqual(options, {
      "hotels search": ["body"],
      "hotels get": [],
      "hotels offers": ["body"],
      "hotels book": ["body"],
      "orders get": [],
      "orders list": [],
      login: ["no-browser"],
      logout: [],
      whoami: [],
      guide: [],
      mcp: [],
    });
    assert.equal(command("login").options?.[0]?.type, "boolean");
    assert.equal(command("hotels search").options?.[0]?.type, "string");
  });

  it("describes every option and collides with no flag", () => {
    for (const spec of COMMANDS) {
      const taken = new Set<string>([
        ...spec.flags.map((flag: FlagSpec) => flag.flag),
        ...all(GLOBAL_FLAGS),
      ]);
      for (const option of [...(spec.options ?? []), ...GLOBAL_FLAGS]) {
        assert.ok(option.description.trim(), `${typed(spec)} --${option.flag}`);
      }
      for (const option of spec.options ?? []) {
        assert.equal(taken.has(option.flag), false, `${typed(spec)} --${option.flag}`);
      }
      for (const flag of spec.flags) {
        assert.equal(all(GLOBAL_FLAGS).includes(flag.flag), false, `${typed(spec)} --${flag.flag}`);
      }
    }
  });

  it("every option that takes a value has a placeholder", () => {
    for (const spec of COMMANDS) {
      for (const option of [...(spec.options ?? []), ...GLOBAL_FLAGS]) {
        const label = `${typed(spec)} --${option.flag}`;
        if (option.type === "boolean") {
          assert.equal(option.placeholder, undefined, label);
        } else {
          assert.ok(option.placeholder?.trim(), label);
        }
      }
    }
  });
});

describe("the specs", () => {
  it("no spec names the supplier", () => {
    const everything = [
      ...strings(TOOLS.map(({ input, output, ...rest }) => rest)),
      ...TOOLS.flatMap((spec) =>
        [spec.input, spec.output].flatMap((schema) =>
          schema ? strings(jsonOf(schema)) : [],
        ),
      ),
      ...strings(COMMANDS),
      ...strings(COMMAND_GROUPS),
      ...strings(GLOBAL_FLAGS),
      ORDER_NEXT_STEP,
    ];
    assert.ok(everything.length > 100, "the walk found the specs' text");
    assert.deepEqual(everything.filter((text) => SUPPLIER.test(text)), []);
  });
});
