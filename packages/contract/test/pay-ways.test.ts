import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAY_INPUT_WAYS, PAY_WAYS, payOrderInput } from "../src/index.ts";

describe("pay ways", () => {
  it("maps every exclusive pay field", () => {
    const fields = Object.keys(payOrderInput.shape).filter(
      (key) => key !== "orderId" && key !== "total",
    );
    assert.deepEqual(fields.sort(), Object.keys(PAY_INPUT_WAYS).sort());
  });

  it("covers every method value", () => {
    const method = payOrderInput.shape.method.unwrap();
    for (const option of method.options) {
      assert.ok((PAY_WAYS as readonly string[]).includes(option), option);
    }
  });

  it("lists the link way", () => {
    assert.ok(PAY_WAYS.includes("payment_link"));
  });
});
