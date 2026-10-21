import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);

/** What the fake bookings endpoint answers next. */
let reply: { status: number; body: unknown };
let server: Server;
let apiUrl: string;

before(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function cli(args: string[]) {
  const env = {
    ...process.env,
    FORTRIP_API_URL: apiUrl,
    FORTRIP_TOKEN: `fth_${"x".repeat(43)}`,
    XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), "fortrip-cli-")),
  };
  return run(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { env }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }) => error,
  );
}

const BOOK = [
  "book",
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
];

const STRIPE = `https://checkout.stripe.com/c/pay/cs_test_1#${"f".repeat(300)}`;

describe("book links", () => {
  it("old server: absolute links, and the status page instead of the Stripe link", async () => {
    reply = {
      status: 200,
      body: {
        success: true,
        data: {
          agentOrderId: "ao_1",
          paymentUrl: STRIPE,
          amount: 120.5,
          currency: "USD",
          orderUrl: "/orders/ao_1",
          statusUrl: "/booking-status?session_id=cs_test_1",
          terms: null,
        },
      },
    };
    const { code, stdout } = await cli(BOOK);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.paymentUrl, `${apiUrl}/booking-status?session_id=cs_test_1`);
    assert.equal(data.statusUrl, `${apiUrl}/booking-status?session_id=cs_test_1`);
    assert.equal(data.orderUrl, `${apiUrl}/orders/ao_1`);
    assert.equal(data.amount, 120.5);
  });

  it("old server without a session keeps the Stripe link", async () => {
    reply = {
      status: 200,
      body: {
        success: true,
        data: { paymentUrl: STRIPE, orderUrl: "/orders/ao_1" },
      },
    };
    const data = JSON.parse((await cli(BOOK)).stdout);
    assert.equal(data.paymentUrl, STRIPE);
    assert.equal(data.orderUrl, `${apiUrl}/orders/ao_1`);
  });

  it("current server: links and stay pass through unchanged", async () => {
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
    assert.deepEqual(JSON.parse((await cli(BOOK)).stdout), data);
  });

  it("a 409 for a stay already booked has absolute links on stderr", async () => {
    reply = {
      status: 409,
      body: {
        success: false,
        error: "This stay already has a paid or completed booking.",
        reason: "already_booked",
        agentOrderId: "ao_1",
        orderUrl: "/orders/ao_1",
        statusUrl: "/booking-status?session_id=cs_test_1",
      },
    };
    const { code, stderr } = await cli(BOOK);
    assert.equal(code, 1);
    assert.deepEqual(JSON.parse(stderr), {
      error: "This stay already has a paid or completed booking.",
      exitCode: 1,
      status: 409,
      reason: "already_booked",
      agentOrderId: "ao_1",
      orderUrl: `${apiUrl}/orders/ao_1`,
      statusUrl: `${apiUrl}/booking-status?session_id=cs_test_1`,
    });
  });
});
