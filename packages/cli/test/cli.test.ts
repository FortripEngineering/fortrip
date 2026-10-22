import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import { API, COMMANDS, GLOBAL_FLAGS } from "@fortrip/agent-contract";

const run = promisify(execFile);

/** What the fake API answers next, and every request it has received. */
let reply: { status: number; body: unknown };
let requests: { method?: string; url?: string; authorization?: string; body: unknown }[];
let server: Server;
let apiUrl: string;

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: raw ? JSON.parse(raw) : undefined,
      });
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
beforeEach(() => {
  requests = [];
  reply = { status: 200, body: { success: true, data: {} } };
});

const TOKEN = `fth_${"x".repeat(43)}`;

async function cli(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const env = {
    ...process.env,
    FORTRIP_API_URL: apiUrl,
    FORTRIP_TOKEN: TOKEN,
    FORTRIP_CURRENCY: "",
    XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), "fortrip-cli-")),
    ...extraEnv,
  };
  return run(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { env }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }) => error,
  );
}

const STAY = ["--check-in", "2026-11-10", "--check-out", "2026-11-12"];

const OCCUPANCY = ["--rooms", "1", "--adults", "2"];

const RATES = ["rates", "--hotel", "266000", ...STAY, ...OCCUPANCY];

const bookWith = (occupancy: string[]) => [
  "book",
  "--hotel",
  "266000",
  "--room-id",
  "9191658",
  "--rate-plan",
  "rp_1",
  ...STAY,
  ...occupancy,
  "--guest",
  "John Smith",
  "--contact-name",
  "John Smith",
  "--contact-phone",
  "+8613800000000",
];

const BOOK = bookWith(OCCUPANCY);

describe("requests", () => {
  it("search posts to /api/agent/v1/hotels/search with the signed-in token", async () => {
    const { code } = await cli(["search", "-q", "Bangkok", ...STAY, "--currency", "usd"]);
    assert.equal(code, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, "POST");
    assert.equal(requests[0]?.url, "/api/agent/v1/hotels/search");
    assert.equal(requests[0]?.url, API.search);
    assert.equal(requests[0]?.authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(requests[0]?.body, {
      query: "Bangkok",
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      currency: "USD",
    });
  });

  it("FORTRIP_CURRENCY is the default currency of search", async () => {
    await cli(["search", "-q", "Bangkok"], { FORTRIP_CURRENCY: "usd" });
    assert.deepEqual(requests[0]?.body, { query: "Bangkok", currency: "USD" });
  });

  it("hotel gets /api/agent/v1/hotels/{id}, with ?include=rooms on request", async () => {
    await cli(["hotel", "266000"]);
    await cli(["hotel", "266000", "--with-rooms"]);
    assert.deepEqual(
      requests.map(({ method, url, body }) => [method, url, body]),
      [
        ["GET", "/api/agent/v1/hotels/266000", undefined],
        ["GET", "/api/agent/v1/hotels/266000?include=rooms", undefined],
      ],
    );
  });

  it("rates posts to /api/agent/v1/hotels/rates", async () => {
    const { code } = await cli(RATES);
    assert.equal(code, 0);
    assert.equal(requests[0]?.method, "POST");
    assert.equal(requests[0]?.url, "/api/agent/v1/hotels/rates");
    assert.deepEqual(requests[0]?.body, {
      hotelIds: [266000],
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      rooms: 1,
      adults: 2,
    });
  });

  it("book posts to /api/agent/v1/hotels/bookings", async () => {
    const { code } = await cli(BOOK);
    assert.equal(code, 0);
    assert.equal(requests[0]?.method, "POST");
    assert.equal(requests[0]?.url, "/api/agent/v1/hotels/bookings");
    assert.equal((requests[0]?.body as { hotelId: number }).hotelId, 266000);
  });

  it("rates without --rooms exits 2 and sends nothing", async () => {
    const { code, stderr } = await cli([
      "rates",
      "--hotel",
      "266000",
      ...STAY,
      "--adults",
      "2",
    ]);
    assert.equal(code, 2);
    assert.match(JSON.parse(stderr).error, /--rooms/);
    assert.equal(requests.length, 0);
  });

  it("rates without --adults, and book without either, exit 2 and send nothing", async () => {
    for (const args of [
      ["rates", "--hotel", "266000", ...STAY, "--rooms", "1"],
      bookWith([]),
      bookWith(["--rooms", "1"]),
    ]) {
      assert.equal((await cli(args)).code, 2, args.join(" "));
    }
    assert.equal(requests.length, 0);
  });

  it("a 400 from the API is exit 2 with the server's error on stderr", async () => {
    reply = { status: 400, body: { success: false, error: "checkIn must be a date" } };
    const { code, stderr } = await cli(RATES);
    assert.equal(code, 2);
    assert.equal(JSON.parse(stderr).error, "checkIn must be a date");
  });
});

describe("book prints what the server returned", () => {
  const STRIPE = `https://checkout.stripe.com/c/pay/cs_test_1#${"f".repeat(300)}`;

  it("paymentUrl and the other links exactly as returned", async () => {
    const data = {
      agentOrderId: "ao_1",
      paymentUrl: "https://fortrip.ai/booking-status?session_id=cs_test_1",
      amount: 120.5,
      currency: "USD",
      orderUrl: "https://fortrip.ai/orders/ao_1",
      statusUrl: "https://fortrip.ai/booking-status?session_id=cs_test_1",
      terms: { boardCode: "BB", boardCount: 2 },
      stay: {
        hotelId: 266000,
        hotelName: "Hotel",
        roomName: null,
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
        nights: 2,
        rooms: 1,
        adultsPerRoom: 2,
        childrenAgesPerRoom: [],
      },
    };
    reply = { status: 200, body: { success: true, data } };
    const { code, stdout } = await cli(BOOK);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout), data);
  });

  it("does not rewrite a link: no host is made absolute, no Stripe link swapped", async () => {
    const data = {
      paymentUrl: STRIPE,
      statusUrl: "/booking-status?session_id=cs_test_1",
      orderUrl: "/orders/ao_1",
    };
    reply = { status: 200, body: { success: true, data } };
    assert.deepEqual(JSON.parse((await cli(BOOK)).stdout), data);
  });

  it("a 409 for a stay already booked has its links on stderr as returned", async () => {
    const body = {
      success: false,
      error: "This stay already has a paid or completed booking.",
      reason: "already_booked",
      agentOrderId: "ao_1",
      orderUrl: "/orders/ao_1",
      statusUrl: "/booking-status?session_id=cs_test_1",
    };
    reply = { status: 409, body };
    const { code, stderr } = await cli(BOOK);
    assert.equal(code, 1);
    assert.deepEqual(JSON.parse(stderr), {
      error: body.error,
      exitCode: 1,
      status: 409,
      reason: "already_booked",
      agentOrderId: "ao_1",
      orderUrl: "/orders/ao_1",
      statusUrl: "/booking-status?session_id=cs_test_1",
    });
  });
});

/** Help is wrapped, so compare with whitespace collapsed. */
const flat = (text: string) => text.replace(/\s+/g, " ");

describe("help", () => {
  it("--help lists every command in COMMANDS, with its summary", async () => {
    for (const args of [["--help"], ["-h"], ["help"], []]) {
      const { code, stdout } = await cli(args);
      assert.equal(code, 0, args.join(" "));
      for (const spec of COMMANDS) {
        assert.match(stdout, new RegExp(`^  ${spec.name}\\b`, "m"), spec.name);
        assert.ok(flat(stdout).includes(flat(spec.summary)), spec.name);
      }
    }
  });

  it("--help lists the global flags and points to per-command help", async () => {
    const { stdout } = await cli(["--help"]);
    assert.match(stdout, /fortrip <command> --help/);
    for (const option of GLOBAL_FLAGS) {
      const names = `${option.short ? `-${option.short}, ` : ""}--${option.flag}`;
      assert.ok(stdout.includes(names), names);
      assert.ok(flat(stdout).includes(flat(option.description)), option.flag);
    }
  });

  it("<command> --help prints that command's flags, placeholders and descriptions", async () => {
    for (const spec of COMMANDS) {
      const { code, stdout } = await cli([spec.name, "--help"]);
      assert.equal(code, 0, spec.name);
      assert.match(stdout, new RegExp(`^Usage: fortrip ${spec.name}\\b`), spec.name);
      const text = flat(stdout);
      assert.ok(text.includes(flat(spec.summary)), spec.name);
      for (const flag of [...spec.flags, ...(spec.options ?? [])]) {
        const name = `${"short" in flag && flag.short ? `-${flag.short}, ` : ""}--${flag.flag}${flag.placeholder ? ` ${flag.placeholder}` : ""}`;
        assert.ok(text.includes(name), `${spec.name}: ${name}`);
        assert.ok(text.includes(flat(flag.description)), `${spec.name} --${flag.flag}`);
      }
    }
  });

  it("-h works like --help, and anywhere in the command", async () => {
    for (const args of [["book", "-h"], ["rates", "--hotel", "1", "--help"], ["hotel", "-h"]]) {
      const { code, stdout } = await cli(args);
      assert.equal(code, 0, args.join(" "));
      assert.match(stdout, new RegExp(`^Usage: fortrip ${args[0]}\\b`));
    }
    assert.equal(requests.length, 0);
  });

  it("hotel's usage names its positional, guide's is optional", async () => {
    assert.match((await cli(["hotel", "--help"])).stdout, /^Usage: fortrip hotel <hotelId> /);
    assert.match((await cli(["guide", "--help"])).stdout, /^Usage: fortrip guide \[topic\]/);
  });

  it("a command named like an object property is just unknown", async () => {
    const { code, stderr } = await cli(["constructor", "--help"]);
    assert.equal(code, 2);
    assert.match(JSON.parse(stderr).error, /Unknown command/);
  });

  it("--help after -- is an argument, not a request for help", async () => {
    const { code } = await cli(["hotel", "--", "--help"]);
    assert.equal(code, 2);
  });

  it("no help names the old paths or per-room defaults", async () => {
    for (const args of [["--help"], ["rates", "--help"], ["book", "--help"]]) {
      const { stdout } = await cli(args);
      assert.doesNotMatch(stdout, /\/api\//);
      assert.doesNotMatch(stdout, /default(s)? to 1 room/);
    }
  });
});

describe("other commands", () => {
  it("mcp is not available yet and exits 2", async () => {
    const { code, stderr } = await cli(["mcp"]);
    assert.equal(code, 2);
    assert.match(JSON.parse(stderr).error, /not available yet/);
  });

  it("skill is gone: guide replaced it", async () => {
    const { code, stderr } = await cli(["skill"]);
    assert.equal(code, 2);
    assert.match(JSON.parse(stderr).error, /Unknown command "skill"/);
  });

  it("--version and -v print the version", async () => {
    for (const flag of ["--version", "-v"]) {
      const { code, stdout } = await cli([flag]);
      assert.equal(code, 0);
      assert.match(stdout, /^\d+\.\d+\.\d+/);
    }
  });
});
