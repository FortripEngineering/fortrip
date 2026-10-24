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
  LIMITS,
  TOOLS,
} from "@fortrip/agent-contract";

import { parseCommand, parseOptions } from "../src/commands.ts";
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

const parse = (name: string, argv: string[], env: NodeJS.ProcessEnv = {}) =>
  parseCommand(command(name), argv, env);

function body(name: string, argv: string[], env: NodeJS.ProcessEnv = {}) {
  const parsed = parse(name, argv, env);
  assert.ok(parsed.body, `${name} sends a body`);
  return parsed.body;
}

/** The contract's input of the tool a command mirrors. */
function inputOf(spec: CommandSpec) {
  const input = TOOLS.find((tool) => tool.name === spec.tool)?.input;
  assert.ok(input, `${typed(spec)} has an input`);
  return input;
}

/** The issues of a request the CLI refused to send. */
function issuesOf(fn: () => unknown): { pointer: string; message: string }[] {
  try {
    fn();
  } catch (error) {
    assert.ok(isUsage(error), String(error));
    const details = (error as CliError).details.details as
      | { issues: { pointer: string; message: string }[] }
      | undefined;
    assert.ok(details, "the error carries issues");
    return details.issues;
  }
  assert.fail("expected a usage error");
}

// Search refuses a check-in in the past, so the dates follow the clock.
const today = new Date().toISOString().slice(0, 10);
const CHECK_IN = addIsoDateDays(today, 30);
const CHECK_OUT = addIsoDateDays(today, 32);
const STAY = ["--check-in", CHECK_IN, "--check-out", CHECK_OUT];

const HOTEL = `htl_${"a1".repeat(10)}`;
const HOTEL_2 = `htl_${"b2".repeat(10)}`;
const OFFER = `off_${"c3".repeat(10)}`;
const ORDER = `ord_${"d4".repeat(10)}`;
const PLACE = "plc_1850147";

const CONTACT = [
  ...["--first-name", "John", "--last-name", "Smith"],
  ...["--email", "john@example.com", "--phone", "+8613800000000"],
];

/**
 * A full command line for every command that sends a request, and the
 * request it must build. Every flag of the command appears in at least one
 * case, so a flag added to the contract without a case here fails.
 */
const CASES: {
  name: string;
  argv: string[];
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}[] = [
  {
    name: "hotels search",
    argv: [
      ...["--place-name", "Bangkok", "--country", "th", "--radius-meters", "5000"],
      ...["--text", "Riverside", ...STAY, "--room", "2:6,9", "--room", "1"],
      ...["--pricing", "indicative", "--stars-min", "4", "--stars-max", "5"],
      ...["--amenity", "pool", "--amenity", "wifi", "--price-max-per-room-night", "149.50"],
      ...["--sort", "price_asc", "--limit", "10", "--locale", "en", "--display-currency", "cny"],
    ],
    method: "POST",
    path: API.hotelSearch,
    body: {
      destination: { kind: "place_name", name: "Bangkok", countryCode: "TH", radiusMeters: 5000 },
      text: "Riverside",
      stay: {
        checkIn: CHECK_IN,
        checkOut: CHECK_OUT,
        rooms: [
          { adults: 2, childrenAges: [6, 9] },
          { adults: 1, childrenAges: [] },
        ],
      },
      pricing: "indicative",
      filters: {
        stars: { min: 4, max: 5 },
        amenities: ["pool", "wifi"],
        price: { maxPerRoomNight: { amount: "149.50", currency: "USD" } },
      },
      sort: "price_asc",
      limit: 10,
      locale: "en",
      displayCurrency: "CNY",
    },
  },
  {
    name: "hotels search",
    argv: ["--place", PLACE],
    method: "POST",
    path: API.hotelSearch,
    body: { destination: { kind: "place", placeId: PLACE } },
  },
  {
    name: "hotels search",
    argv: ["--locality", PLACE, "--sort", "distance"],
    method: "POST",
    path: API.hotelSearch,
    body: { destination: { kind: "locality", placeId: PLACE }, sort: "distance" },
  },
  {
    name: "hotels search",
    argv: ["--point", "13.75, -100.5", "--radius-meters", "2000"],
    method: "POST",
    path: API.hotelSearch,
    body: { destination: { kind: "point", location: { lat: 13.75, lng: -100.5 }, radiusMeters: 2000 } },
  },
  {
    name: "hotels search",
    argv: ["--country-only", "mv"],
    method: "POST",
    path: API.hotelSearch,
    body: { destination: { kind: "country", countryCode: "MV" } },
  },
  {
    name: "hotels search",
    argv: ["--cursor", "abc.def", "--limit", "5"],
    method: "POST",
    path: API.hotelSearch,
    body: { cursor: "abc.def", limit: 5 },
  },
  {
    name: "hotels get",
    argv: [HOTEL],
    method: "GET",
    path: `/v1/hotels/${HOTEL}`,
  },
  {
    name: "hotels get",
    argv: [HOTEL, "--rooms", "--locale", "zh"],
    method: "GET",
    path: `/v1/hotels/${HOTEL}?include=rooms&locale=zh`,
  },
  {
    name: "hotels offers",
    argv: [
      ...["--hotel", HOTEL, "--hotel", HOTEL_2, ...STAY, "--room", "2:6", "--room", "2:6"],
      ...["--require-breakfast", "--require-free-cancellation", "--limit-per-hotel", "3"],
      ...["--locale", "en", "--display-currency", "usd"],
    ],
    method: "POST",
    path: API.hotelOffers,
    body: {
      hotelIds: [HOTEL, HOTEL_2],
      stay: {
        checkIn: CHECK_IN,
        checkOut: CHECK_OUT,
        rooms: [
          { adults: 2, childrenAges: [6] },
          { adults: 2, childrenAges: [6] },
        ],
      },
      filters: { requireBreakfast: true, requireFreeCancellation: true },
      limitPerHotel: 3,
      locale: "en",
      displayCurrency: "USD",
    },
  },
  {
    name: "hotels book",
    argv: [
      ...["--offer", OFFER, "--guest", "1:John:Smith", "--guest", "2:Mary Ann:Lee"],
      ...["--guest", "1:Jane:Smith", ...CONTACT, "--special-requests", "Late arrival"],
    ],
    method: "POST",
    path: API.orders,
    body: {
      items: [
        {
          offerId: OFFER,
          hotel: {
            rooms: [
              {
                guests: [
                  { firstName: "John", lastName: "Smith" },
                  { firstName: "Jane", lastName: "Smith" },
                ],
              },
              { guests: [{ firstName: "Mary Ann", lastName: "Lee" }] },
            ],
            specialRequests: "Late arrival",
          },
        },
      ],
      contact: {
        firstName: "John",
        lastName: "Smith",
        email: "john@example.com",
        phone: "+8613800000000",
      },
    },
  },
  {
    name: "orders get",
    argv: [ORDER, "--locale", "zh"],
    method: "GET",
    path: `/v1/orders/${ORDER}?locale=zh`,
  },
  {
    name: "orders get",
    argv: [ORDER],
    method: "GET",
    path: `/v1/orders/${ORDER}`,
  },
  {
    name: "orders list",
    argv: ["--cursor", "a b/c", "--limit", "5", "--locale", "en"],
    method: "GET",
    path: "/v1/orders?cursor=a+b%2Fc&limit=5&locale=en",
  },
  {
    name: "orders list",
    argv: [],
    method: "GET",
    path: "/v1/orders",
  },
];

const SENDING = COMMANDS.filter((spec) => spec.group !== null);

describe("every command builds the request the contract accepts", () => {
  for (const { name, argv, method, path, body: expected } of CASES) {
    it(`${name} ${argv.join(" ")}`, () => {
      const request = parse(name, argv);
      assert.equal(request.method, method);
      assert.equal(request.path, path);
      assert.deepEqual(request.body, expected);
      if (expected) {
        const parsed = inputOf(command(name)).safeParse(expected);
        assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
      }
    });
  }

  it("the cases cover every command that sends a request, and every flag", () => {
    assert.deepEqual(SENDING.map(typed), [
      "hotels search",
      "hotels get",
      "hotels offers",
      "hotels book",
      "orders get",
      "orders list",
    ]);
    for (const spec of SENDING) {
      const argvs = CASES.filter((c) => c.name === typed(spec)).map((c) => c.argv);
      assert.ok(argvs.length > 0, typed(spec));
      for (const flag of spec.flags) {
        assert.ok(
          argvs.some((argv) => argv.includes(`--${flag.flag}`)),
          `${typed(spec)}: no case for --${flag.flag}`,
        );
      }
    }
  });

  it("paths come from the contract", () => {
    assert.equal(parse("hotels get", [HOTEL, "--rooms"]).path, API.hotel(HOTEL, { rooms: true }));
    assert.equal(parse("orders get", [ORDER]).path, API.order(ORDER));
    assert.ok(parse("orders list", []).path.startsWith(API.orders));
  });

  it("a command that sends no request has nothing to parse", () => {
    for (const name of ["login", "logout", "whoami", "guide", "mcp"]) {
      assert.throws(() => parse(name, []), /sends no request/);
    }
  });
});

describe("a request the contract refuses is not sent", () => {
  it("exits 2 with each bad field as an invalid_request issue", () => {
    const issues = issuesOf(() =>
      parse("hotels offers", ["--hotel", "266000", ...STAY, "--room", "2", "--limit-per-hotel", "99"]),
    );
    assert.deepEqual(
      issues.map((issue) => issue.pointer),
      ["/hotelIds/0", "/limitPerHotel"],
    );
    assert.match(issues[0]?.message ?? "", /htl_/);
  });

  it("the error lists the issues as the API's invalid_request would", () => {
    try {
      parse("hotels search", []);
      assert.fail("expected a usage error");
    } catch (error) {
      assert.ok(isUsage(error));
      assert.equal((error as Error).message, "Not sent: fortrip hotels search was given an invalid request.");
      assert.equal((error as CliError).envelope, undefined);
      assert.deepEqual((error as CliError).details, {
        details: { issues: [{ pointer: "/destination", message: "Provide a destination or text" }] },
      });
    }
  });

  it("a --body field the input doesn't take is refused, one issue per field", () => {
    const issues = issuesOf(() =>
      parse("hotels book", [
        "--body",
        '{"nationality":"CN","currency":"USD"}',
        ...["--offer", OFFER, "--guest", "1:A:B", ...CONTACT],
      ]),
    );
    assert.deepEqual(issues, [
      { pointer: "/nationality", message: "Unknown field: nationality" },
      { pointer: "/currency", message: "Unknown field: currency" },
    ]);
  });

  it("a GET's fields point into its path or query, as the API's do", () => {
    assert.deepEqual(
      issuesOf(() => parse("hotels get", ["266000", "--locale", "fr"])).map((issue) => issue.pointer),
      ["/path/hotelId", "/query/locale"],
    );
    assert.deepEqual(
      issuesOf(() => parse("orders list", ["--limit", "0"])).map((issue) => issue.pointer),
      ["/query/limit"],
    );
  });

  it("a check-in in the past, and mixed rooms in offers", () => {
    const yesterday = addIsoDateDays(today, -2);
    assert.deepEqual(
      issuesOf(() =>
        parse("hotels search", ["--text", "x", "--check-in", yesterday, "--check-out", today, "--room", "1"]),
      ).map((issue) => issue.pointer),
      ["/stay/checkIn"],
    );
    // Offers take one party per call; mixed rooms are the API's answer
    // (stay_unsupported), not a local refusal: the contract accepts them.
    assert.equal(
      parse("hotels offers", ["--hotel", HOTEL, ...STAY, "--room", "2", "--room", "1"]).method,
      "POST",
    );
  });

  it("ids must have their prefix", () => {
    for (const [name, argv] of [
      ["hotels get", ["266000"]],
      ["orders get", ["ao_1"]],
      ["hotels search", ["--place", "1850147"]],
    ] as const) {
      assert.throws(() => parse(name, [...argv]), isUsage, `${name} ${argv.join(" ")}`);
    }
  });
});

describe("flags", () => {
  it("--room is adults or adults:age,age", () => {
    assert.deepEqual(body("hotels search", ["--text", "x", ...STAY, "--room", "2:6,9"]).stay, {
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      rooms: [{ adults: 2, childrenAges: [6, 9] }],
    });
    assert.deepEqual(
      (body("hotels search", ["--text", "x", ...STAY, "--room", " 3 : 0 , 17 "]).stay as { rooms: unknown })
        .rooms,
      [{ adults: 3, childrenAges: [0, 17] }],
    );
    for (const bad of ["", "two", "2:", "2:6,", "2:a", "-1", "2:-3", "2.5", "0x2"]) {
      assert.throws(
        () => parse("hotels search", ["--text", "x", ...STAY, "--room", bad]),
        (error) => isUsage(error) && /--room/.test((error as Error).message),
        JSON.stringify(bad),
      );
    }
  });

  it("--guest room:first:last lands in that room's guests", () => {
    const sent = body("hotels book", ["--offer", OFFER, "--guest", "1:John:Smith", ...CONTACT]);
    assert.deepEqual(sent.items, [
      { offerId: OFFER, hotel: { rooms: [{ guests: [{ firstName: "John", lastName: "Smith" }] }] } },
    ]);
    const rooms = (
      body("hotels book", ["--offer", OFFER, "--guest", " 2 : Mary Ann : Lee ", "--guest", "1:A:B", ...CONTACT])
        .items as { hotel: { rooms: unknown } }[]
    )[0]?.hotel.rooms;
    assert.deepEqual(rooms, [
      { guests: [{ firstName: "A", lastName: "B" }] },
      { guests: [{ firstName: "Mary Ann", lastName: "Lee" }] },
    ]);
  });

  it("--guest refuses a bad form, a skipped room and a room past the limit", () => {
    for (const guests of [
      ["John Smith"],
      ["1:John"],
      ["1:John:Smith:Jr"],
      ["x:John:Smith"],
      ["0:John:Smith"],
      ["2:John:Smith"],
      ["1:A:B", "3:C:D"],
      [`${LIMITS.rooms + 1}:A:B`],
      ["1000000000:A:B"],
    ]) {
      assert.throws(
        () => parse("hotels book", ["--offer", OFFER, ...guests.flatMap((g) => ["--guest", g]), ...CONTACT]),
        (error) => isUsage(error) && /--guest/.test((error as Error).message),
        guests.join(" "),
      );
    }
  });

  it("--point is lat,lng", () => {
    for (const bad of ["13.7", "13.7,100.5,5", "a,b", "13.7,", "0x10,1", "1e3,1"]) {
      assert.throws(
        () => parse("hotels search", ["--point", bad]),
        (error) => isUsage(error) && /--point/.test((error as Error).message),
        bad,
      );
    }
  });

  it("numbers are decimal numbers", () => {
    for (const bad of ["four", "", "0x10", "1e3", "Infinity"]) {
      assert.throws(
        () => parse("hotels search", ["--text", "x", "--limit", bad]),
        (error) => isUsage(error) && /--limit/.test((error as Error).message),
        bad,
      );
    }
  });

  it("flags that pick different destinations can't be given together", () => {
    for (const [one, two] of [
      [["--place-name", "Bangkok", "--country", "TH"], ["--place", PLACE]],
      [["--place", PLACE], ["--locality", PLACE]],
      [["--point", "1,2"], ["--country-only", "TH"]],
      [["--country", "TH"], ["--country-only", "TH"]],
    ]) {
      assert.throws(
        () => parse("hotels search", [...one!, ...two!]),
        (error) =>
          isUsage(error) &&
          /can't be given together/.test((error as Error).message) &&
          (error as Error).message.includes(two![0]!),
        [...one!, ...two!].join(" "),
      );
    }
    // Flags of one variant go together.
    assert.deepEqual(body("hotels search", ["--place-name", "Kyoto", "--country", "JP"]).destination, {
      kind: "place_name",
      name: "Kyoto",
      countryCode: "JP",
    });
  });

  it("a flag's variant replaces another variant from --body", () => {
    assert.deepEqual(
      body("hotels search", ["--body", `{"destination":{"kind":"place","placeId":"${PLACE}"}}`, "--point", "1,2"])
        .destination,
      { kind: "point", location: { lat: 1, lng: 2 } },
    );
    // The same variant is merged into.
    assert.deepEqual(
      body("hotels search", ["--body", '{"destination":{"kind":"place_name","name":"Kyoto"}}', "--country", "jp"])
        .destination,
      { kind: "place_name", name: "Kyoto", countryCode: "JP" },
    );
  });

  it("unknown flags, stray arguments and a single-value flag given twice are usage errors", () => {
    for (const argv of [
      ["--query", "Bangkok"],
      ["Bangkok"],
      ["--text", "a", "--text", "b"],
      ["--text", "a", "--text=b"],
    ]) {
      assert.throws(() => parse("hotels search", argv), isUsage, argv.join(" "));
    }
    for (const argv of [[], [HOTEL, HOTEL_2]]) {
      assert.throws(
        () => parse("hotels get", argv),
        (error) => isUsage(error) && (error as Error).message === "Usage: fortrip hotels get <hotelId> [options]",
        argv.join(" "),
      );
    }
  });
});

describe("--body", () => {
  it("flags override its fields; fields no flag sets are kept", () => {
    assert.deepEqual(
      body("hotels search", ["--body", '{"text":"Tokyo","limit":5}', "--text", "Osaka"]),
      { text: "Osaka", limit: 5 },
    );
    assert.deepEqual(
      body("hotels book", [
        "--body",
        `{"items":[{"offerId":"${OFFER}","hotel":{"rooms":[{"guests":[{"firstName":"A","lastName":"B"}]}],"specialRequests":"Quiet"}}]}`,
        "--guest",
        "1:John:Smith",
        ...CONTACT,
      ]).items,
      [
        {
          offerId: OFFER,
          hotel: { rooms: [{ guests: [{ firstName: "John", lastName: "Smith" }] }], specialRequests: "Quiet" },
        },
      ],
    );
  });

  it("@file reads the file", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "fortrip-body-")), "body.json");
    await writeFile(file, '{"text":"Tokyo","limit":2}');
    assert.deepEqual(body("hotels search", ["--body", `@${file}`, "--limit", "3"]), {
      text: "Tokyo",
      limit: 3,
    });
    assert.throws(() => body("hotels search", ["--body", `@${file}.missing`]), isUsage);
  });

  it("must be a JSON object", () => {
    for (const raw of ["[1,2]", "not json", "null", "3"]) {
      assert.throws(() => body("hotels search", ["--body", raw]), isUsage, raw);
    }
  });
});

describe("display currency", () => {
  const SEARCH = ["--text", "x"];
  const OFFERS = ["--hotel", HOTEL, ...STAY, "--room", "2"];

  it("FORTRIP_DISPLAY_CURRENCY is the default of search and offers", () => {
    const env = { FORTRIP_DISPLAY_CURRENCY: " cny " };
    assert.equal(body("hotels search", SEARCH, env).displayCurrency, "CNY");
    assert.equal(body("hotels offers", OFFERS, env).displayCurrency, "CNY");
  });

  it("--display-currency beats --body, which beats the environment", () => {
    const env = { FORTRIP_DISPLAY_CURRENCY: "CNY" };
    assert.equal(body("hotels search", [...SEARCH, "--display-currency", "usd"], env).displayCurrency, "USD");
    assert.equal(
      body("hotels search", [...SEARCH, "--body", '{"displayCurrency":"USD"}'], env).displayCurrency,
      "USD",
    );
  });

  it("FORTRIP_CURRENCY is no longer read, and a blank variable sets nothing", () => {
    assert.equal("displayCurrency" in body("hotels search", SEARCH, { FORTRIP_CURRENCY: "CNY" }), false);
    assert.equal("displayCurrency" in body("hotels search", SEARCH, { FORTRIP_DISPLAY_CURRENCY: " " }), false);
  });

  it("an unknown currency is refused, not sent", () => {
    assert.throws(() => body("hotels search", SEARCH, { FORTRIP_DISPLAY_CURRENCY: "EUR" }), isUsage);
    assert.throws(() => body("hotels search", [...SEARCH, "--display-currency", ""]), isUsage);
  });

  it("orders never take one: they are charged in USD", () => {
    const sent = body("hotels book", ["--offer", OFFER, "--guest", "1:A:B", ...CONTACT], {
      FORTRIP_DISPLAY_CURRENCY: "CNY",
    });
    assert.equal("displayCurrency" in sent, false);
    assert.throws(
      () => parse("hotels book", ["--offer", OFFER, "--guest", "1:A:B", ...CONTACT, "--display-currency", "CNY"]),
      isUsage,
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
