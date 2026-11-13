import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { z } from "zod";

import { ERROR_CODES, type ErrorCode } from "../src/errors.ts";
import { SUPPLIER_OUTCOME_STATUS } from "../src/index.ts";
import { ERROR_DETAILS } from "../src/outputs/error-details.ts";
import { API, MCP_PATH, PUBLIC_ORIGINS } from "../src/paths.ts";
import {
  CURRENCIES,
  LIMITS,
  SUPPORT_EMAIL,
} from "../src/limits.ts";

// Spec §11, row by row: code -> [statuses, retryable].
const SPEC: Record<ErrorCode, [number[], boolean]> = {
  invalid_request: [[400], false],
  cursor_invalid: [[400], false],
  unauthenticated: [[401], false],
  forbidden: [[403], false],
  not_found: [[404], false],
  offer_expired: [[409], false],
  offer_changed: [[409], false],
  offer_already_ordered: [[409], false],
  order_in_progress: [[409], true],
  cancellation_changed: [[409], false],
  order_not_cancellable: [[409], false],
  order_not_payable: [[409], false],
  payment_in_progress: [[409], true],
  payment_total_mismatch: [[409], false],
  payment_credential_invalid: [[422], false],
  payment_declined: [[402], false],
  payment_action_required: [[402], false],
  payment_method_unavailable: [[403], false],
  destination_ambiguous: [[422], false],
  destination_not_found: [[422], false],
  search_too_broad: [[422], false],
  stay_unsupported: [[422], false],
  stay_in_past: [[422], false],
  offer_unavailable: [[422], false],
  currency_unavailable: [[422], false],
  rate_limited: [[429], true],
  ordering_paused: [[503], true],
  service_unavailable: [[503], true],
  supplier_unavailable: [[503, 504], true],
  client_outdated: [[426], false],
  internal: [[500], false],
};

describe("ERROR_CODES", () => {
  it("has exactly the spec's codes", () => {
    assert.deepEqual(Object.keys(ERROR_CODES).sort(), Object.keys(SPEC).sort());
  });

  it("matches the spec's statuses and retryability row by row", () => {
    for (const [code, [status, retryable]] of Object.entries(SPEC)) {
      const got = ERROR_CODES[code as ErrorCode];
      assert.deepEqual([...got.status], status, code);
      assert.equal(got.retryable, retryable, code);
    }
  });
});

describe("currency_unavailable", () => {
  it("is a 422 whose details are the currency asked for", () => {
    assert.deepEqual(ERROR_CODES.currency_unavailable, { status: [422], retryable: false });
    assert.deepEqual(Object.keys(ERROR_DETAILS.currency_unavailable.shape), ["currency"]);
    assert.ok(ERROR_DETAILS.currency_unavailable.safeParse({ currency: "CNY" }).success);
    assert.ok(ERROR_DETAILS.currency_unavailable.safeParse({ currency: "EUR" }).success);
  });
});

describe("client_outdated", () => {
  it("is a 426 no retry can fix, with no details: its message is the whole of it", () => {
    assert.deepEqual(ERROR_CODES.client_outdated, { status: [426], retryable: false });
    assert.equal(ERROR_DETAILS.client_outdated, null);
  });
});

describe("payment_total_mismatch", () => {
  it("replaces payment_total_changed: the total sent is not the order's, which has not changed", () => {
    assert.ok(!("payment_total_changed" in ERROR_CODES));
    assert.deepEqual(ERROR_CODES.payment_total_mismatch, { status: [409], retryable: false });
    assert.deepEqual(Object.keys(ERROR_DETAILS.payment_total_mismatch.shape), ["orderId", "total"]);
  });
});

describe("SUPPLIER_OUTCOME_STATUS", () => {
  it("answers 503 when nothing was sent and 504 when the call timed out", () => {
    assert.deepEqual(SUPPLIER_OUTCOME_STATUS, { not_started: 503, unknown: 504 });
  });

  it("uses only supplier_unavailable's statuses, and covers every outcome it names", () => {
    for (const status of Object.values(SUPPLIER_OUTCOME_STATUS)) {
      assert.ok(ERROR_CODES.supplier_unavailable.status.includes(status), String(status));
    }
    // openEnum is a union of the known values and any string.
    const outcome = ERROR_DETAILS.supplier_unavailable.shape.outcome as unknown as z.ZodUnion<[z.ZodEnum, z.ZodString]>;
    const known = outcome._zod.def.options[0].options;
    assert.deepEqual(Object.keys(SUPPLIER_OUTCOME_STATUS).sort(), [...known].sort());
  });
});

describe("LIMITS and friends", () => {
  it("carries the v1 numbers", () => {
    assert.deepEqual(LIMITS, {
      rooms: 8,
      adultsPerRoom: 8,
      childrenPerRoom: 4,
      childAgeMax: 17,
      nightsFortrip: 30,
      nightsSupplier: 15,
      offersHotels: 15,
      offersPerHotelDefault: 15,
      offersPerHotelMax: 30,
      offersPerCallDefault: 45,
      offersPerCallMax: 100,
      pageSizeDefault: 20,
      pageSizeMax: 50,
      textLength: 128,
      radiusMetersMax: 80000,
      radiusMetersDefault: 8000,
      amenityFilters: 9,
      guestName: 60,
      contactName: 119,
      contactPhoneMin: 3,
      contactPhoneMax: 40,
      specialRequests: 500,
      poolLimit: 3000,
      candidatesShown: 8,
      candidatesCounted: 200,
      localitiesShown: 8,
      tokenPaymentMaxUsd: 500,
      payMinMinutesLeft: 15,
      payCutoffMinutes: 2,
      tokensPerOrder: 5,
    });
    assert.deepEqual([...CURRENCIES], ["USD", "CNY"]);
    assert.equal(SUPPORT_EMAIL, "info@fortrip.ai");
  });
});

describe("v1 paths", () => {
  it("builds the endpoints on the public origins", () => {
    assert.deepEqual(PUBLIC_ORIGINS, {
      api: "https://api.fortrip.ai",
      mcp: "https://mcp.fortrip.ai",
    });
    assert.equal(MCP_PATH, "/");
    assert.equal(API.me, "/v1/me");
    assert.equal(API.authConfig, "/v1/auth/config");
    assert.equal(API.hotelSearch, "/v1/hotels/search");
    assert.equal(API.hotelOffers, "/v1/hotels/offers");
    assert.equal(API.orders, "/v1/orders");
  });

  it("builds a hotel's and an order's path with optional query", () => {
    assert.equal(API.hotel("htl_x"), "/v1/hotels/htl_x");
    assert.equal(
      API.hotel("htl_x", { roomTypes: true, locale: "zh" }),
      "/v1/hotels/htl_x?include=roomTypes&locale=zh",
    );
    assert.equal(API.hotel("htl_x", { roomTypes: true }), "/v1/hotels/htl_x?include=roomTypes");
    assert.equal(API.hotel("htl_x", { locale: "en" }), "/v1/hotels/htl_x?locale=en");
    assert.equal(API.order("ord_x"), "/v1/orders/ord_x");
    assert.equal(API.order("ord_x", { locale: "zh" }), "/v1/orders/ord_x?locale=zh");
    assert.equal(API.orderCancel("ord_x"), "/v1/orders/ord_x/cancel");
    assert.equal(API.orderCancel("ord/x"), "/v1/orders/ord%2Fx/cancel");
  });

  it("never exposes a /api/ path", () => {
    const values = [
      ...Object.values(PUBLIC_ORIGINS),
      MCP_PATH,
      ...Object.values(API).filter((v) => typeof v === "string"),
      API.hotel("htl_x", { roomTypes: true, locale: "zh" }),
      API.order("ord_x", { locale: "en" }),
      API.orderCancel("ord_x"),
    ];
    for (const v of values) assert.ok(!v.includes("/api/"), v);
  });
});
