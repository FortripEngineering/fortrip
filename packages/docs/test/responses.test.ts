import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ERROR_CODES, type ErrorCode, errorEnvelope, LIMITS, order, strictOutput } from "@fortrip/agent-contract";

import { OPERATIONS } from "../lib/openapi/build.ts";
import { abridge, ERRORS, EXAMPLE_IDS, PAY_RESPONSES, RESPONSES } from "../lib/reference/responses.ts";

const body = (name: string) =>
  JSON.parse(readFileSync(new URL(`../examples/bodies/${name}.json`, import.meta.url), "utf8"));

describe("example responses", () => {
  it("has one per operation, each valid under the operation's strict output schema", () => {
    assert.deepEqual(Object.keys(RESPONSES).sort(), OPERATIONS.map((op) => op.id).sort());
    for (const op of OPERATIONS) {
      const result = strictOutput(op.output).safeParse(RESPONSES[op.id as keyof typeof RESPONSES]);
      assert.ok(result.success, `${op.id}: ${JSON.stringify(result.error?.issues)}`);
    }
    for (const [name, answer] of Object.entries(PAY_RESPONSES)) {
      const result = strictOutput(order).safeParse(answer);
      assert.ok(result.success, `${name}: ${JSON.stringify(result.error?.issues)}`);
    }
  });

  it("has valid error envelopes, at a status their code is answered with", () => {
    for (const [code, { status, envelope }] of Object.entries(ERRORS)) {
      const result = strictOutput(errorEnvelope).safeParse(envelope);
      assert.ok(result.success, `${code}: ${JSON.stringify(result.error?.issues)}`);
      const spec = ERROR_CODES[code as ErrorCode];
      assert.equal(envelope.error.code, code);
      assert.ok(spec.status.includes(status), code);
      assert.equal(envelope.error.retryable, spec.retryable, code);
      assert.match(envelope.error.requestId, /^req_[0-9A-Za-z]{20}$/);
    }
  });

  it("every fixture file is used", () => {
    const files = readdirSync(new URL("../lib/reference/fixtures/", import.meta.url)).length;
    const used = new Set([...Object.values(RESPONSES), ...Object.values(PAY_RESPONSES), ...Object.values(ERRORS).map((e) => e.envelope)]);
    // list_orders and the inline errors are built in code, not read from a file.
    assert.equal(files, used.size - 3);
  });

  it("chain as the example requests do: search, offers, order, pay", () => {
    const { search_hotels: search, get_hotel_offers: offers, create_order: created } = RESPONSES;
    // The search answers the search request, and its first hotel is the one the offers ask for.
    assert.deepEqual(search.stay, body("search").stay);
    assert.equal(search.data[0]?.hotelId, EXAMPLE_IDS.hotelId);
    assert.deepEqual(body("offers").hotelIds, [EXAMPLE_IDS.hotelId]);
    assert.deepEqual(offers.stay, body("offers").stay);
    assert.equal(RESPONSES.get_hotel.hotelId, EXAMPLE_IDS.hotelId);
    // The order is of the first offer, at its total, for the order request's guests.
    const first = offers.hotels[0]?.offers[0];
    assert.equal(body("order").items[0].offerId, EXAMPLE_IDS.offerId);
    assert.equal(first?.offerId, EXAMPLE_IDS.offerId);
    assert.deepEqual(created.total, first?.total);
    assert.equal(created.items[0]?.hotel.hotelId, EXAMPLE_IDS.hotelId);
    // Every answer about the order is about the same order, at the total the pay requests send.
    for (const answer of [RESPONSES.get_order, RESPONSES.cancel_order, ...Object.values(PAY_RESPONSES)]) {
      assert.equal(answer.orderId, EXAMPLE_IDS.orderId);
      assert.deepEqual(answer.total, created.total);
    }
    assert.deepEqual(body("pay-token").total, created.total);
    assert.equal(created.status, "awaiting_payment");
    assert.ok(created.payment.url?.includes(EXAMPLE_IDS.orderId));
    // The changed offer is a new offer of the same hotel.
    const changed = ERRORS.offer_changed.envelope.error.details;
    assert.equal(changed.offer.hotelId, EXAMPLE_IDS.hotelId);
    assert.notEqual(changed.offer.offerId, EXAMPLE_IDS.offerId);
    assert.deepEqual(changed.changes[0]?.previous, first?.total);
    assert.deepEqual(changed.changes[0]?.current, changed.offer.total);
  });

  it("state the contract's numbers where they are its", () => {
    const destination = RESPONSES.search_hotels.destination;
    assert.equal(destination.radiusSource, "default");
    assert.equal(destination.radiusMeters, LIMITS.radiusMetersDefault);
    const { usageLimits } = RESPONSES.create_order.payment.tokenRequest;
    // A token is offered: the total is under the token cap, in cents, until the time to pay ends.
    assert.ok(Number(RESPONSES.create_order.total.amount) <= LIMITS.tokenPaymentMaxUsd);
    assert.equal(usageLimits.max_amount, Math.round(Number(RESPONSES.create_order.total.amount) * 100));
    assert.equal(usageLimits.expires_at, Date.parse(RESPONSES.create_order.payment.expiresAt) / 1000);
  });
});

describe("abridge", () => {
  const value = { a: 1, b: { c: 2, d: [{ e: 3, f: 4 }, { e: 5, f: 6 }] }, g: null };

  it("keeps the listed paths in the value's own order", () => {
    assert.deepEqual(abridge(value, ["g", "a"]), { a: 1, g: null });
    assert.deepEqual(abridge(value, ["b.d[0].e"]), { b: { d: [{ e: 3 }] } });
    assert.deepEqual(abridge(value, ["b.d[].f", "b.c"]), { b: { c: 2, d: [{ f: 4 }, { f: 6 }] } });
    assert.deepEqual(abridge(value, ["b.d[1]"]), { b: { d: [{ e: 5, f: 6 }] } });
  });

  it("throws on a path that leads nowhere", () => {
    assert.throws(() => abridge(value, ["b.x"]), /no b\.x/);
    assert.throws(() => abridge(value, ["b.d[2].e"]), /no b\.d\[2\]\.e/);
    assert.throws(() => abridge(value, ["a.b"]), /no a\.b/);
  });
});
