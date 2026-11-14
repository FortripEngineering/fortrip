import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as contract from "../src/index.ts";
import { order, PAY_WAYS, payOrderInput } from "../src/index.ts";

describe("pay ways", () => {
  it("an order is paid by its link or, through pay_order, by a shared payment token", () => {
    assert.deepEqual([...PAY_WAYS], ["payment_link", "stripe_shared_payment_token"]);
    const fields = Object.keys(payOrderInput.shape).filter(
      (key) => key !== "orderId" && key !== "total",
    );
    assert.deepEqual(fields, ["sharedPaymentToken"]);
  });

  it("an order offers the token as payment.tokenRequest, and lists no methods", () => {
    const keys = Object.keys(order.shape.payment.shape);
    assert.ok(keys.includes("tokenRequest"));
    assert.ok(!keys.includes("methods"));
  });

  it("exports nothing of the wallet method, which agents no longer have", () => {
    for (const name of ["PAYMENT_METHOD_IDS", "paymentMethod", "WALLET_NEXT_STEP", "walletNextStep"]) {
      assert.ok(!(name in contract), name);
    }
  });
});
