import assert from "node:assert/strict";
import { test } from "node:test";

import { LIMITS, RATE_LIMITS } from "@fortrip/agent-contract";

import { failClosedClause, limitRows, rateLimitRows } from "../lib/reference/limits.ts";

test("the limits table reads every limit the contract defines", () => {
  const read = new Set<string>();
  const watched = new Proxy(LIMITS, {
    get(limits, key: keyof typeof LIMITS) {
      read.add(key);
      return limits[key];
    },
  });
  limitRows(watched);
  assert.deepEqual(
    Object.keys(LIMITS).filter((key) => !read.has(key)),
    [],
    "a limit missing from the table",
  );
});

test("each limit row says what it limits and shows its value", () => {
  for (const [name, value, description] of limitRows(LIMITS)) {
    assert.ok(name && description, name);
    assert.match(value, /\d/, name);
    assert.doesNotMatch(name, /^[a-z]+[A-Z]/, `${name} is a label, not a key`);
  }
  const row = (name: string) => limitRows(LIMITS).find(([label]) => label === name);
  assert.equal(row("Nights per stay")?.[1], "15");
  assert.equal(row("Search radius")?.[1], "1–80,000 m, default 8,000 m");
  assert.equal(row("Token payment")?.[1], "up to $500");
  assert.equal(row("WeChat Pay code")?.[1], "120 minutes");
  assert.equal(row("Time left to pay")?.[1], `${LIMITS.payCutoffMinutes} minutes`);
  assert.equal(row("Orders per stay")?.[1], String(LIMITS.ordersPerStay));
});

test("the rate limits are the contract's, one row per scope, per minute", () => {
  assert.deepEqual(
    rateLimitRows().map(({ scope, perMinute }) => [scope, perMinute]),
    Object.entries(RATE_LIMITS).map(([scope, { limit }]) => [scope, limit]),
  );
  assert.deepEqual(
    rateLimitRows().map(({ scope, perMinute }) => [scope, perMinute]),
    [
      ["search", 10],
      ["offers", 20],
      ["hotel", 30],
      ["orders_create", 20],
      ["orders_read", 60],
      ["orders_cancel", 10],
      ["orders_pay", 10],
    ],
  );
  const operations = Object.fromEntries(
    rateLimitRows().map(({ scope, operations }) => [scope, operations]),
  );
  assert.deepEqual(operations.orders_read, ["get_order", "list_orders"]);
  assert.deepEqual(operations.orders_create, ["book_hotel"]);
  assert.deepEqual(operations.orders_cancel, ["cancel_order"]);
  assert.deepEqual(operations.orders_pay, ["pay_order"]);
  assert.equal(rateLimitRows().find((row) => row.scope === "orders_create")?.failClosed, true);
});

test("every HTTP tool counts against exactly one scope", () => {
  const counted = rateLimitRows().flatMap((row) => row.operations);
  assert.equal(new Set(counted).size, counted.length);
  assert.deepEqual(
    [...counted].sort(),
    [
      "book_hotel",
      "cancel_order",
      "get_hotel",
      "get_hotel_offers",
      "get_order",
      "list_orders",
      "pay_order",
      "search_hotels",
    ],
  );
});

test("the errors page names every operation refused while the limiter is down", () => {
  assert.equal(
    failClosedClause(),
    "order creation, order cancellations and order payments, which answer",
  );
});
