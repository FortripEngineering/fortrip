import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RATE_LIMITS } from "../src/rate-limits.ts";

describe("rate limits", () => {
  it("states the seven limits", () => {
    assert.deepEqual(RATE_LIMITS, {
      search: { limit: 10, windowSeconds: 60 },
      offers: { limit: 20, windowSeconds: 60 },
      hotel: { limit: 30, windowSeconds: 60 },
      orders_create: { limit: 20, windowSeconds: 60 },
      orders_read: { limit: 60, windowSeconds: 60 },
      orders_cancel: { limit: 10, windowSeconds: 60 },
      orders_pay: { limit: 10, windowSeconds: 60 },
    });
  });
});
