import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ERROR_CODES, type ErrorCode } from "../src/errors.ts";
import { API, MCP_PATH, PUBLIC_ORIGINS } from "../src/paths.ts";
import {
  DISPLAY_CURRENCIES,
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
  order_removed: [[410], false],
  offer_expired: [[409], false],
  offer_changed: [[409], false],
  offer_already_ordered: [[409], false],
  order_exists: [[409], false],
  order_in_progress: [[409], true],
  order_attempts_exhausted: [[409], false],
  cancellation_changed: [[409], false],
  order_not_cancellable: [[409], false],
  destination_ambiguous: [[422], false],
  destination_not_found: [[422], false],
  search_too_broad: [[422], false],
  stay_unsupported: [[422], false],
  stay_in_past: [[422], false],
  offer_unavailable: [[422], false],
  rate_limited: [[429], true],
  ordering_paused: [[503], true],
  service_unavailable: [[503], true],
  supplier_unavailable: [[503, 504], true],
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
      offersPerHotelDefault: 5,
      offersPerHotelMax: 20,
      pageSizeDefault: 20,
      pageSizeMax: 50,
      textLength: 128,
      radiusMetersMax: 80000,
      radiusMetersDefault: 8000,
      amenityFilters: 9,
      guestName: 60,
      contactFirstName: 59,
      contactLastName: 59,
      contactPhoneMin: 3,
      contactPhoneMax: 40,
      specialRequests: 500,
      poolLimit: 3000,
      candidatesShown: 8,
      candidatesCounted: 200,
      localitiesShown: 8,
    });
    assert.deepEqual([...DISPLAY_CURRENCIES], ["USD", "CNY"]);
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
      API.hotel("htl_x", { rooms: true, locale: "zh" }),
      "/v1/hotels/htl_x?include=rooms&locale=zh",
    );
    assert.equal(API.hotel("htl_x", { rooms: true }), "/v1/hotels/htl_x?include=rooms");
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
      API.hotel("htl_x", { rooms: true, locale: "zh" }),
      API.order("ord_x", { locale: "en" }),
      API.orderCancel("ord_x"),
    ];
    for (const v of values) assert.ok(!v.includes("/api/"), v);
  });
});
