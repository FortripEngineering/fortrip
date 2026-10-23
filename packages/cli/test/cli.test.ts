import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import {
  API,
  COMMAND_GROUPS,
  COMMANDS,
  commandInvocation,
  type CommandSpec,
  GLOBAL_FLAGS,
} from "@fortrip/agent-contract";

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

const RATES = ["hotels", "rates", "--hotel", "266000", ...STAY, ...OCCUPANCY];

const bookWith = (occupancy: string[]) => [
  "hotels",
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
  it("hotels search posts to /api/agent/v1/hotels/search with the signed-in token", async () => {
    const { code } = await cli(["hotels", "search", "-q", "Bangkok", ...STAY, "--currency", "usd"]);
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

  it("FORTRIP_CURRENCY is the default currency of hotels search", async () => {
    await cli(["hotels", "search", "-q", "Bangkok"], { FORTRIP_CURRENCY: "usd" });
    assert.deepEqual(requests[0]?.body, { query: "Bangkok", currency: "USD" });
  });

  it("hotels get gets /api/agent/v1/hotels/{id}, with ?include=rooms on request", async () => {
    await cli(["hotels", "get", "266000"]);
    await cli(["hotels", "get", "266000", "--with-rooms"]);
    assert.deepEqual(
      requests.map(({ method, url, body }) => [method, url, body]),
      [
        ["GET", "/api/agent/v1/hotels/266000", undefined],
        ["GET", "/api/agent/v1/hotels/266000?include=rooms", undefined],
      ],
    );
  });

  it("hotels rates posts to /api/agent/v1/hotels/rates", async () => {
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

  it("hotels book posts to /api/agent/v1/hotels/bookings", async () => {
    const { code } = await cli(BOOK);
    assert.equal(code, 0);
    assert.equal(requests[0]?.method, "POST");
    assert.equal(requests[0]?.url, "/api/agent/v1/hotels/bookings");
    assert.equal((requests[0]?.body as { hotelId: number }).hotelId, 266000);
  });

  it("hotels rates without --rooms exits 2 and sends nothing", async () => {
    const { code, stderr } = await cli([
      "hotels",
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

  it("hotels rates without --adults, and hotels book without either, exit 2 and send nothing", async () => {
    for (const args of [
      ["hotels", "rates", "--hotel", "266000", ...STAY, "--rooms", "1"],
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

describe("FORTRIP_TOKEN", () => {
  // The distinctive part of each value: it must not appear in any output.
  const SECRET = "SECRETPART";

  it("with a line break or other control character is refused before anything is sent, and never echoed", async () => {
    for (const bad of [
      `abc\n${SECRET}`,
      `abc\r\n${SECRET}`,
      `abc\u0007${SECRET}`,
      `abc\u007f${SECRET}`,
      `abc${SECRET}\u4ee4\u724c`,
    ]) {
      const { code, stdout, stderr } = await cli(["whoami"], { FORTRIP_TOKEN: bad });
      assert.equal(code, 3, JSON.stringify(bad));
      const error = JSON.parse(stderr);
      assert.match(error.error, /FORTRIP_TOKEN/);
      assert.match(error.error, /line break/);
      // The same answer as a token the server turns down: no link to open.
      assert.equal(error.exitCode, 3);
      assert.equal(error.tokenSource, "FORTRIP_TOKEN");
      assert.equal(error.loginUrl, undefined);
      assert.equal(error.retryable, undefined);
      assert.ok(!stdout.includes(SECRET) && !stderr.includes(SECRET), JSON.stringify(bad));
    }
    assert.equal(requests.length, 0);
  });

  it("is still trimmed of surrounding whitespace", async () => {
    const { code } = await cli(["whoami"], { FORTRIP_TOKEN: `  ${TOKEN}\n` });
    assert.equal(code, 0);
    assert.equal(requests[0]?.authorization, `Bearer ${TOKEN}`);
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

/** The arguments that run a command: `["hotels", "search"]`. */
const words = (spec: CommandSpec) => commandInvocation(spec).split(" ").slice(1);

describe("help", () => {
  it("--help lists the commands typed on their own and each group, with their summaries", async () => {
    for (const args of [["--help"], ["-h"], ["help"], []]) {
      const { code, stdout } = await cli(args);
      assert.equal(code, 0, args.join(" "));
      for (const spec of COMMANDS.filter((command) => command.group === null)) {
        assert.match(stdout, new RegExp(`^  ${spec.name}\\b`, "m"), spec.name);
        assert.ok(flat(stdout).includes(flat(spec.summary)), spec.name);
      }
      for (const group of COMMAND_GROUPS) {
        assert.match(stdout, new RegExp(`^  ${group.name} <command> `, "m"), group.name);
        assert.ok(flat(stdout).includes(flat(group.summary)), group.name);
      }
      // A group's commands are listed by the group's own help.
      for (const spec of COMMANDS.filter((command) => command.group !== null)) {
        assert.doesNotMatch(stdout, new RegExp(`^  ${spec.name}\\b`, "m"), spec.name);
      }
    }
  });

  it("<group> --help lists the group's commands, with their summaries", async () => {
    for (const group of COMMAND_GROUPS) {
      const specs = COMMANDS.filter((spec) => spec.group === group.name);
      for (const args of [["--help"], ["-h"], ["help"], []]) {
        const { code, stdout } = await cli([group.name, ...args]);
        assert.equal(code, 0, `${group.name} ${args.join(" ")}`);
        assert.match(stdout, new RegExp(`^Usage: fortrip ${group.name} <command> \\[options\\]$`, "m"));
        assert.match(stdout, new RegExp(`fortrip ${group.name} <command> --help`));
        assert.ok(flat(stdout).includes(flat(group.summary)), group.name);
        for (const spec of specs) {
          assert.match(stdout, new RegExp(`^  ${spec.name}\\b`, "m"), spec.name);
          assert.ok(flat(stdout).includes(flat(spec.summary)), spec.name);
        }
      }
    }
    assert.equal(requests.length, 0);
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
      const label = commandInvocation(spec);
      const { code, stdout } = await cli([...words(spec), "--help"]);
      assert.equal(code, 0, label);
      assert.match(stdout, new RegExp(`^Usage: ${label}\\b`), label);
      const text = flat(stdout);
      assert.ok(text.includes(flat(spec.summary)), label);
      for (const flag of [...spec.flags, ...(spec.options ?? [])]) {
        const name = `${"short" in flag && flag.short ? `-${flag.short}, ` : ""}--${flag.flag}${flag.placeholder ? ` ${flag.placeholder}` : ""}`;
        assert.ok(text.includes(name), `${label}: ${name}`);
        assert.ok(text.includes(flat(flag.description)), `${label} --${flag.flag}`);
      }
    }
  });

  it("-h works like --help, and anywhere in the command", async () => {
    for (const args of [
      ["hotels", "book", "-h"],
      ["hotels", "rates", "--hotel", "1", "--help"],
      ["hotels", "get", "-h"],
    ]) {
      const { code, stdout } = await cli(args);
      assert.equal(code, 0, args.join(" "));
      assert.match(stdout, new RegExp(`^Usage: fortrip ${args[0]} ${args[1]}\\b`));
    }
    assert.equal(requests.length, 0);
  });

  it("hotels get's usage names its positional, guide's is optional", async () => {
    assert.match(
      (await cli(["hotels", "get", "--help"])).stdout,
      /^Usage: fortrip hotels get <hotelId> /,
    );
    assert.match((await cli(["guide", "--help"])).stdout, /^Usage: fortrip guide \[topic\]/);
  });

  it("a command named like an object property is just unknown", async () => {
    for (const args of [["constructor", "--help"], ["hotels", "constructor", "--help"]]) {
      const { code, stderr } = await cli(args);
      assert.equal(code, 2, args.join(" "));
      assert.match(JSON.parse(stderr).error, /Unknown command/);
    }
  });

  it("--help after -- is an argument, not a request for help", async () => {
    const { code } = await cli(["hotels", "get", "--", "--help"]);
    assert.equal(code, 2);
  });

  it("--help names the commands FORTRIP_CURRENCY is the default for as they are typed", async () => {
    const typed = COMMANDS.filter((spec) => spec.flags.some((flag) => flag.field === "currency")).map(
      (spec) => commandInvocation(spec).replace(/^fortrip /, ""),
    );
    assert.deepEqual(typed, ["hotels search", "hotels rates"]);
    const { stdout } = await cli(["--help"]);
    assert.match(
      stdout,
      new RegExp(`^  FORTRIP_CURRENCY Default --currency for ${typed.join(" and ")}$`, "m"),
    );
  });

  it("no help names the old paths or per-room defaults", async () => {
    for (const args of [["--help"], ["hotels", "rates", "--help"], ["hotels", "book", "--help"]]) {
      const { stdout } = await cli(args);
      assert.doesNotMatch(stdout, /\/api\//);
      assert.doesNotMatch(stdout, /default(s)? to 1 room/);
    }
  });
});

describe("commands are typed after their group", () => {
  it("the 1.x hotel commands are gone: exit 2, naming the 2.0 command", async () => {
    const renamed = {
      search: "fortrip hotels search",
      hotel: "fortrip hotels get",
      rates: "fortrip hotels rates",
      book: "fortrip hotels book",
    };
    const invocations = new Set(COMMANDS.map(commandInvocation));
    for (const [old, now] of Object.entries(renamed)) {
      assert.ok(invocations.has(now), now);
      const { code, stdout, stderr } = await cli([old, "266000"]);
      assert.equal(code, 2, old);
      assert.equal(stdout, "", old);
      assert.equal(JSON.parse(stderr).error, `Unknown command "${old}". Did you mean \`${now}\`?`);
    }
    assert.equal(requests.length, 0);
  });

  it("any other unknown command points at the help", async () => {
    for (const name of ["nope", "hotelz", "constructor", "toString"]) {
      const { code, stderr } = await cli([name]);
      assert.equal(code, 2, name);
      assert.equal(
        JSON.parse(stderr).error,
        `Unknown command "${name}". Run \`fortrip --help\`.`,
        name,
      );
    }
  });

  it("an unknown command in a group is exit 2, pointing at the group's help", async () => {
    for (const args of [["hotels", "nope"], ["hotels", "login"], ["hotels", "hotels"]]) {
      const { code, stderr } = await cli(args);
      assert.equal(code, 2, args.join(" "));
      assert.equal(
        JSON.parse(stderr).error,
        `Unknown command "${args.join(" ")}". Run \`fortrip hotels --help\`.`,
      );
    }
    assert.equal(requests.length, 0);
  });

  it("a group's command takes its flags after its name, not before", async () => {
    const { code, stderr } = await cli(["hotels", "--query", "x", "search"]);
    assert.equal(code, 2);
    assert.match(JSON.parse(stderr).error, /Unknown command "hotels --query"/);
    assert.equal(requests.length, 0);
  });
});

describe("other commands", () => {
  it("mcp takes no arguments and exits 2", async () => {
    const { code, stderr } = await cli(["mcp", "extra"]);
    assert.equal(code, 2);
    assert.match(JSON.parse(stderr).error, /mcp takes no arguments/);
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
