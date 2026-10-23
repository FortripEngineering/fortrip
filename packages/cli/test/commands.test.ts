import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  addIsoDateDays,
  API,
  COMMANDS,
  commandInvocation,
  type CommandSpec,
  createBookingInput,
  type FlagSpec,
  getHotelInput,
  getRatesInput,
  SEARCH_SORTS,
  searchHotelsInput,
  TOOLS,
} from "@fortrip/agent-contract";
import { z } from "zod";

import { parseCommand, parseGuest, parseOptions } from "../src/commands.ts";
import { CliError, EXIT } from "../src/errors.ts";

function isUsage(error: unknown): boolean {
  return error instanceof CliError && error.exitCode === EXIT.usage;
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

function body(name: string, argv: string[], env = {}) {
  const parsed = parseCommand(command(name), argv, env);
  assert.ok(parsed.body, `${name} sends a body`);
  return parsed.body;
}

/** The value at a dotted field of a request body. */
function get(value: unknown, field: string): unknown {
  return field
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], value);
}

/** What a flag's field defaults to in its tool's input: `bookableOnly`
 *  defaults to true, so its flag sets it to false. */
function defaultOf(spec: CommandSpec, flag: FlagSpec): unknown {
  const input = TOOLS.find((tool) => tool.name === spec.tool)?.input;
  assert.ok(input, `${typed(spec)} has an input`);
  const json = z.toJSONSchema(input, { io: "input" }) as {
    properties?: Record<string, { default?: unknown }>;
  };
  return json.properties?.[flag.field]?.default;
}

/** Flags whose value the CLI reads further than the type says. */
const SPECIAL: Record<
  string,
  { args: (flag: string) => string[]; expected: unknown }
> = {
  near: {
    args: (flag) => [flag, "13.75, 100.5, 5"],
    expected: { lat: 13.75, lng: 100.5, radiusKm: 5 },
  },
  guests: {
    args: (flag) => [flag, "John Smith", flag, "Mary Ann Lee:2"],
    expected: [
      { firstName: "John", lastName: "Smith", roomNo: 1 },
      { firstName: "Mary Ann", lastName: "Lee", roomNo: 2 },
    ],
  },
  nationality: { args: (flag) => [flag, "cn"], expected: "CN" },
  currency: { args: (flag) => [flag, "usd"], expected: "USD" },
  boardCodes: {
    args: (flag) => [flag, "bb, hb", flag, "fb"],
    expected: ["BB", "HB", "FB"],
  },
  hotelIds: {
    args: (flag) => [flag, "266000,266001", flag, "3"],
    expected: [266000, 266001, 3],
  },
  childrenAges: {
    args: (flag) => [flag, "4,6", flag, "9"],
    expected: [4, 6, 9],
  },
};

/** The arguments that give `flag` a value, and the field value they mean. */
function sample(spec: CommandSpec, flag: FlagSpec, name: string) {
  const special = SPECIAL[flag.field];
  if (special) return { args: special.args(name), expected: special.expected };
  if (flag.type === "boolean") {
    return { args: [name], expected: defaultOf(spec, flag) === true ? false : true };
  }
  const [one, two] =
    flag.type === "string" ? ["text one", "text two"] : ["7", "8"];
  const convert = (value: string | undefined) =>
    flag.type === "string" ? value : Number(value);
  return flag.multiple
    ? { args: [name, one!, name, two!], expected: [convert(one), convert(two)] }
    : { args: [name, one!], expected: convert(one) };
}

/** Arguments that satisfy what a command needs besides the flag under test. */
function baseArgs(spec: CommandSpec): string[] {
  const needsOccupancy = ["rooms", "adults"].every((field) =>
    spec.flags.some((flag) => flag.field === field),
  );
  return [
    ...(spec.tool === "get_hotel" ? ["5"] : []),
    ...(needsOccupancy ? ["--body", '{"rooms":1,"adults":1}'] : []),
  ];
}

const API_COMMANDS = COMMANDS.filter((spec) => spec.group === "hotels");

describe("every COMMANDS flag parses into its field", () => {
  for (const spec of API_COMMANDS) {
    for (const flag of spec.flags) {
      const names: [string, string][] = [[`--${flag.flag}`, "long"]];
      if (flag.short) names.push([`-${flag.short}`, "short"]);
      for (const [name, kind] of names) {
        it(`${typed(spec)} ${name} (${kind}) → ${flag.field}`, () => {
          const { args, expected } = sample(spec, flag, name);
          const parsed = parseCommand(spec, [...baseArgs(spec), ...args], {});
          if (spec.tool === "get_hotel") {
            assert.equal(parsed.body, undefined);
            assert.equal(parsed.path, API.hotel(5, expected === true));
          } else {
            assert.deepEqual(get(parsed.body, flag.field), expected);
          }
        });
      }
    }
  }

  it("the table covers every flag of the hotels commands", () => {
    assert.deepEqual(API_COMMANDS.map(typed), [
      "hotels search",
      "hotels get",
      "hotels rates",
      "hotels book",
    ]);
    for (const spec of API_COMMANDS) assert.ok(spec.flags.length > 0, typed(spec));
  });

  it("only hotel ids, child ages and meal codes are comma lists", () => {
    // A facility name or a guest may hold a comma; a new multi-value flag
    // has to be placed in one group or the other here.
    const lists = new Set(["hotelIds", "childrenAges", "boardCodes"]);
    const asGiven = new Set(["facilities", "guests"]);
    for (const spec of API_COMMANDS) {
      for (const flag of spec.flags.filter((f) => f.multiple)) {
        assert.ok(lists.has(flag.field) || asGiven.has(flag.field), flag.field);
      }
    }
    assert.deepEqual(body("hotels search", ["--facility", "Pool, Gym"]).facilities, ["Pool, Gym"]);
  });
});

describe("endpoints come from the contract", () => {
  it("hotels search, rates and book post to their API paths", () => {
    assert.equal(parseCommand(command("hotels search"), ["-q", "Bangkok"], {}).path, API.search);
    assert.equal(
      parseCommand(command("hotels rates"), ["--hotel", "1", "--rooms", "1", "--adults", "2"], {})
        .path,
      API.rates,
    );
    assert.equal(
      parseCommand(command("hotels book"), ["--hotel", "1", "--rooms", "1", "--adults", "2"], {})
        .path,
      API.bookings,
    );
  });

  it("hotels get is a GET of API.hotel with or without the rooms", () => {
    for (const [argv, includeRooms] of [
      [["266000"], false],
      [["266000", "--with-rooms"], true],
      [["--with-rooms", "266000"], true],
    ] as const) {
      const parsed = parseCommand(command("hotels get"), [...argv], {});
      assert.equal(parsed.path, API.hotel(266000, includeRooms));
      assert.equal(parsed.body, undefined);
    }
  });

  it("hotels get needs exactly one numeric id", () => {
    for (const argv of [[], ["abc"], ["1", "2"], ["0x10"], ["1e3"], ["-1"], ["9007199254740993"]]) {
      assert.throws(() => parseCommand(command("hotels get"), argv, {}), isUsage, argv.join(" "));
    }
    assert.throws(
      () => parseCommand(command("hotels get"), [], {}),
      (error) =>
        isUsage(error) &&
        (error as Error).message === "Usage: fortrip hotels get <hotelId> [options]",
    );
    assert.equal(parseCommand(command("hotels get"), ["0012"], {}).path, API.hotel(12));
  });

  it("a command that sends no request has nothing to parse", () => {
    for (const name of ["login", "logout", "whoami", "guide", "mcp"]) {
      assert.throws(() => parseCommand(command(name), [], {}), /sends no request/);
    }
  });

  it("a usage error names the command as it is typed", () => {
    assert.throws(
      () => body("hotels search", ["Bangkok"]),
      (error) => isUsage(error) && /^fortrip hotels search takes no arguments/.test((error as Error).message),
    );
    assert.throws(
      () => body("hotels rates", ["--adults", "2"]),
      (error) => isUsage(error) && /^fortrip hotels rates needs --rooms,/.test((error as Error).message),
    );
  });
});

describe("hotels search", () => {
  it("maps flags onto the API body", () => {
    assert.deepEqual(
      body("hotels search", [
        "-q",
        "Bangkok",
        "--check-in",
        "2026-11-10",
        "--check-out",
        "2026-11-12",
        "--near",
        "13.7, 100.5, 5",
        "--facility",
        "Swimming pool",
        "--facility",
        "Parking",
        "--star-min",
        "4",
        "--sort",
        "price-asc",
      ]),
      {
        query: "Bangkok",
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
        near: { lat: 13.7, lng: 100.5, radiusKm: 5 },
        facilities: ["Swimming pool", "Parking"],
        starMin: 4,
        sortBy: "price-asc",
      },
    );
  });

  it("flags override --body fields; omitted flags keep them", () => {
    assert.deepEqual(
      body("hotels search", ["--body", '{"query":"Tokyo","pageSize":5}', "--query", "Osaka"]),
      { query: "Osaka", pageSize: 5 },
    );
  });

  it("--body @file reads the file", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "fortrip-body-")), "body.json");
    await writeFile(file, '{"query":"Tokyo","page":2}');
    assert.deepEqual(body("hotels search", ["--body", `@${file}`, "--page", "3"]), {
      query: "Tokyo",
      page: 3,
    });
    assert.throws(() => body("hotels search", ["--body", `@${file}.missing`]), isUsage);
  });

  it("rejects bad numbers, a bad --near and non-object bodies", () => {
    for (const argv of [
      ["--star-min", "four"],
      ["--star-min", ""],
      ["--near", "13.7,100.5"],
      ["--near", "13.7,100.5,5,6"],
      ["--near", "13.7,,5"],
      ["--near", "a,b,c"],
      ["--body", "[1,2]"],
      ["--body", "not json"],
    ]) {
      assert.throws(() => body("hotels search", argv), isUsage, argv.join(" "));
    }
  });

  it("unknown flags and stray arguments are usage errors", () => {
    for (const argv of [["--nope"], ["Bangkok"], ["--with-rooms"]]) {
      assert.throws(() => body("hotels search", argv), isUsage, argv.join(" "));
    }
  });

  it("a single-value flag given twice is a usage error", () => {
    for (const argv of [
      ["--query", "Bangkok", "--query", "Phuket"],
      ["-q", "Bangkok", "--query", "Phuket"],
      ["--city-code", "1", "--city-code=2"],
    ]) {
      assert.throws(() => body("hotels search", argv), isUsage, argv.join(" "));
    }
    assert.deepEqual(body("hotels search", ["--facility", "Parking", "--facility", "Gym"]).facilities, [
      "Parking",
      "Gym",
    ]);
  });

  it("--city-code takes digits only", () => {
    for (const code of ["0x10", "1e3", "12.0", "-1", ""]) {
      assert.throws(() => body("hotels search", [`--city-code=${code}`]), isUsage, code);
    }
    assert.equal(body("hotels search", ["--city-code", "0012"]).cityCode, 12);
  });
});

describe("hotels rates", () => {
  const STAY = ["--rooms", "1", "--adults", "2"];

  it("accepts repeated or comma-separated ids, and reads the rest as given", () => {
    assert.deepEqual(
      body("hotels rates", [
        "--hotel",
        "266000,266001",
        "--hotel",
        "3",
        "--check-in",
        "2026-11-10",
        "--check-out",
        "2026-11-12",
        ...STAY,
        "--board",
        "bb,hb",
        "--free-cancellation",
        "--include-unbookable",
        "--nationality",
        "cn",
      ]),
      {
        hotelIds: [266000, 266001, 3],
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
        rooms: 1,
        adults: 2,
        nationality: "CN",
        boardCodes: ["BB", "HB"],
        freeCancellation: true,
        bookableOnly: false,
      },
    );
  });

  it("--include-unbookable is the only way bookableOnly is sent", () => {
    assert.equal("bookableOnly" in body("hotels rates", STAY), false);
  });

  it("hotel ids are digits only", () => {
    for (const ids of ["0x10", "266000,1e3", "266000,", "9007199254740993"]) {
      assert.throws(() => body("hotels rates", ["--hotel", ids, ...STAY]), isUsage, ids);
    }
  });

  it("has no occupancy defaults: --rooms and --adults are required", () => {
    for (const argv of [
      [],
      ["--rooms", "2"],
      ["--adults", "2"],
      ["--body", '{"rooms":2}'],
      ["--hotel", "1", "--check-in", "2026-11-10"],
    ]) {
      assert.throws(
        () => body("hotels rates", argv),
        (error) => isUsage(error) && /--rooms|--adults/.test((error as Error).message),
        argv.join(" "),
      );
    }
  });

  it("takes rooms and adults from --body, and flags override them", () => {
    const fromBody = body("hotels rates", ["--body", '{"rooms":2,"adults":3}']);
    assert.equal(fromBody.rooms, 2);
    assert.equal(fromBody.adults, 3);
    const overridden = body("hotels rates", ["--body", '{"rooms":2,"adults":3}', "--adults", "1"]);
    assert.equal(overridden.rooms, 2);
    assert.equal(overridden.adults, 1);
  });
});

describe("hotels book", () => {
  it("parses guests: last word is the last name, optional :roomNo", () => {
    assert.deepEqual(parseGuest("John Smith"), {
      firstName: "John",
      lastName: "Smith",
      roomNo: 1,
    });
    assert.deepEqual(parseGuest("Mary Ann Lee:2"), {
      firstName: "Mary Ann",
      lastName: "Lee",
      roomNo: 2,
    });
    for (const bad of ["Cher", "Cher:2", ""]) {
      assert.throws(() => parseGuest(bad), isUsage, bad);
    }
  });

  it("maps flags onto the bookings body", () => {
    assert.deepEqual(
      body("hotels book", [
        "--hotel",
        "266000",
        "--room-id",
        "9191658",
        "--rate-plan",
        "rp_1",
        "--check-in",
        "2026-11-10",
        "--check-out",
        "2026-11-12",
        "--rooms",
        "1",
        "--adults",
        "2",
        "--guest",
        "John Smith",
        "--contact-name",
        "John Smith",
        "--contact-phone",
        "+8613800000000",
      ]),
      {
        hotelId: 266000,
        roomId: "9191658",
        ratePlanCode: "rp_1",
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
        rooms: 1,
        adults: 2,
        guests: [{ firstName: "John", lastName: "Smith", roomNo: 1 }],
        contactName: "John Smith",
        contactPhone: "+8613800000000",
      },
    );
  });

  it("requires --rooms and --adults, from flags or --body", () => {
    for (const argv of [
      [],
      ["--rooms", "2"],
      ["--adults", "2"],
      ["--body", '{"rooms":2}'],
    ]) {
      assert.throws(() => body("hotels book", argv), isUsage, argv.join(" "));
    }
    const merged = body("hotels book", ["--body", '{"rooms":2,"adults":3}', "--adults", "2"]);
    assert.equal(merged.rooms, 2);
    assert.equal(merged.adults, 2);
  });

  it("--hotel takes digits only, and once", () => {
    const stay = ["--rooms", "1", "--adults", "2"];
    assert.throws(() => body("hotels book", ["--hotel", "0x10", ...stay]), isUsage);
    assert.throws(() => body("hotels book", ["--hotel", "1", "--hotel", "2", ...stay]), isUsage);
    assert.throws(() => body("hotels book", ["--rooms", "1", "--rooms", "2", "--adults", "2"]), isUsage);
    assert.equal(body("hotels book", ["--hotel", "0012", ...stay]).hotelId, 12);
  });

  it("never takes a currency: it charges the one it returns", () => {
    const stay = ["--rooms", "1", "--adults", "2"];
    assert.equal("currency" in body("hotels book", stay, { FORTRIP_CURRENCY: "USD" }), false);
    assert.throws(() => body("hotels book", [...stay, "--currency", "USD"]), isUsage);
  });
});

describe("currency", () => {
  const env = { FORTRIP_CURRENCY: " usd " };
  const stay = ["--rooms", "1", "--adults", "2"];

  it("--currency beats --body, which beats FORTRIP_CURRENCY", () => {
    assert.equal(body("hotels rates", [...stay, "--currency", "cny"], env).currency, "CNY");
    assert.equal(body("hotels search", ["--body", '{"currency":"CNY"}'], env).currency, "CNY");
    assert.equal(body("hotels search", [], env).currency, "USD");
    assert.equal(
      body("hotels search", ["--body", '{"currency":"CNY"}', "--currency", "usd"]).currency,
      "USD",
    );
  });

  it("rejects a blank --currency instead of falling back", () => {
    for (const blank of ["", "  "]) {
      assert.throws(() => body("hotels rates", [...stay, "--currency", blank], env), isUsage);
      assert.throws(() => body("hotels search", ["--currency", blank], env), isUsage);
    }
  });

  it("is left to the API default when nothing sets it", () => {
    assert.equal("currency" in body("hotels rates", stay, {}), false);
    assert.equal("currency" in body("hotels search", [], { FORTRIP_CURRENCY: " " }), false);
  });
});

describe("fields", () => {
  const DOTTED: CommandSpec = {
    group: "hotels",
    name: "search",
    summary: "",
    tool: "search_hotels",
    flags: [
      { flag: "lat", field: "near.lat", type: "number", placeholder: "<n>", description: "" },
      { flag: "lng", field: "near.lng", type: "number", placeholder: "<n>", description: "" },
    ],
    options: [{ flag: "body", type: "string", description: "" }],
  };

  it("a dotted field steps into an object, keeping what --body put there", () => {
    assert.deepEqual(
      parseCommand(DOTTED, ["--lat", "1", "--lng", "2", "--body", '{"near":{"radiusKm":5}}'], {})
        .body,
      { near: { radiusKm: 5, lat: 1, lng: 2 } },
    );
    assert.deepEqual(parseCommand(DOTTED, ["--lat", "1"], {}).body, { near: { lat: 1 } });
  });

  it("a flag whose parent in --body is not an object replaces it", () => {
    assert.deepEqual(
      parseCommand(DOTTED, ["--lat", "1", "--body", '{"near":"here"}'], {}).body,
      { near: { lat: 1 } },
    );
  });
});

describe("parseOptions", () => {
  it("reads a command's options and positionals from its spec", () => {
    const login = parseOptions(command("login"), ["--no-browser"]);
    assert.equal(login.values["no-browser"], true);
    assert.equal(parseOptions(command("login"), []).values["no-browser"], undefined);
    assert.deepEqual(parseOptions(command("guide"), ["planning"]).positionals, ["planning"]);
  });

  it("refuses what the spec doesn't declare", () => {
    for (const [name, argv] of [
      ["login", ["--browser"]],
      ["logout", ["--no-browser"]],
      ["whoami", ["now"]],
      ["guide", ["--topic", "x"]],
    ] as const) {
      assert.throws(() => parseOptions(command(name), [...argv]), isUsage, `${name} ${argv}`);
    }
  });
});

describe("a full command line builds the request the contract accepts", () => {
  // Search refuses a check-in in the past, so the dates follow the clock.
  const today = new Date().toISOString().slice(0, 10);
  const STAY = ["--check-in", addIsoDateDays(today, 30), "--check-out", addIsoDateDays(today, 32)];

  /** Every flag of the command is in `argv`, so a flag added to the contract
   *  without a case here fails this test. */
  function assertFull(spec: CommandSpec, argv: string[]) {
    for (const flag of spec.flags) {
      assert.ok(argv.includes(`--${flag.flag}`), `${typed(spec)}: no case for --${flag.flag}`);
    }
  }

  /** The body is exactly what the schema accepts, and says what was typed. */
  function assertAccepted(
    schema: { safeParse(input: unknown): { success: boolean; data?: unknown; error?: unknown } },
    sent: Record<string, unknown>,
  ) {
    const parsed = schema.safeParse(sent);
    assert.ok(parsed.success, JSON.stringify(parsed.error));
    for (const [field, value] of Object.entries(sent)) {
      assert.deepEqual((parsed.data as Record<string, unknown>)[field], value, field);
    }
  }

  it("hotels search", () => {
    const spec = command("hotels search");
    const argv = [
      ...["--query", "Bangkok", "--city-code", "1234", "--near", "13.75,100.5,5"],
      ...STAY,
      ...["--star-min", "3", "--star-max", "5", "--facility", "Parking", "--facility", "Swimming pool"],
      ...["--price-min", "50", "--price-max", "500", "--sort", SEARCH_SORTS[0] as string],
      ...["--page", "2", "--page-size", "10", "--currency", "usd"],
    ];
    assertFull(spec, argv);
    assertAccepted(searchHotelsInput, body("hotels search", argv));
  });

  it("hotels get", () => {
    const spec = command("hotels get");
    const argv = ["266000", "--with-rooms"];
    assertFull(spec, argv);
    // The GET carries the id in its path and the flag in its query.
    for (const [args, includeRooms] of [
      [argv, true],
      [["266000"], false],
    ] as const) {
      const { path, body: sent } = parseCommand(spec, [...args], {});
      assert.equal(sent, undefined);
      const url = new URL(path, "https://fortrip.test");
      assert.equal(path, API.hotel(266000, includeRooms));
      const parsed = getHotelInput.safeParse({
        hotelId: url.pathname.split("/").pop(),
        ...(url.searchParams.get("include") === "rooms" ? { includeRooms: true } : {}),
      });
      assert.ok(parsed.success, JSON.stringify(parsed.error));
      assert.equal(parsed.data.hotelId, 266000);
      assert.equal(parsed.data.includeRooms ?? false, includeRooms);
    }
  });

  it("hotels rates", () => {
    const spec = command("hotels rates");
    const argv = [
      ...["--hotel", "266000,266001", "--hotel", "3"],
      ...STAY,
      ...["--rooms", "2", "--adults", "2", "--child-age", "4,6", "--child-age", "9"],
      ...["--nationality", "cn", "--board", "bb,hb", "--board", "fb", "--free-cancellation"],
      ...["--include-unbookable", "--max-rooms", "3", "--currency", "usd"],
    ];
    assertFull(spec, argv);
    const sent = body("hotels rates", argv);
    assertAccepted(getRatesInput, sent);
    // The inverted flag reaches the schema as false, not as its default.
    assert.equal(sent.bookableOnly, false);
  });

  it("hotels book", () => {
    const spec = command("hotels book");
    const argv = [
      ...["--hotel", "266000", "--room-id", "9191658", "--rate-plan", "rp_1"],
      ...STAY,
      ...["--rooms", "2", "--adults", "2", "--child-age", "7"],
      ...["--guest", "John Smith", "--guest", "Mary Ann Lee:2"],
      ...["--contact-name", "John Smith", "--contact-phone", "+8613800000000"],
      ...["--contact-email", "john@example.com", "--special-requests", "Late arrival"],
    ];
    assertFull(spec, argv);
    assertAccepted(createBookingInput, body("hotels book", argv));
  });
});
