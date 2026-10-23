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
import {
  createBookingInput,
  getHotelInput,
  getRatesInput,
  searchHotelsInput,
} from "../src/inputs.ts";
import { BOARD_CODES, LIMITS, SUPPORT_EMAIL } from "../src/limits.ts";
import {
  BOOKING_NEXT_STEP,
  MCP_BOOKING_RESULT,
  MCP_RATES_INPUT,
  TOOLS,
  type ToolName,
  type ToolSpec,
} from "../src/tools.ts";

// The production bundle never runs zod's `config(en())`: messages asserted
// here must be our own.
z.config({ localeError: undefined });

type Json = {
  type?: string;
  description?: string;
  properties?: Record<string, Json>;
  items?: Json;
  required?: string[];
  default?: unknown;
  exclusiveMinimum?: number;
  [key: string]: unknown;
};

function jsonOf(schema: z.ZodType): Json {
  return z.toJSONSchema(schema, { io: "input" }) as Json;
}

/** The JSON schema of `path` (dots step into objects, and into the items of a list). */
function fieldOf(json: Json, path: string): Json | undefined {
  let node: Json | undefined = json;
  for (const part of path.split(".")) {
    node = (node?.properties ?? node?.items?.properties)?.[part];
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

describe("TOOLS", () => {
  it("lists the five tools in call order", () => {
    assert.deepEqual(
      TOOLS.map((spec) => spec.name),
      [
        "get_planning_guide",
        "search_hotels",
        "get_hotel",
        "get_hotel_rates",
        "book_hotel",
      ],
    );
  });

  it("gives every tool a title and a description", () => {
    for (const spec of TOOLS) {
      assert.ok(spec.title.trim(), `${spec.name} title`);
      assert.ok(spec.description.trim(), `${spec.name} description`);
    }
  });

  it("every tool's input is one of the contract schemas", () => {
    assert.equal(tool("get_planning_guide").input, null);
    assert.equal(tool("search_hotels").input, searchHotelsInput);
    assert.equal(tool("get_hotel").input, getHotelInput);
    assert.equal(tool("get_hotel_rates").input, MCP_RATES_INPUT);
    assert.equal(tool("book_hotel").input, createBookingInput);
  });

  it("only book_hotel has an output schema", () => {
    for (const spec of TOOLS) {
      assert.equal(
        spec.output,
        spec.name === "book_hotel" ? MCP_BOOKING_RESULT : null,
        spec.name,
      );
    }
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
    }
    assert.equal(tool("book_hotel").annotations.idempotentHint, true);
    assert.equal(tool("book_hotel").annotations.openWorldHint, true);
    assert.equal(tool("get_planning_guide").annotations.openWorldHint, false);
    for (const name of ["search_hotels", "get_hotel", "get_hotel_rates"] as const) {
      assert.equal(tool(name).annotations.openWorldHint, true, name);
    }
  });

  it("get_hotel_rates names the hotel limit and the MCP room default from the code", () => {
    const { description } = tool("get_hotel_rates");
    assert.ok(
      description.includes(`up to ${LIMITS.ratesHotels} hotels`),
      description,
    );
    assert.ok(description.includes("Returns the 5 cheapest rooms"), description);
  });

  it("get_hotel_rates explains every board code", () => {
    const { description } = tool("get_hotel_rates");
    for (const code of BOARD_CODES) {
      assert.match(description, new RegExp(`\\b${code}\\b`), code);
    }
  });

  it("book_hotel sends changes to the support address", () => {
    assert.ok(tool("book_hotel").description.includes(SUPPORT_EMAIL));
  });

  // A tool's name says its category, so a second category can't collide.
  it("names every tool but the planning guide after its category", () => {
    for (const spec of TOOLS) {
      if (spec.name === "get_planning_guide") continue;
      assert.match(spec.name, /_hotels?(_|$)/, spec.name);
    }
  });

  it("a description names only tools there are", () => {
    const names = new Set<string>(TOOLS.map((spec) => spec.name));
    const texts = [
      ...TOOLS.map((spec) => spec.description),
      ...TOOLS.flatMap((spec) =>
        [spec.input, spec.output].flatMap((schema) =>
          schema ? strings(jsonOf(schema)) : [],
        ),
      ),
      BOOKING_NEXT_STEP,
    ];
    for (const text of texts) {
      for (const [name] of text.matchAll(/\b[a-z]+(_[a-z]+)+\b/g)) {
        assert.ok(names.has(name), `${name} in: ${text}`);
      }
    }
  });

  it("BOOKING_NEXT_STEP tells the model to ask before giving the link", () => {
    assert.match(BOOKING_NEXT_STEP, /end your reply by asking them to confirm/);
    assert.match(
      BOOKING_NEXT_STEP,
      /Only after they say yes, give them paymentUrl exactly as returned\.$/,
    );
  });
});

describe("MCP_RATES_INPUT", () => {
  const valid = {
    hotelIds: [1],
    checkIn: "2099-01-01",
    checkOut: "2099-01-03",
    rooms: 1,
    adults: 2,
  };

  it("defaults maxRoomsPerHotel to 5 where the HTTP schema says 10", () => {
    assert.equal(MCP_RATES_INPUT.parse(valid).maxRoomsPerHotel, 5);
    assert.equal(getRatesInput.parse(valid).maxRoomsPerHotel, 10);
    const json = jsonOf(MCP_RATES_INPUT);
    assert.equal(json.properties?.maxRoomsPerHotel?.default, 5);
    assert.equal(
      json.properties?.maxRoomsPerHotel?.maximum,
      LIMITS.maxRoomsPerHotel,
    );
  });

  it("describes the MCP default, not the HTTP one", () => {
    const description = jsonOf(MCP_RATES_INPUT).properties?.maxRoomsPerHotel
      ?.description;
    assert.ok(description, "maxRoomsPerHotel has a description");
    assert.match(description, /\b5\b/);
    assert.doesNotMatch(description, /\b10\b/);
  });

  it("differs from getRatesInput in nothing else", () => {
    const mcp = jsonOf(MCP_RATES_INPUT);
    const http = jsonOf(getRatesInput);
    delete mcp.properties?.maxRoomsPerHotel;
    delete http.properties?.maxRoomsPerHotel;
    assert.deepEqual(mcp, http);
  });

  it("keeps the strict keys and the night limits", () => {
    const unknown = MCP_RATES_INPUT.safeParse({ ...valid, children: [3] });
    assert.equal(unknown.success, false);
    assert.equal(
      unknown.error?.issues[0]?.message,
      "Unknown argument(s): children",
    );
    const reversed = MCP_RATES_INPUT.safeParse({
      ...valid,
      checkOut: "2099-01-01",
    });
    assert.equal(reversed.success, false);
    assert.equal(
      reversed.error?.issues[0]?.message,
      "checkOut must be after checkIn",
    );
  });
});

describe("MCP_BOOKING_RESULT", () => {
  const result = {
    agentOrderId: "a1",
    paymentUrl: "https://fortrip.ai/pay/a1",
    amount: 10,
    currency: "USD",
    orderUrl: "https://fortrip.ai/orders/a1",
    stay: {
      hotelId: 1,
      hotelName: null,
      roomName: null,
      checkIn: "2099-01-01",
      checkOut: "2099-01-03",
      nights: 2,
      rooms: 1,
      adultsPerRoom: 2,
      childrenAgesPerRoom: [],
    },
    terms: null,
  };

  it("is the booking result plus the nextStep that rides on it", () => {
    const parsed = MCP_BOOKING_RESULT.parse({
      ...result,
      nextStep: BOOKING_NEXT_STEP,
    });
    assert.equal(parsed.nextStep, BOOKING_NEXT_STEP);
    assert.equal(MCP_BOOKING_RESULT.safeParse(result).success, false);
  });
});

describe("COMMAND_GROUPS", () => {
  it("is the hotels group", () => {
    assert.deepEqual(
      COMMAND_GROUPS.map((group) => group.name),
      ["hotels"],
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
  it("lists the nine commands, as typed", () => {
    assert.deepEqual(COMMANDS.map(commandInvocation), [
      "fortrip hotels search",
      "fortrip hotels get",
      "fortrip hotels rates",
      "fortrip hotels book",
      "fortrip login",
      "fortrip logout",
      "fortrip whoami",
      "fortrip guide",
      "fortrip mcp",
    ]);
  });

  it("names a command once within its group", () => {
    const invocations = COMMANDS.map(commandInvocation);
    assert.equal(new Set(invocations).size, invocations.length);
    for (const spec of COMMANDS) {
      assert.match(spec.name, /^[a-z]+$/, typed(spec));
    }
  });

  it("puts the commands that call a hotel tool in the hotels group, the CLI's own at the top", () => {
    for (const spec of COMMANDS) {
      const hotelTool = spec.tool !== null && spec.tool !== "get_planning_guide";
      assert.equal(spec.group, hotelTool ? "hotels" : null, typed(spec));
    }
  });

  it("gives every command a summary and the tool it mirrors", () => {
    const tools: Record<string, string | null> = {
      "hotels search": "search_hotels",
      "hotels get": "get_hotel",
      "hotels rates": "get_hotel_rates",
      "hotels book": "book_hotel",
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

  it("commandInvocation puts the group, if any, between fortrip and the name", () => {
    assert.equal(
      commandInvocation({ group: "hotels", name: "rates" }),
      "fortrip hotels rates",
    );
    assert.equal(commandInvocation({ group: null, name: "whoami" }), "fortrip whoami");
  });

  // 2.0 moved each 1.0 hotel command into the group with the same flags:
  // hotels search was search, hotels get was hotel, hotels rates was rates
  // and hotels book was book.
  it("pins the flags the CLI has always had", () => {
    const names = (name: string) =>
      command(name).flags.map((spec) => spec.flag);
    assert.deepEqual(names("hotels search"), [
      "query",
      "city-code",
      "near",
      "check-in",
      "check-out",
      "star-min",
      "star-max",
      "facility",
      "price-min",
      "price-max",
      "sort",
      "page",
      "page-size",
      "currency",
    ]);
    assert.deepEqual(names("hotels get"), ["with-rooms"]);
    assert.deepEqual(names("hotels rates"), [
      "hotel",
      "check-in",
      "check-out",
      "rooms",
      "adults",
      "child-age",
      "nationality",
      "board",
      "free-cancellation",
      "include-unbookable",
      "max-rooms",
      "currency",
    ]);
    assert.deepEqual(names("hotels book"), [
      "hotel",
      "room-id",
      "rate-plan",
      "check-in",
      "check-out",
      "rooms",
      "adults",
      "child-age",
      "guest",
      "contact-name",
      "contact-phone",
      "contact-email",
      "special-requests",
    ]);
    for (const name of ["login", "logout", "whoami", "guide", "mcp"] as const) {
      assert.deepEqual(names(name), [], name);
    }
    assert.deepEqual(command("hotels get").positionals, ["hotelId"]);
    assert.deepEqual(command("guide").positionals, ["topic"]);
  });

  // Written out by hand, not read from COMMANDS: the CLI builds each request
  // body from these pairs, so swapping two (check-in and check-out) would send
  // a different request while every other test still passed.
  it("pins every flag to its field", () => {
    const fieldsByFlag = (name: string) =>
      Object.fromEntries(
        command(name).flags.map((flag) => [flag.flag, flag.field]),
      );
    assert.deepEqual(fieldsByFlag("hotels search"), {
      query: "query",
      "city-code": "cityCode",
      near: "near",
      "check-in": "checkIn",
      "check-out": "checkOut",
      "star-min": "starMin",
      "star-max": "starMax",
      facility: "facilities",
      "price-min": "priceMin",
      "price-max": "priceMax",
      sort: "sortBy",
      page: "page",
      "page-size": "pageSize",
      currency: "currency",
    });
    assert.deepEqual(fieldsByFlag("hotels get"), {
      "with-rooms": "includeRooms",
    });
    assert.deepEqual(fieldsByFlag("hotels rates"), {
      hotel: "hotelIds",
      "check-in": "checkIn",
      "check-out": "checkOut",
      rooms: "rooms",
      adults: "adults",
      "child-age": "childrenAges",
      nationality: "nationality",
      board: "boardCodes",
      "free-cancellation": "freeCancellation",
      "include-unbookable": "bookableOnly",
      "max-rooms": "maxRoomsPerHotel",
      currency: "currency",
    });
    assert.deepEqual(fieldsByFlag("hotels book"), {
      hotel: "hotelId",
      "room-id": "roomId",
      "rate-plan": "ratePlanCode",
      "check-in": "checkIn",
      "check-out": "checkOut",
      rooms: "rooms",
      adults: "adults",
      "child-age": "childrenAges",
      guest: "guests",
      "contact-name": "contactName",
      "contact-phone": "contactPhone",
      "contact-email": "contactEmail",
      "special-requests": "specialRequests",
    });
  });

  it("repeats exactly the flags whose field is a list", () => {
    const repeated = COMMANDS.flatMap((spec) =>
      spec.flags.filter((flag) => flag.multiple).map((flag) => `${typed(spec)} ${flag.flag}`),
    );
    assert.deepEqual(repeated, [
      "hotels search facility",
      "hotels rates hotel",
      "hotels rates child-age",
      "hotels rates board",
      "hotels book child-age",
      "hotels book guest",
    ]);
  });

  it("gives one short flag, -q", () => {
    const shorts = COMMANDS.flatMap((spec) =>
      spec.flags.flatMap((flag) => (flag.short ? [`${flag.flag}:${flag.short}`] : [])),
    );
    assert.deepEqual(shorts, ["query:q"]);
  });

  it("spells flags in kebab case, once per command, one flag per field", () => {
    for (const spec of COMMANDS) {
      const flags = spec.flags.map((flag) => flag.flag);
      for (const flag of flags) {
        assert.match(flag, /^[a-z]+(-[a-z]+)*$/, `${typed(spec)} --${flag}`);
      }
      assert.equal(new Set(flags).size, flags.length, typed(spec));
      const fields = spec.flags.map((flag) => flag.field);
      assert.equal(new Set(fields).size, fields.length, typed(spec));
    }
  });

  it("every flag's field exists in its tool's input schema", () => {
    for (const spec of COMMANDS) {
      if (!spec.tool) {
        assert.deepEqual(spec.flags, [], `${typed(spec)} has no tool, so no flags`);
        continue;
      }
      const input = tool(spec.tool).input;
      if (!input) {
        assert.deepEqual(spec.flags, [], `${typed(spec)}'s tool takes no input`);
        continue;
      }
      const json = jsonOf(input);
      for (const flag of spec.flags) {
        assert.ok(
          fieldOf(json, flag.field),
          `${typed(spec)} --${flag.flag}: no field ${flag.field} in ${spec.tool}`,
        );
      }
      for (const positional of spec.positionals ?? []) {
        assert.ok(fieldOf(json, positional), `${typed(spec)} <${positional}>`);
      }
    }
  });

  it("resolves dotted fields through objects and lists", () => {
    const search = jsonOf(searchHotelsInput);
    assert.equal(fieldOf(search, "near.lat")?.description, "Latitude.");
    assert.equal(fieldOf(search, "near.nope"), undefined);
    assert.equal(fieldOf(search, "nope.lat"), undefined);
    const booking = jsonOf(createBookingInput);
    assert.equal(
      fieldOf(booking, "guests.roomNo")?.description,
      "Room the guest stays in, starting at 1.",
    );
  });

  it("every input field has a flag or a positional, so the CLI can send any valid request", () => {
    for (const spec of COMMANDS) {
      if (!spec.tool || !tool(spec.tool).input) continue;
      const json = jsonOf(inputOf(spec));
      const reachable = new Set([
        ...spec.flags.map((flag) => flag.field.split(".")[0]),
        ...(spec.positionals ?? []),
      ]);
      assert.deepEqual(
        Object.keys(json.properties ?? {}).filter((key) => !reachable.has(key)),
        [],
        typed(spec),
      );
    }
  });

  it("types each flag after its field", () => {
    // `near` ("lat,lng,km") and `guests` ("First Last[:roomNo]") are one
    // flag value that the CLI parses into an object.
    const composite = new Set(["hotels search near", "hotels book guest"]);
    for (const spec of COMMANDS) {
      if (!spec.flags.length) continue;
      const json = jsonOf(inputOf(spec));
      for (const flag of spec.flags) {
        const label = `${typed(spec)} --${flag.flag}`;
        const field = fieldOf(json, flag.field);
        assert.ok(field, label);
        assert.equal(Boolean(flag.multiple), field.type === "array", label);
        const item = field.type === "array" ? field.items : field;
        assert.ok(item, label);
        if (composite.has(`${typed(spec)} ${flag.flag}`)) {
          assert.equal(flag.type, "string", label);
          assert.equal(item.type, "object", label);
        } else if (flag.type === "id") {
          assert.equal(item.type, "integer", label);
          assert.equal(item.exclusiveMinimum, 0, label);
        } else if (flag.type === "number") {
          assert.ok(["number", "integer"].includes(item.type ?? ""), label);
        } else {
          assert.equal(item.type, flag.type, label);
        }
      }
    }
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

  it("a flag on an enum field lists the enum's values as its placeholder", () => {
    const listed: string[] = [];
    for (const spec of COMMANDS) {
      if (!spec.flags.length) continue;
      const json = jsonOf(inputOf(spec));
      for (const flag of spec.flags) {
        const field = fieldOf(json, flag.field);
        const item = field?.type === "array" ? field.items : field;
        const values = item?.enum as string[] | undefined;
        if (!values) continue;
        listed.push(`${typed(spec)} --${flag.flag}`);
        assert.equal(flag.placeholder, values.join("|"), `${typed(spec)} --${flag.flag}`);
      }
    }
    assert.deepEqual(listed, [
      "hotels search --sort",
      "hotels search --currency",
      "hotels rates --board",
      "hotels rates --currency",
    ]);
  });

  it("keeps the placeholders the CLI help has always shown", () => {
    const placeholders = (name: string) =>
      Object.fromEntries(
        command(name).flags.map((flag) => [flag.flag, flag.placeholder]),
      );
    const dates = { "check-in": "YYYY-MM-DD", "check-out": "YYYY-MM-DD" };
    assert.deepEqual(placeholders("hotels search"), {
      query: "<text>",
      "city-code": "<n>",
      near: "<lat,lng,km>",
      ...dates,
      "star-min": "<n>",
      "star-max": "<n>",
      facility: "<name>",
      "price-min": "<n>",
      "price-max": "<n>",
      sort: "recommended|price-asc|price-desc|star-desc|distance",
      page: "<n>",
      "page-size": "<n>",
      currency: "CNY|USD",
    });
    assert.deepEqual(placeholders("hotels rates"), {
      hotel: "<id>",
      ...dates,
      rooms: "<n>",
      adults: "<n>",
      "child-age": "<age>",
      nationality: "<CC>",
      board: "RO|BB|HB|FB|BL|BD|HBBL|HBLD|AI",
      "free-cancellation": undefined,
      "include-unbookable": undefined,
      "max-rooms": "<n>",
      currency: "CNY|USD",
    });
    assert.deepEqual(placeholders("hotels book"), {
      hotel: "<id>",
      "room-id": "<id>",
      "rate-plan": "<code>",
      ...dates,
      rooms: "<n>",
      adults: "<n>",
      "child-age": "<age>",
      guest: '"First Last[:roomNo]"',
      "contact-name": "<name>",
      "contact-phone": "<phone>",
      "contact-email": "<email>",
      "special-requests": "<english text>",
    });
    assert.deepEqual(placeholders("hotels get"), { "with-rooms": undefined });
  });

  // The CLI sends the HTTP schemas' requests, so its flags read from them
  // (rates differs from the MCP tool in the default rooms per hotel).
  const httpInputs = {
    "hotels search": searchHotelsInput,
    "hotels get": getHotelInput,
    "hotels rates": getRatesInput,
    "hotels book": createBookingInput,
  } as const;

  /** The flags whose wording is the CLI's own, not their field's. */
  const REWORDED = [
    "hotels search --query",
    "hotels search --near",
    "hotels rates --hotel",
    "hotels rates --adults",
    "hotels rates --include-unbookable",
    "hotels rates --max-rooms",
    "hotels book --room-id",
    "hotels book --rate-plan",
    "hotels book --rooms",
    "hotels book --adults",
    "hotels book --child-age",
    "hotels book --guest",
  ];

  it("a flag says what its field says, except where the CLI words it differently", () => {
    const reworded: string[] = [];
    for (const [name, schema] of Object.entries(httpInputs)) {
      const json = jsonOf(schema);
      for (const flag of command(name).flags) {
        const field = fieldOf(json, flag.field)?.description;
        assert.ok(field, `${name} --${flag.flag}: field has a description`);
        if (flag.description !== field) reworded.push(`${name} --${flag.flag}`);
      }
    }
    assert.deepEqual(reworded, REWORDED);
  });

  it("no flag description names an MCP tool", () => {
    const toolNames = new RegExp(TOOLS.map((spec) => spec.name).join("|"));
    for (const spec of COMMANDS) {
      for (const flag of spec.flags) {
        assert.doesNotMatch(
          flag.description,
          toolNames,
          `${typed(spec)} --${flag.flag}`,
        );
      }
    }
  });

  // `roomId` from `hotels rates`, not from `rates`: help names a command
  // as it is typed.
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
    assert.ok(named.includes("hotels rates"), "the walk found the commands named");
  });

  it("--max-rooms says the HTTP default, which the schema holds", () => {
    const fallback = jsonOf(getRatesInput).properties?.maxRoomsPerHotel?.default;
    assert.equal(fallback, 10);
    const flag = command("hotels rates").flags.find((f) => f.flag === "max-rooms");
    assert.ok(flag?.description.includes(`${fallback}`), flag?.description);
  });

  it("--include-unbookable is the one flag that switches its field off", () => {
    const flags = COMMANDS.flatMap((spec) =>
      spec.flags
        .filter((flag) => flag.type === "boolean")
        .map((flag) => ({ spec, flag })),
    );
    const defaultsOn = flags
      .filter(({ spec, flag }) => {
        const field = fieldOf(jsonOf(inputOf(spec)), flag.field);
        return field?.default === true;
      })
      .map(({ spec, flag }) => `${typed(spec)} --${flag.flag}`);
    assert.deepEqual(defaultsOn, ["hotels rates --include-unbookable"]);
    assert.deepEqual(
      flags.map(({ spec, flag }) => `${typed(spec)} --${flag.flag}`),
      [
        "hotels get --with-rooms",
        "hotels rates --free-cancellation",
        "hotels rates --include-unbookable",
      ],
    );
  });

  it("rates and book have no occupancy defaults", () => {
    for (const input of [
      getRatesInput,
      MCP_RATES_INPUT,
      createBookingInput,
    ]) {
      const json = jsonOf(input);
      for (const field of ["rooms", "adults"]) {
        assert.ok(json.required?.includes(field), `${field} is required`);
        assert.equal(json.properties?.[field]?.default, undefined, field);
      }
    }
    for (const name of ["hotels rates", "hotels book"]) {
      for (const flag of command(name).flags) {
        if (flag.field !== "rooms" && flag.field !== "adults") continue;
        assert.doesNotMatch(
          flag.description,
          /default/i,
          `${name} --${flag.flag}`,
        );
      }
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

  it("GLOBAL_FLAGS are --help and --version", () => {
    assert.deepEqual(
      GLOBAL_FLAGS.map((flag) => [flag.flag, flag.short, flag.type]),
      [
        ["help", "h", "boolean"],
        ["version", "v", "boolean"],
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
      "hotels rates": ["body"],
      "hotels book": ["body"],
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
      ...strings(BOOKING_NEXT_STEP),
    ];
    assert.ok(everything.length > 100, "the walk found the specs' text");
    assert.deepEqual(everything.filter((text) => SUPPLIER.test(text)), []);
  });
});
