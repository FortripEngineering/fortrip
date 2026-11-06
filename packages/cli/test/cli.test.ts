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
  ERROR_CODES,
  errorEnvelope,
  GLOBAL_FLAGS,
  type RenderedTool,
  renderError,
  renderToolResult,
  strictOutput,
} from "@fortrip/agent-contract";

import { terminalQr } from "../src/qr.ts";

const run = promisify(execFile);

/** What the fake API answers next, and every request it has received. */
let reply: { status: number; body: unknown; headers?: Record<string, string> };
/** Answers for the next requests, in order; `reply` answers the rest. */
let replies: (typeof reply)[];
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
      const answer = replies.shift() ?? reply;
      res.writeHead(answer.status, { "content-type": "application/json", ...answer.headers });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
beforeEach(() => {
  requests = [];
  replies = [];
  reply = { status: 200, body: {} };
});

const TOKEN = `fth_${"x".repeat(43)}`;

/** A preload that makes the spawned CLI's stdout a 200-column TTY. */
const WIDE_TTY = "data:text/javascript,Object.assign(process.stdout,{isTTY:true,columns:200})";

async function cli(args: string[], extraEnv: NodeJS.ProcessEnv = {}, preload: string[] = []) {
  const env = {
    ...process.env,
    FORTRIP_API_URL: apiUrl,
    FORTRIP_TOKEN: TOKEN,
    FORTRIP_CURRENCY: "",
    XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), "fortrip-cli-")),
    ...extraEnv,
  };
  const imports = [...preload, "tsx"].flatMap((module) => ["--import", module]);
  return run(process.execPath, [...imports, "src/cli.ts", ...args], { env }).then(
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
      [["orders", "cancel", ORDER, "--max-penalty", "12.5"], "POST", `/v1/orders/${ORDER}/cancel`],
      [["orders", "pay", ORDER, "--token", "spt_1TestToken0123456789", "--total", "125.00"], "POST", `/v1/orders/${ORDER}/pay`],
    ] as const) {
      requests = [];
      // orders pay and orders cancel read the order for its currency first, then post.
      const pays = args[1] === "pay" || args[1] === "cancel";
      const read = args[1] === "pay" ? "order-awaiting-payment" : "order-confirmed";
      if (pays) replies = [{ status: 200, body: (await fixture(read)).data }, reply];
      const { code, stderr } = await cli([...args]);
      assert.equal(code, 0, `${args.join(" ")}: ${stderr}`);
      assert.equal(requests.length, pays ? 2 : 1, args.join(" "));
      if (pays) assert.equal(requests[0]?.method, "GET", args.join(" "));
      const sent = requests[pays ? 1 : 0];
      assert.equal(sent?.method, method, args.join(" "));
      assert.equal(sent?.url, url, args.join(" "));
      assert.equal(sent?.authorization, `Bearer ${TOKEN}`);
      assert.equal(sent?.body === undefined, method === "GET", args.join(" "));
    }
  });

  it("orders cancel posts only the penalty the user agreed to, in the order's currency, the order in the path", async () => {
    replies = [{ status: 200, body: (await fixture("order-confirmed")).data }, reply];
    const { code, stderr } = await cli(["orders", "cancel", ORDER, "--max-penalty", "12.5"]);
    assert.equal(code, 0, stderr);
    assert.equal(requests.length, 2);
    assert.equal(requests[1]?.url, API.orderCancel(ORDER));
    assert.deepEqual(requests[1]?.body, { maximumPenalty: { amount: "12.5", currency: "USD" } });
  });

  it("orders cancel --max-penalty takes cancel.penalty's currency, else price.total's, else sends nothing", async () => {
    const order = structuredClone((await fixture("order-confirmed")).data) as Record<string, any>;
    order.cancel.penalty = { amount: "12.50", currency: "CNY" };
    order.price.total = { amount: "880.00", currency: "CNY" };
    replies = [{ status: 200, body: order }, reply];
    const cny = await cli(["orders", "cancel", ORDER, "--max-penalty", "12.50"]);
    assert.equal(cny.code, 0, cny.stderr);
    assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), [`GET ${API.order(ORDER)}`, `POST ${API.orderCancel(ORDER)}`]);
    assert.deepEqual(requests[1]?.body, { maximumPenalty: { amount: "12.50", currency: "CNY" } });

    requests = [];
    order.cancel.penalty = null;
    replies = [{ status: 200, body: order }, reply];
    assert.equal((await cli(["orders", "cancel", ORDER, "--max-penalty", "12.50"])).code, 0);
    assert.deepEqual(requests[1]?.body, { maximumPenalty: { amount: "12.50", currency: "CNY" } });

    requests = [];
    delete order.price.total.currency;
    replies = [{ status: 200, body: order }, reply];
    const none = await cli(["orders", "cancel", ORDER, "--max-penalty", "12.50"]);
    assert.equal(none.code, 1);
    assert.match(none.stderr, /currency/);
    assert.deepEqual(requests.map((r) => r.method), ["GET"]);
  });

  it("orders cancel --close with --max-penalty exits 2 and sends nothing", async () => {
    const { code, stderr } = await cli(["orders", "cancel", ORDER, "--close", "--max-penalty", "0.00"]);
    assert.equal(code, 2);
    assert.match(stderr, /--close/);
    assert.match(stderr, /--max-penalty/);
    assert.equal(requests.length, 0);
  });

  // C7: never a cancellation without the penalty the user agreed to.
  it("orders cancel without --max-penalty reads the order, prints its stay and Cancel lines, the consent step, and exits 2", async () => {
    const { data } = await fixture("order-confirmed");
    reply = { status: 200, body: data };
    const hotelLine = renderToolResult("get_order", data, "cli")
      .split("\n")
      .find((line) => line.startsWith("Hotel: "));
    assert.ok(hotelLine);
    const { code, stdout, stderr } = await cli(["orders", "cancel", ORDER]);
    assert.equal(code, 2);
    assert.equal(stdout, "");
    assert.equal(
      stderr,
      [
        "Error: Not cancelled: nothing was sent.",
        hotelLine,
        "Cancel: can cancel now: penalty USD 120.00, refund USD 246.00",
        `Show the user the stay, this penalty and this refund, and ask them to confirm. Only after a clear yes, run \`fortrip orders cancel ${ORDER} --max-penalty 120.00\`.`,
        "",
      ].join("\n"),
    );
    assert.deepEqual(
      requests.map((r) => `${r.method} ${r.url}`),
      [`GET ${API.order(ORDER)}`],
    );
    const json = JSON.parse((await cli(["orders", "cancel", ORDER, "--json"])).stderr);
    assert.equal(json.error.code, "invalid_request");
    assert.match(json.error.message, /Only after a clear yes, run `fortrip orders cancel ord_\w+ --max-penalty 120\.00`\.$/);
    assert.ok(requests.every((r) => r.method === "GET"));
  });

  it("orders cancel without --max-penalty on an unpaid order says it can be closed, and the --close command", async () => {
    const { data } = await fixture("order-awaiting-payment");
    reply = { status: 200, body: data };
    const { code, stderr } = await cli(["orders", "cancel", ORDER]);
    assert.equal(code, 2);
    assert.equal(
      stderr,
      [
        "Error: Not cancelled: nothing was sent.",
        renderToolResult("get_order", data, "cli").split("\n").find((line) => line.startsWith("Hotel: ")),
        "Cancel: can be closed now, nothing is charged; close it only if the user says they no longer want it (run `fortrip orders cancel <orderId> --close`)",
        `Only once the user says they no longer want this order, run \`fortrip orders cancel ${ORDER} --close\`.`,
        "",
      ].join("\n"),
    );
    assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), [`GET ${API.order(ORDER)}`]);
  });

  it("orders cancel --max-penalty on an unpaid order exits 2 naming --close, and posts nothing", async () => {
    reply = { status: 200, body: (await fixture("order-awaiting-payment")).data };
    const { code, stderr } = await cli(["orders", "cancel", ORDER, "--max-penalty", "0.00"]);
    assert.equal(code, 2);
    assert.match(stderr, new RegExp(`run \`fortrip orders cancel ${ORDER} --close\``));
    assert.deepEqual(requests.map((r) => r.method), ["GET"]);
  });

  it("orders cancel --close closes an unpaid order: one read, then the close", async () => {
    const { data } = await fixture("order-awaiting-payment");
    const closed = structuredClone(data) as Record<string, any>;
    closed.status = "expired";
    closed.payment.url = null;
    closed.payment.expiresAt = null;
    closed.cancel = { available: false, reason: "not_confirmed", penalty: null, refund: null };
    replies = [{ status: 200, body: data }, { status: 200, body: closed }];
    const { code, stdout, stderr } = await cli(["orders", "cancel", ORDER, "--close"]);
    assert.equal(code, 0, stderr);
    assert.equal(stdout, `${renderToolResult("cancel_order", closed, "cli")}\n`);
    assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), [`GET ${API.order(ORDER)}`, `POST ${API.orderCancel(ORDER)}`]);
    assert.deepEqual(requests[1]?.body, {});
  });

  it("orders cancel --close answered with an order that isn't expired: not closed, it was paid meanwhile", async () => {
    const { data } = await fixture("order-awaiting-payment");
    const paid = (await fixture("order-confirmed")).data;
    replies = [{ status: 200, body: data }, { status: 200, body: paid }];
    const { code, stdout, stderr } = await cli(["orders", "cancel", ORDER, "--close"]);
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.ok(stderr.startsWith("Error: Not closed: it was paid meanwhile.\n"), stderr);
    assert.ok(stderr.includes(renderToolResult("cancel_order", paid, "cli")), stderr);
  });

  it("orders cancel --close answered payment_in_progress prints that error and exits 1", async () => {
    const { data } = await fixture("order-awaiting-payment");
    const envelope = {
      error: {
        code: "payment_in_progress",
        message: "A payment of this order is under way.",
        retryable: true,
        requestId: "req_1",
        details: { orderId: ORDER },
      },
    };
    strictOutput(errorEnvelope).parse(envelope);
    replies = [{ status: 200, body: data }, { status: 409, body: envelope }];
    const { code, stdout, stderr } = await cli(["orders", "cancel", ORDER, "--close"]);
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.ok(stderr.startsWith(renderError(envelope, undefined, "cli")), stderr);
    assert.doesNotMatch(stderr, /\bclosed\b/i);
    assert.equal(requests.length, 2);
  });

  it("orders cancel --close on an expired order prints it and exits 0, closing nothing", async () => {
    const order = structuredClone((await fixture("order-awaiting-payment")).data) as Record<string, any>;
    order.status = "expired";
    order.payment.url = null;
    order.payment.expiresAt = null;
    order.cancel = { available: false, reason: "not_confirmed", penalty: null, refund: null };
    reply = { status: 200, body: order };
    const { code, stdout, stderr } = await cli(["orders", "cancel", ORDER, "--close"]);
    assert.equal(code, 0, stderr);
    assert.equal(stdout, `${renderToolResult("cancel_order", order, "cli")}\n`);
    assert.deepEqual(requests.map((r) => r.method), ["GET"]);
  });

  it("orders cancel --close on an unpaid order it can't close prints its Cancel line and exits 1", async () => {
    const order = structuredClone((await fixture("order-awaiting-payment")).data) as Record<string, any>;
    order.cancel = { available: false, reason: "not_confirmed", penalty: null, refund: null };
    for (const [requiresSignIn, line] of [
      [true, "Cancel: not needed: an unpaid order expires unpaid at 2026-11-01 12:50 UTC"],
      [false, "Cancel: not now: a payment is under way; read the order again shortly"],
    ] as const) {
      requests = [];
      order.payment.requiresSignIn = requiresSignIn;
      reply = { status: 200, body: order };
      const { code, stdout, stderr } = await cli(["orders", "cancel", ORDER, "--close"]);
      assert.equal(code, 1, line);
      assert.equal(stdout, "");
      assert.match(stderr, /^Error: Not closed: nothing was sent\.\n/);
      assert.ok(stderr.includes(`\n${line}\n`), stderr);
      assert.deepEqual(requests.map((r) => r.method), ["GET"]);
    }
  });

  it("orders cancel --close on a paid order that can't be cancelled prints its Cancel line, exits 1, and offers no --max-penalty", async () => {
    const order = structuredClone((await fixture("order-confirmed")).data) as Record<string, any>;
    order.cancel = { available: false, reason: "non_refundable", penalty: null, refund: null };
    reply = { status: 200, body: order };
    const { code, stdout, stderr } = await cli(["orders", "cancel", ORDER, "--close"]);
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /^Error: Not closed: nothing was sent\.\n/);
    assert.ok(stderr.includes("\nCancel: not available: this rate can't be cancelled\n"), stderr);
    assert.doesNotMatch(stderr, /--max-penalty/);
    assert.deepEqual(requests.map((r) => r.method), ["GET"]);
  });

  it("orders cancel --close answered invalid_request (paid meanwhile) exits 2 and never says closed", async () => {
    const { data } = await fixture("order-awaiting-payment");
    const envelope = {
      error: {
        code: "invalid_request",
        message: "This order is paid: cancel it under its terms with maximumPenalty.",
        retryable: false,
        requestId: "req_1",
        details: { issues: [] },
      },
    };
    strictOutput(errorEnvelope).parse(envelope);
    replies = [{ status: 200, body: data }, { status: 400, body: envelope }];
    const { code, stdout, stderr } = await cli(["orders", "cancel", ORDER, "--close"]);
    assert.equal(code, 2);
    assert.equal(stdout, "");
    assert.ok(stderr.startsWith(renderError(envelope, undefined, "cli")), stderr);
    assert.doesNotMatch(stderr, /\bclosed\b/i);
    assert.equal(requests.length, 2);
  });

  it("orders cancel --close on a paid order exits 2 naming --max-penalty, and posts nothing", async () => {
    reply = { status: 200, body: (await fixture("order-confirmed")).data };
    const { code, stderr } = await cli(["orders", "cancel", ORDER, "--close"]);
    assert.equal(code, 2);
    assert.equal(
      stderr,
      `Error: Not closed: the order is paid. To cancel it under its terms, show the user cancel.penalty and, once they agree, run \`fortrip orders cancel ${ORDER} --max-penalty <amount>\`.\n`,
    );
    assert.deepEqual(requests.map((r) => r.method), ["GET"]);
  });

  it("orders cancel without --max-penalty on an order not in the contract's shape still refuses, and offers no flag", async () => {
    const { data } = await fixture("order-confirmed");
    const { cancel: _, ...noCancel } = data as Record<string, unknown>;
    reply = { status: 200, body: noCancel };
    const { code, stderr } = await cli(["orders", "cancel", ORDER]);
    assert.equal(code, 2);
    assert.match(stderr, /^Error: Not cancelled: nothing was sent\.\n/);
    assert.match(stderr, /fortrip orders cancel needs --max-penalty, the penalty the user agreed to\./);
    assert.doesNotMatch(stderr, /Only after a clear yes/);
    assert.ok(requests.every((r) => r.method === "GET"));
  });

  it("orders cancel without --max-penalty sends nothing for a bad order id, and passes on the read's error", async () => {
    const bad = await cli(["orders", "cancel", "ao_1"]);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /\/path\/orderId/);
    assert.equal(requests.length, 0);
    reply = {
      status: 404,
      body: { error: { code: "not_found", message: "No such order.", retryable: false, requestId: "req_1" } },
    };
    const missing = await cli(["orders", "cancel", ORDER]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /^Error not_found/);
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

  it("FORTRIP_CURRENCY is the default currency", async () => {
    await cli(OFFERS, { FORTRIP_CURRENCY: "cny" });
    assert.equal((requests[0]?.body as { currency?: string }).currency, "CNY");
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

  it("orders pay without --token exits 2 and sends nothing", async () => {
    const { code, stdout, stderr } = await cli(["orders", "pay", ORDER, "--total", "125.00"]);
    assert.equal(code, 2);
    assert.equal(stdout, "");
    assert.equal(
      stderr,
      [
        "Error: Not sent: fortrip orders pay was given an invalid request.",
        "- /sharedPaymentToken: sharedPaymentToken must be a Stripe shared payment token: spt_ followed by letters and digits",
        "",
      ].join("\n"),
    );
    assert.equal(requests.length, 0);
  });

  it("orders pay --total takes the order's currency", async () => {
    const { data } = await fixture("order-awaiting-payment");
    const order = structuredClone(data) as { price: { total: Record<string, unknown> } };
    order.price.total = { amount: "880.00", currency: "CNY" };
    replies = [{ status: 200, body: order }, { status: 200, body: {} }];
    const { code, stderr } = await cli(["orders", "pay", ORDER, "--total", "880.00", "--token", "spt_abc"]);
    assert.equal(code, 0, stderr);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.method, "GET");
    assert.equal(requests[0]?.url, API.order(ORDER));
    assert.equal(requests[1]?.method, "POST");
    assert.equal(requests[1]?.url, `/v1/orders/${ORDER}/pay`);
    assert.deepEqual(requests[1]?.body, {
      sharedPaymentToken: "spt_abc",
      total: { amount: "880.00", currency: "CNY" },
    });
  });

  it("orders pay with a bad --token exits 2 before reading the order", async () => {
    const { code } = await cli(["orders", "pay", ORDER, "--total", "880.00", "--token", "tok_1"]);
    assert.equal(code, 2);
    assert.equal(requests.length, 0);
  });

  it("orders pay on an order without a price currency exits 1 and posts nothing", async () => {
    replies = [{ status: 200, body: { id: ORDER } }, { status: 200, body: {} }];
    const { code, stderr } = await cli(["orders", "pay", ORDER, "--total", "880.00", "--token", "spt_abc"]);
    assert.equal(code, 1);
    assert.match(stderr, /currency/);
    assert.deepEqual(requests.map((request) => request.method), ["GET"]);
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
      [["orders", "cancel", ORDER, "--max-penalty", "120.00"], "cancel-order"],
    ] as const) {
      const { tool, data } = await fixture(name);
      reply = { status: 200, body: data };
      const { code, stdout, stderr } = await cli([...args]);
      assert.equal(code, 0, stderr);
      assert.equal(stdout, `${renderToolResult(tool, data, "cli")}\n`, name);
      assert.equal(stderr, "", name);
    }
  });

  it("an order with a payment link ends with the consent rule", async () => {
    const { data } = await fixture("order-awaiting-payment");
    reply = { status: 201, body: data };
    const { stdout } = await cli(BOOK);
    assert.match(stdout, /Only after they say yes, give them payment\.url exactly as returned\.\n$/);
  });

  it("orders pay --method stripe_alipay_wechat_pay prints the links and, on a wide TTY, the entry's code", async () => {
    const { data } = await fixture("order-wallets-open");
    const read = { status: 200, body: (await fixture("order-awaiting-payment")).data };
    const args = ["orders", "pay", ORDER, "--method", "stripe_alipay_wechat_pay", "--total", "365.00"];
    replies = [read, { status: 200, body: data }];
    // The spawned CLI has no TTY, so the code stays out and the links stay in.
    const { code, stdout, stderr } = await cli(args);
    assert.equal(code, 0, stderr);
    assert.deepEqual(requests[1]?.body, {
      method: "stripe_alipay_wechat_pay",
      total: { amount: "365.00", currency: "USD" },
    });
    assert.match(stdout, /https:\/\/fortrip\.ai\/pay\/ord_BundAwaiting00000000\/wechat/);
    assert.match(stdout, /https:\/\/fortrip\.ai\/pay\/ord_BundAwaiting00000000\/alipay/);
    assert.ok(!stdout.includes("█"));
    // On a wide TTY, the code drawn is the wallet entry's wechatPay.qrData.
    const { qrData } = (data as { payment: { methods: { wechatPay: { qrData: string } }[] } }).payment.methods[0]!
      .wechatPay;
    replies = [read, { status: 200, body: data }];
    const tty = await cli(args, {}, [WIDE_TTY]);
    assert.equal(tty.code, 0, tty.stderr);
    assert.ok(tty.stdout.endsWith(`\nOr scan this WeChat Pay code:\n${terminalQr(qrData, 200)}\n`), tty.stdout);
  });

  it("orders pay --wallet is no flag: it exits 2 and sends nothing", async () => {
    const { code, stdout, stderr } = await cli(["orders", "pay", ORDER, "--wallet", "--total", "365.00"]);
    assert.equal(code, 2);
    assert.equal(stdout, "");
    assert.match(stderr, /--wallet/);
    assert.equal(requests.length, 0);
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
    assert.equal(stdout, `${renderToolResult("get_order", { unexpected: true }, "cli")}\n`);
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
      assert.equal(stderr, `${renderError(envelope, undefined, "cli")}\n`, name);
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

  it("the CLI's own error is text on stderr, or { error: { code, message, retryable, requestId, details } } with --json", async () => {
    const text = await cli(["hotels", "search", "--nope"]);
    assert.equal(text.code, 2);
    assert.match(text.stderr, /^Error: Unknown option '--nope'/);
    const json = await cli(["hotels", "search", "--nope", "--json"]);
    assert.equal(json.code, 2);
    const { error } = JSON.parse(json.stderr);
    assert.deepEqual(Object.keys(error), ["code", "message", "retryable", "requestId", "details"]);
    assert.match(error.requestId, /^local_[0-9a-f]{20}$/);
    assert.equal(error.code, "invalid_request");
    assert.match(error.message, /Unknown option '--nope'/);
    assert.equal(error.retryable, false);
    assert.deepEqual(error.details, { issues: [] });
    assert.equal(requests.length, 0);
  });

  it("with --json, the CLI's own errors are envelope-shaped, its facts beside the error", async () => {
    const usage = JSON.parse((await cli(["hotels", "nope", "--json"])).stderr);
    assert.match(usage.error.requestId, /^local_[0-9a-f]{20}$/);
    assert.deepEqual(usage, {
      error: {
        code: "invalid_request",
        message: 'Unknown command "hotels nope". Run `fortrip hotels --help`.',
        retryable: false,
        requestId: usage.error.requestId,
        details: { issues: [] },
      },
    });
    const unsendable = await cli(["whoami", "--json"], { FORTRIP_TOKEN: "a\nb" });
    assert.equal(unsendable.code, 3);
    const signIn = JSON.parse(unsendable.stderr);
    assert.equal(signIn.error.code, "unauthenticated");
    assert.equal(signIn.error.retryable, false);
    assert.equal(signIn.tokenSource, "FORTRIP_TOKEN");
    const down = JSON.parse((await cli(["orders", "list", "--json"], { FORTRIP_API_URL: "http://127.0.0.1:1" })).stderr);
    assert.equal(down.error.code, "service_unavailable");
    assert.equal(down.error.retryable, true);
    const badDir = JSON.parse(
      (await cli(["orders", "list", "--json"], { FORTRIP_TOKEN: "", XDG_CONFIG_HOME: "/dev/null/nope" })).stderr,
    );
    assert.equal(badDir.error.code, "cli_error");
    assert.equal(badDir.error.retryable, false);
    assert.equal(requests.length, 0);
  });

  it("every local --json error is the contract's envelope, closed for a code the contract knows", async () => {
    const runs = [
      await cli(["hotels", "search", "--nope", "--json"]),
      await cli(["hotels", "nope", "--json"]),
      await cli(["hotels", "offers", "--hotel", "1", ...STAY, "--room", "2", "--json"]),
      await cli(["whoami", "--json"], { FORTRIP_TOKEN: "a\nb" }),
      await cli(["orders", "list", "--json"], { FORTRIP_API_URL: "http://127.0.0.1:1" }),
      await cli(["orders", "list", "--json"], { FORTRIP_TOKEN: "", XDG_CONFIG_HOME: "/dev/null/nope" }),
    ];
    // Answers that aren't Fortrip's envelope.
    for (const status of [400, 401, 429, 502]) {
      reply = { status, body: { error: "not the envelope" }, headers: { "retry-after": "7" } };
      runs.push(await cli([...SEARCH, "--json"]));
    }
    for (const { stderr } of runs) {
      const { error } = JSON.parse(stderr);
      const schema = Object.hasOwn(ERROR_CODES, error.code) ? strictOutput(errorEnvelope) : errorEnvelope;
      const parsed = schema.safeParse({ error });
      assert.ok(parsed.success, `${stderr}${JSON.stringify(parsed.error?.issues)}`);
    }
  });

  it("a 429 that isn't Fortrip's envelope exits 4 as service_unavailable, retryable after Retry-After", async () => {
    reply = { status: 429, body: null, headers: { "retry-after": "7" } };
    const { code, stderr } = await cli([...SEARCH, "--json"]);
    assert.equal(code, 4);
    const { error } = JSON.parse(stderr);
    assert.equal(error.code, "service_unavailable");
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterSeconds, 7);
    assert.equal(error.details, undefined);
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
      assert.equal(printed.error.retryable, false);
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
  it("prints the account as text, or as JSON with --json", async () => {
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

  it("--help states the output, the base URL and FORTRIP_CURRENCY's commands", async () => {
    const typed = COMMANDS.filter((spec) => spec.flags.some((flag) => flag.field === "currency")).map(
      (spec) => commandInvocation(spec).replace(/^fortrip /, ""),
    );
    assert.deepEqual(typed, ["hotels search", "hotels offers"]);
    const { stdout } = await cli(["--help"]);
    assert.match(
      stdout,
      new RegExp(`^  FORTRIP_CURRENCY +Default --currency for ${typed.join(" and ")}$`, "m"),
    );
    assert.match(stdout, /^  FORTRIP_API_URL +API base URL \(default https:\/\/api\.fortrip\.ai\)$/m);
    assert.match(
      stdout,
      /^  FORTRIP_MCP_URL +MCP server URL for fortrip mcp \(default https:\/\/mcp\.fortrip\.ai\/\)$/m,
    );
    assert.match(flat(stdout), /Output is compact text on stdout; --json prints it as one line of JSON\./);
  });

  it("no help names an API path", async () => {
    for (const args of [["--help"], ["hotels", "offers", "--help"], ["hotels", "book", "--help"]]) {
      assert.doesNotMatch((await cli(args)).stdout, /\/api\/|\/v1\//);
    }
  });
});

describe("unknown commands", () => {
  it("a group's command typed without its group names the command", async () => {
    for (const [typed, meant] of [
      ["search", "`fortrip hotels search`"],
      ["book", "`fortrip hotels book`"],
      ["get", "`fortrip hotels get` or `fortrip orders get`"],
      ["list", "`fortrip orders list`"],
    ]) {
      const { code, stdout, stderr } = await cli([typed as string, "x"]);
      assert.equal(code, 2, typed);
      assert.equal(stdout, "", typed);
      assert.equal(stderr, `Error: Unknown command "${typed}". Did you mean ${meant}?\n`);
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
      ["orders", "refund"],
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
