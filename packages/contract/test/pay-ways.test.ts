import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAY_WAYS, PAYMENT_METHOD_IDS, payOrderInput } from "../src/index.ts";

describe("pay ways", () => {
  it("an order is paid by its link or, through pay_order, by a shared payment token", () => {
    assert.deepEqual([...PAY_WAYS], ["payment_link", "stripe_shared_payment_token"]);
    const fields = Object.keys(payOrderInput.shape).filter(
      (key) => key !== "orderId" && key !== "total",
    );
    assert.deepEqual(fields, ["sharedPaymentToken"]);
  });

  it("names every way but the link by its payment method's id", () => {
    const ids: readonly string[] = PAYMENT_METHOD_IDS;
    for (const way of PAY_WAYS.filter((w) => w !== "payment_link")) assert.ok(ids.includes(way), way);
  });
});
