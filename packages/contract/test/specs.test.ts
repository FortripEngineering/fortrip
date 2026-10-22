import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import {
  COMMANDS,
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

function command(name: CommandSpec["name"]): CommandSpec {
  const found = COMMANDS.find((spec) => spec.name === name);
  assert.ok(found, name);
  return found;
}

/** The input a command's tool takes; throws for a command without one. */
function inputOf(spec: CommandSpec): z.ZodType {
  assert.ok(spec.tool, `${spec.name} has no tool`);
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
        "get_rates",
        "create_booking",
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
    assert.equal(tool("get_rates").input, MCP_RATES_INPUT);
    assert.equal(tool("create_booking").input, createBookingInput);
  });

  it("only create_booking has an output schema", () => {
    for (const spec of TOOLS) {
      assert.equal(
        spec.output,
        spec.name === "create_booking" ? MCP_BOOKING_RESULT : null,
        spec.name,
      );
    }
  });

  it("states all four hints on every tool, and only create_booking writes", () => {
    for (const spec of TOOLS) {
      assert.deepEqual(
        Object.keys(spec.annotations).sort(),
        ["destructiveHint", "idempotentHint", "openWorldHint", "readOnlyHint"],
        spec.name,
      );
      assert.equal(spec.annotations.destructiveHint, false, spec.name);
      assert.equal(
        spec.annotations.readOnlyHint,
        spec.name !== "create_booking",
        spec.name,
      );
    }
    assert.equal(tool("create_booking").annotations.idempotentHint, true);
    assert.equal(tool("create_booking").annotations.openWorldHint, true);
    assert.equal(tool("get_planning_guide").annotations.openWorldHint, false);
    for (const name of ["search_hotels", "get_hotel", "get_rates"] as const) {
      assert.equal(tool(name).annotations.openWorldHint, true, name);
    }
  });

  it("get_rates names the hotel limit and the MCP room default from the code", () => {
    const { description } = tool("get_rates");
    assert.ok(
      description.includes(`up to ${LIMITS.ratesHotels} hotels`),
      description,
    );
    assert.ok(description.includes("Returns the 5 cheapest rooms"), description);
  });

  it("get_rates explains every board code", () => {
    const { description } = tool("get_rates");
    for (const code of BOARD_CODES) {
      assert.match(description, new RegExp(`\\b${code}\\b`), code);
    }
  });

  it("create_booking sends changes to the support address", () => {
    assert.ok(tool("create_booking").description.includes(SUPPORT_EMAIL));
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

describe("COMMANDS", () => {
  it("lists the nine commands", () => {
    assert.deepEqual(
      COMMANDS.map((spec) => spec.name),
      [
        "search",
        "hotel",
        "rates",
        "book",
        "login",
        "logout",
        "whoami",
        "guide",
        "mcp",
      ],
    );
  });

  it("gives every command a summary and the tool it mirrors", () => {
    const tools = {
      search: "search_hotels",
      hotel: "get_hotel",
      rates: "get_rates",
      book: "create_booking",
      login: null,
      logout: null,
      whoami: null,
      guide: "get_planning_guide",
      mcp: null,
    };
    for (const spec of COMMANDS) {
      assert.ok(spec.summary.trim(), `${spec.name} summary`);
      assert.equal(spec.tool, tools[spec.name], spec.name);
    }
  });

  it("pins the flags the CLI has always had", () => {
    const names = (name: CommandSpec["name"]) =>
      command(name).flags.map((spec) => spec.flag);
    assert.deepEqual(names("search"), [
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
    assert.deepEqual(names("hotel"), ["with-rooms"]);
    assert.deepEqual(names("rates"), [
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
    assert.deepEqual(names("book"), [
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
    assert.deepEqual(command("hotel").positionals, ["hotelId"]);
    assert.deepEqual(command("guide").positionals, ["topic"]);
  });

  // Written out by hand, not read from COMMANDS: the CLI builds each request
  // body from these pairs, so swapping two (check-in and check-out) would send
  // a different request while every other test still passed.
  it("pins every flag to its field", () => {
    const fieldsByFlag = (name: CommandSpec["name"]) =>
      Object.fromEntries(
        command(name).flags.map((flag) => [flag.flag, flag.field]),
      );
    assert.deepEqual(fieldsByFlag("search"), {
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
    assert.deepEqual(fieldsByFlag("hotel"), {
      "with-rooms": "includeRooms",
    });
    assert.deepEqual(fieldsByFlag("rates"), {
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
    assert.deepEqual(fieldsByFlag("book"), {
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
      spec.flags.filter((flag) => flag.multiple).map((flag) => `${spec.name} ${flag.flag}`),
    );
    assert.deepEqual(repeated, [
      "search facility",
      "rates hotel",
      "rates child-age",
      "rates board",
      "book child-age",
      "book guest",
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
        assert.match(flag, /^[a-z]+(-[a-z]+)*$/, `${spec.name} --${flag}`);
      }
      assert.equal(new Set(flags).size, flags.length, spec.name);
      const fields = spec.flags.map((flag) => flag.field);
      assert.equal(new Set(fields).size, fields.length, spec.name);
    }
  });

  it("every flag's field exists in its tool's input schema", () => {
    for (const spec of COMMANDS) {
      if (!spec.tool) {
        assert.deepEqual(spec.flags, [], `${spec.name} has no tool, so no flags`);
        continue;
      }
      const input = tool(spec.tool).input;
      if (!input) {
        assert.deepEqual(spec.flags, [], `${spec.name}'s tool takes no input`);
        continue;
      }
      const json = jsonOf(input);
      for (const flag of spec.flags) {
        assert.ok(
          fieldOf(json, flag.field),
          `${spec.name} --${flag.flag}: no field ${flag.field} in ${spec.tool}`,
        );
      }
      for (const positional of spec.positionals ?? []) {
        assert.ok(fieldOf(json, positional), `${spec.name} <${positional}>`);
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
        spec.name,
      );
    }
  });

  it("types each flag after its field", () => {
    // `near` ("lat,lng,km") and `guests` ("First Last[:roomNo]") are one
    // flag value that the CLI parses into an object.
    const composite = new Set(["search near", "book guest"]);
    for (const spec of COMMANDS) {
      if (!spec.flags.length) continue;
      const json = jsonOf(inputOf(spec));
      for (const flag of spec.flags) {
        const label = `${spec.name} --${flag.flag}`;
        const field = fieldOf(json, flag.field);
        assert.ok(field, label);
        assert.equal(Boolean(flag.multiple), field.type === "array", label);
        const item = field.type === "array" ? field.items : field;
        assert.ok(item, label);
        if (composite.has(`${spec.name} ${flag.flag}`)) {
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
        assert.ok(flag.description.trim(), `${spec.name} --${flag.flag}`);
      }
    }
  });

  it("every non-boolean flag has a placeholder, and a boolean flag has none", () => {
    for (const spec of COMMANDS) {
      for (const flag of spec.flags) {
        const label = `${spec.name} --${flag.flag}`;
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
        listed.push(`${spec.name} --${flag.flag}`);
        assert.equal(flag.placeholder, values.join("|"), `${spec.name} --${flag.flag}`);
      }
    }
    assert.deepEqual(listed, [
      "search --sort",
      "search --currency",
      "rates --board",
      "rates --currency",
    ]);
  });

  it("keeps the placeholders the CLI help has always shown", () => {
    const placeholders = (name: CommandSpec["name"]) =>
      Object.fromEntries(
        command(name).flags.map((flag) => [flag.flag, flag.placeholder]),
      );
    const dates = { "check-in": "YYYY-MM-DD", "check-out": "YYYY-MM-DD" };
    assert.deepEqual(placeholders("search"), {
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
    assert.deepEqual(placeholders("rates"), {
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
    assert.deepEqual(placeholders("book"), {
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
    assert.deepEqual(placeholders("hotel"), { "with-rooms": undefined });
  });

  // The CLI sends the HTTP schemas' requests, so its flags read from them
  // (rates differs from the MCP tool in the default rooms per hotel).
  const httpInputs = {
    search: searchHotelsInput,
    hotel: getHotelInput,
    rates: getRatesInput,
    book: createBookingInput,
  } as const;

  /** The flags whose wording is the CLI's own, not their field's. */
  const REWORDED = [
    "search --query",
    "search --near",
    "rates --hotel",
    "rates --adults",
    "rates --include-unbookable",
    "rates --max-rooms",
    "book --room-id",
    "book --rate-plan",
    "book --rooms",
    "book --adults",
    "book --child-age",
    "book --guest",
  ];

  it("a flag says what its field says, except where the CLI words it differently", () => {
    const reworded: string[] = [];
    for (const [name, schema] of Object.entries(httpInputs)) {
      const json = jsonOf(schema);
      for (const flag of command(name as CommandSpec["name"]).flags) {
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
          `${spec.name} --${flag.flag}`,
        );
      }
    }
  });

  it("--max-rooms says the HTTP default, which the schema holds", () => {
    const fallback = jsonOf(getRatesInput).properties?.maxRoomsPerHotel?.default;
    assert.equal(fallback, 10);
    const flag = command("rates").flags.find((f) => f.flag === "max-rooms");
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
      .map(({ spec, flag }) => `${spec.name} --${flag.flag}`);
    assert.deepEqual(defaultsOn, ["rates --include-unbookable"]);
    assert.deepEqual(
      flags.map(({ spec, flag }) => `${spec.name} --${flag.flag}`),
      ["hotel --with-rooms", "rates --free-cancellation", "rates --include-unbookable"],
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
    for (const name of ["rates", "book"] as const) {
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
      COMMANDS.map((spec) => [spec.name, all(spec.options ?? [])]),
    );
    assert.deepEqual(options, {
      search: ["body"],
      hotel: [],
      rates: ["body"],
      book: ["body"],
      login: ["no-browser"],
      logout: [],
      whoami: [],
      guide: [],
      mcp: [],
    });
    assert.equal(command("login").options?.[0]?.type, "boolean");
    assert.equal(command("search").options?.[0]?.type, "string");
  });

  it("describes every option and collides with no flag", () => {
    for (const spec of COMMANDS) {
      const taken = new Set<string>([
        ...spec.flags.map((flag: FlagSpec) => flag.flag),
        ...all(GLOBAL_FLAGS),
      ]);
      for (const option of [...(spec.options ?? []), ...GLOBAL_FLAGS]) {
        assert.ok(option.description.trim(), `${spec.name} --${option.flag}`);
      }
      for (const option of spec.options ?? []) {
        assert.equal(taken.has(option.flag), false, `${spec.name} --${option.flag}`);
      }
    }
  });

  it("every option that takes a value has a placeholder", () => {
    for (const spec of COMMANDS) {
      for (const option of [...(spec.options ?? []), ...GLOBAL_FLAGS]) {
        const label = `${spec.name} --${option.flag}`;
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
      ...strings(GLOBAL_FLAGS),
      ...strings(BOOKING_NEXT_STEP),
    ];
    assert.ok(everything.length > 100, "the walk found the specs' text");
    assert.deepEqual(everything.filter((text) => SUPPLIER.test(text)), []);
  });
});
