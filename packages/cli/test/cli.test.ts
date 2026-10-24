import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import {
  addIsoDateDays,
  API,
  COMMAND_GROUPS,
  COMMANDS,
  commandInvocation,
  type CommandSpec,
  GLOBAL_FLAGS,
  type RenderedTool,
  renderError,
  renderToolResult,
} from "@fortrip/agent-contract";

const run = promisify(execFile);

/** What the fake API answers next, and every request it has received. */
let reply: { status: number; body: unknown; headers?: Record<string, string> };
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
      res.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
beforeEach(() => {
  requests = [];
  reply = { status: 200, body: {} };
});

const TOKEN = `fth_${"x".repeat(43)}`;

async function cli(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const env = {
    ...process.env,
    FORTRIP_API_URL: apiUrl,
    FORTRIP_TOKEN: TOKEN,
    FORTRIP_DISPLAY_CURRENCY: "",
    XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), "fortrip-cli-")),
    ...extraEnv,
  };
  return run(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { env }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }) => error,
  );
}

/** A synthetic v1 answer from the contract's render fixtures. */
async function fixture(name: string): Promise<{ tool: RenderedTool; data: unknown }> {
  return JSON.parse(
    await readFile(new URL(`../../contract/test/fixtures/v1/${name}.json`, import.meta.url), "utf8"),
  );
}

async function errorFixture(name: string): Promise<{ status: number; envelope: unknown }> {
  return JSON.parse(
    await readFile(new URL(`../../contract/test/fixtures/v1/${name}.json`, import.meta.url), "utf8"),
  );
}

const today = new Date().toISOString().slice(0, 10);
const STAY = ["--check-in", addIsoDateDays(today, 30), "--check-out", addIsoDateDays(today, 32)];
const HOTEL = `htl_${"a1".repeat(10)}`;
const OFFER = `off_${"c3".repeat(10)}`;
const ORDER = `ord_${"d4".repeat(10)}`;

const SEARCH = ["hotels", "search", "--place-name", "Bangkok", "--country", "TH", ...STAY, "--room", "2"];
const OFFERS = ["hotels", "offers", "--hotel", HOTEL, ...STAY, "--room", "2:6", "--room", "2:6"];
const BOOK = [
  ...["hotels", "book", "--offer", OFFER, "--guest", "1:John:Smith"],
  ...["--first-name", "John", "--last-name", "Smith", "--email", "john@example.com"],
  ...["--phone", "+8613800000000"],
];

describe("requests", () => {
  it("each command sends its method, path and body with the token", async () => {
    for (const [args, method, url] of [
      [SEARCH, "POST", "/v1/hotels/search"],
      [["hotels", "get", HOTEL, "--rooms"], "GET", `/v1/hotels/${HOTEL}?include=rooms`],
      [OFFERS, "POST", "/v1/hotels/offers"],
      [BOOK, "POST", "/v1/orders"],
      [["orders", "get", ORDER], "GET", `/v1/orders/${ORDER}`],
      [["orders", "list", "--limit", "5"], "GET", "/v1/orders?limit=5"],
    ] as const) {
      requests = [];
      const { code, stderr } = await cli([...args]);
      assert.equal(code, 0, `${args.join(" ")}: ${stderr}`);
      assert.equal(requests.length, 1, args.join(" "));
      assert.equal(requests[0]?.method, method, args.join(" "));
      assert.equal(requests[0]?.url, url, args.join(" "));
      assert.equal(requests[0]?.authorization, `Bearer ${TOKEN}`);
      assert.equal(requests[0]?.body === undefined, method === "GET", args.join(" "));
    }
  });

  it("hotels search posts the contract's body", async () => {
    await cli(SEARCH);
    assert.equal(requests[0]?.url, API.hotelSearch);
    assert.deepEqual(requests[0]?.body, {
      destination: { kind: "place_name", name: "Bangkok", countryCode: "TH" },
      stay: {
        checkIn: STAY[1],
        checkOut: STAY[3],
        rooms: [{ adults: 2, childrenAges: [] }],
      },
    });
  });

  it("FORTRIP_DISPLAY_CURRENCY is the default display currency", async () => {
    await cli(OFFERS, { FORTRIP_DISPLAY_CURRENCY: "cny" });
    assert.equal((requests[0]?.body as { displayCurrency?: string }).displayCurrency, "CNY");
  });

  it("FORTRIP_API_URL may carry a path prefix, which every path follows", async () => {
    for (const prefix of ["/api/public", "/api/public/"]) {
      requests = [];
      const { code, stderr } = await cli(SEARCH, { FORTRIP_API_URL: `${apiUrl}${prefix}` });
      assert.equal(code, 0, stderr);
      assert.equal(requests[0]?.url, "/api/public/v1/hotels/search");
    }
  });

  it("a request the contract refuses exits 2 and sends nothing", async () => {
    const { code, stdout, stderr } = await cli(["hotels", "offers", "--hotel", "266000", ...STAY, "--room", "2"]);
    assert.equal(code, 2);
    assert.equal(stdout, "");
    assert.equal(
      stderr,
      [
        "Error: Not sent: fortrip hotels offers was given an invalid request.",
        "- /hotelIds/0: hotelId must be htl_ followed by 20 letters or digits",
        "",
      ].join("\n"),
    );
    const json = JSON.parse((await cli(["hotels", "offers", "--hotel", "1", ...STAY, "--room", "2", "--json"])).stderr);
    assert.deepEqual(json.error.details.issues, [
      { pointer: "/hotelIds/0", message: "hotelId must be htl_ followed by 20 letters or digits" },
    ]);
    assert.equal(requests.length, 0);
  });

  it("flags that pick different destinations exit 2 and send nothing", async () => {
    const { code, stderr } = await cli([...SEARCH, "--place", "plc_1"]);
    assert.equal(code, 2);
    assert.match(stderr, /^Error: --place-name and --place can't be given together/);
    assert.equal(requests.length, 0);
  });
});

describe("output", () => {
  it("prints each answer as the contract's compact text", async () => {
    for (const [args, name] of [
      [SEARCH, "search-shanghai-area"],
      [["hotels", "get", HOTEL], "hotel-long-description"],
      [OFFERS, "offers-two-hotels-one-unavailable"],
      [BOOK, "order-awaiting-payment"],
      [["orders", "get", ORDER], "order-confirmed"],
      [["orders", "list"], "list-orders"],
    ] as const) {
      const { tool, data } = await fixture(name);
      reply = { status: 200, body: data };
      const { code, stdout, stderr } = await cli([...args]);
      assert.equal(code, 0, stderr);
      assert.equal(stdout, `${renderToolResult(tool, data)}\n`, name);
      assert.equal(stderr, "", name);
    }
  });

  it("an order with a payment link ends with the consent rule", async () => {
    const { data } = await fixture("order-awaiting-payment");
    reply = { status: 201, body: data };
    const { stdout } = await cli(BOOK);
    assert.match(stdout, /Only after they say yes, give them payment\.url exactly as returned\.\n$/);
  });

  it("--json prints the answer as one line of JSON, anywhere before --", async () => {
    const { data } = await fixture("order-awaiting-payment");
    reply = { status: 200, body: data };
    for (const args of [
      ["orders", "get", ORDER, "--json"],
      ["--json", "orders", "get", ORDER],
      ["orders", "--json", "get", ORDER],
    ]) {
      const { code, stdout } = await cli(args);
      assert.equal(code, 0, args.join(" "));
      assert.equal(stdout, `${JSON.stringify(data)}\n`, args.join(" "));
    }
    // After --, it is an argument: an order id that isn't one.
    const { code } = await cli(["orders", "get", "--", "--json"]);
    assert.equal(code, 2);
  });

  it("an answer the renderer doesn't know is shown as JSON, not an error", async () => {
    reply = { status: 200, body: { unexpected: true } };
    const { code, stdout } = await cli(["orders", "get", ORDER]);
    assert.equal(code, 0);
    assert.equal(stdout, `${renderToolResult("get_order", { unexpected: true })}\n`);
  });
});

describe("errors", () => {
  it("an API error is the contract's rendering on stderr, with its exit code", async () => {
    for (const [name, exit] of [
      ["error-destination-ambiguous-suzhou", 1],
      ["error-search-too-broad-bali", 1],
      ["error-not-a-locality-patong", 1],
    ] as const) {
      const { status, envelope } = await errorFixture(name);
      reply = { status, body: envelope };
      const { code, stdout, stderr } = await cli(SEARCH);
      assert.equal(code, exit, name);
      assert.equal(stdout, "", name);
      assert.equal(stderr, `${renderError(envelope)}\n`, name);
    }
  });

  it("--json prints the error envelope as one line of JSON on stderr", async () => {
    const { status, envelope } = await errorFixture("error-destination-ambiguous-suzhou");
    reply = { status, body: envelope };
    const { code, stdout, stderr } = await cli([...SEARCH, "--json"]);
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.equal(stderr.split("\n").length, 2);
    const printed = JSON.parse(stderr);
    assert.deepEqual(printed, { ...(envelope as object), status });
  });

  it("invalid_request is exit 2, rate_limited exit 4", async () => {
    const error = (code: string, retryable = false) => ({
      error: { code, message: `${code} happened`, retryable, requestId: "req_1" },
    });
    reply = { status: 400, body: error("invalid_request") };
    assert.equal((await cli(SEARCH)).code, 2);
    reply = { status: 429, body: { error: { ...error("rate_limited", true).error, retryAfterSeconds: 7 } } };
    const limited = await cli(SEARCH);
    assert.equal(limited.code, 4);
    assert.match(limited.stderr, /^Error rate_limited: rate_limited happened\nRetryable: retry after 7 s\./);
  });

  it("an unknown error code falls back to the HTTP status", async () => {
    reply = {
      status: 409,
      body: { error: { code: "brand_new", message: "Something new", retryable: true, requestId: "req_1" } },
    };
    const { code, stderr } = await cli(SEARCH);
    assert.equal(code, 1);
    assert.match(stderr, /^Error brand_new \(HTTP 409\): Something new\nRetryable\./);
  });

  it("a 401 for FORTRIP_TOKEN exits 3 with the server's error and tokenSource beside it", async () => {
    reply = {
      status: 401,
      body: { error: { code: "unauthenticated", message: "Invalid token", retryable: false, requestId: "req_1" } },
    };
    const { code, stdout, stderr } = await cli(["orders", "list"]);
    assert.equal(code, 3);
    assert.equal(stdout, "");
    assert.match(stderr, /^Error unauthenticated: Invalid token\n/);
    assert.match(stderr, /^tokenSource: FORTRIP_TOKEN$/m);
    assert.match(stderr, /didn't accept FORTRIP_TOKEN/);

    const json = JSON.parse((await cli(["orders", "list", "--json"])).stderr);
    assert.equal(json.error.code, "unauthenticated");
    assert.equal(json.tokenSource, "FORTRIP_TOKEN");
  });

  it("the CLI's own error is text on stderr, or { error: { message } } with --json", async () => {
    const text = await cli(["hotels", "search", "--nope"]);
    assert.equal(text.code, 2);
    assert.match(text.stderr, /^Error: Unknown option '--nope'/);
    const json = await cli(["hotels", "search", "--nope", "--json"]);
    assert.equal(json.code, 2);
    assert.match(JSON.parse(json.stderr).error.message, /Unknown option '--nope'/);
    assert.equal(requests.length, 0);
  });

  it("an unreachable API is retryable, said in the error", async () => {
    const { code, stderr } = await cli(["orders", "list"], { FORTRIP_API_URL: "http://127.0.0.1:1" });
    assert.equal(code, 1);
    assert.match(stderr, /^Error: Could not reach http:\/\/127\.0\.0\.1:1/);
    assert.match(stderr, /^retryable: true$/m);
    const json = await cli(["orders", "list", "--json"], { FORTRIP_API_URL: "http://127.0.0.1:1" });
    assert.equal(JSON.parse(json.stderr).error.retryable, true);
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
      `abc${SECRET}令牌`,
    ]) {
      const { code, stdout, stderr } = await cli(["whoami", "--json"], { FORTRIP_TOKEN: bad });
      assert.equal(code, 3, JSON.stringify(bad));
      const printed = JSON.parse(stderr);
      assert.match(printed.error.message, /FORTRIP_TOKEN/);
      assert.match(printed.error.message, /line break/);
      // The same answer as a token the server turns down: no link to open.
      assert.equal(printed.tokenSource, "FORTRIP_TOKEN");
      assert.equal(printed.loginUrl, undefined);
      assert.equal(printed.error.retryable, undefined);
      assert.ok(!stdout.includes(SECRET) && !stderr.includes(SECRET), JSON.stringify(bad));
    }
    assert.equal(requests.length, 0);
  });

  it("is still trimmed of surrounding whitespace", async () => {
    reply = { status: 200, body: { userId: "user_1", email: "a@b.c", name: "Ada" } };
    const { code } = await cli(["whoami"], { FORTRIP_TOKEN: `  ${TOKEN}\n` });
    assert.equal(code, 0);
    assert.equal(requests[0]?.authorization, `Bearer ${TOKEN}`);
  });
});

describe("whoami", () => {
  it("prints the account as text, or as 2.0's JSON with --json", async () => {
    reply = { status: 200, body: { userId: "user_1", email: "a@b.c", name: null } };
    const text = await cli(["whoami"]);
    assert.equal(text.code, 0);
    assert.equal(requests[0]?.url, API.me);
    assert.equal(
      text.stdout,
      `Signed in to ${apiUrl}.\nuserId: user_1\nemail: a@b.c\nname: not given\n`,
    );
    const json = await cli(["whoami", "--json"]);
    assert.deepEqual(JSON.parse(json.stdout), { userId: "user_1", email: "a@b.c", name: null, apiUrl });
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
      ["hotels", "offers", "--hotel", "1", "--help"],
      ["orders", "get", "-h"],
    ]) {
      const { code, stdout } = await cli(args);
      assert.equal(code, 0, args.join(" "));
      assert.match(stdout, new RegExp(`^Usage: fortrip ${args[0]} ${args[1]}\\b`));
    }
    assert.equal(requests.length, 0);
  });

  it("positionals are named in the usage; guide's is optional", async () => {
    assert.match((await cli(["hotels", "get", "--help"])).stdout, /^Usage: fortrip hotels get <hotelId> /);
    assert.match((await cli(["orders", "get", "--help"])).stdout, /^Usage: fortrip orders get <orderId> /);
    assert.match((await cli(["guide", "--help"])).stdout, /^Usage: fortrip guide \[topic\]/);
  });

  it("a command named like an object property is just unknown", async () => {
    for (const args of [["constructor", "--help"], ["hotels", "constructor", "--help"]]) {
      const { code, stderr } = await cli(args);
      assert.equal(code, 2, args.join(" "));
      assert.match(stderr, /^Error: Unknown command/);
    }
  });

  it("--help after -- is an argument, not a request for help", async () => {
    const { code } = await cli(["hotels", "get", "--", "--help"]);
    assert.equal(code, 2);
  });

  it("--help states the output, the base URL and FORTRIP_DISPLAY_CURRENCY's commands", async () => {
    const typed = COMMANDS.filter((spec) => spec.flags.some((flag) => flag.field === "displayCurrency")).map(
      (spec) => commandInvocation(spec).replace(/^fortrip /, ""),
    );
    assert.deepEqual(typed, ["hotels search", "hotels offers"]);
    const { stdout } = await cli(["--help"]);
    assert.match(
      stdout,
      new RegExp(`^  FORTRIP_DISPLAY_CURRENCY +Default --display-currency for ${typed.join(" and ")}$`, "m"),
    );
    assert.match(stdout, /^  FORTRIP_API_URL +API base URL \(default https:\/\/api\.fortrip\.ai\)$/m);
    assert.match(flat(stdout), /Output is compact text on stdout; --json prints it as one line of JSON\./);
    assert.doesNotMatch(stdout, /FORTRIP_CURRENCY\b/);
  });

  it("no help names an API path", async () => {
    for (const args of [["--help"], ["hotels", "offers", "--help"], ["hotels", "book", "--help"]]) {
      assert.doesNotMatch((await cli(args)).stdout, /\/api\/|\/v1\//);
    }
  });
});

describe("renamed commands", () => {
  it("2.x hotels rates is gone: exit 2, naming hotels offers", async () => {
    const { code, stdout, stderr } = await cli(["hotels", "rates", "--hotel", "1"]);
    assert.equal(code, 2);
    assert.equal(stdout, "");
    assert.equal(stderr, 'Error: Unknown command "hotels rates". Did you mean `fortrip hotels offers`?\n');
    assert.equal(requests.length, 0);
  });

  it("1.x commands typed without their group name the 3.0 command", async () => {
    for (const [old, now] of [
      ["search", "`fortrip hotels search`"],
      ["hotel", "`fortrip hotels get`"],
      ["rates", "`fortrip hotels offers`"],
      ["book", "`fortrip hotels book`"],
      ["get", "`fortrip hotels get` or `fortrip orders get`"],
      ["list", "`fortrip orders list`"],
    ]) {
      const { code, stdout, stderr } = await cli([old as string, "x"]);
      assert.equal(code, 2, old);
      assert.equal(stdout, "", old);
      assert.equal(stderr, `Error: Unknown command "${old}". Did you mean ${now}?\n`);
    }
    assert.equal(requests.length, 0);
  });

  it("any other unknown command points at the help", async () => {
    for (const name of ["nope", "hotelz", "constructor", "toString"]) {
      const { code, stderr } = await cli([name]);
      assert.equal(code, 2, name);
      assert.equal(stderr, `Error: Unknown command "${name}". Run \`fortrip --help\`.\n`, name);
    }
  });

  it("an unknown command in a group is exit 2, pointing at the group's help", async () => {
    for (const [group, name] of [
      ["hotels", "nope"],
      ["hotels", "login"],
      ["orders", "cancel"],
    ]) {
      const { code, stderr } = await cli([group as string, name as string]);
      assert.equal(code, 2, `${group} ${name}`);
      assert.equal(stderr, `Error: Unknown command "${group} ${name}". Run \`fortrip ${group} --help\`.\n`);
    }
    assert.equal(requests.length, 0);
  });
});

describe("other commands", () => {
  it("mcp takes no arguments and exits 2", async () => {
    const { code, stderr } = await cli(["mcp", "extra"]);
    assert.equal(code, 2);
    assert.match(stderr, /mcp takes no arguments/);
  });

  it("--version and -v print the version", async () => {
    for (const flag of ["--version", "-v"]) {
      const { code, stdout } = await cli([flag]);
      assert.equal(code, 0);
      assert.match(stdout, /^\d+\.\d+\.\d+/);
    }
  });
});
