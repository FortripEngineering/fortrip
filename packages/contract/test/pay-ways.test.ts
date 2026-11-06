import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAY_INPUT_WAYS, PAY_WAYS, PAYMENT_METHOD_IDS, payOrderInput } from "../src/index.ts";

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

  it("names every way but the link by its payment method's id", () => {
    const ids: readonly string[] = PAYMENT_METHOD_IDS;
    for (const way of PAY_WAYS.filter((w) => w !== "payment_link")) assert.ok(ids.includes(way), way);
  });

  it("pays each exclusive pay field by one of the ways", () => {
    for (const [field, way] of Object.entries(PAY_INPUT_WAYS)) assert.ok(PAY_WAYS.includes(way), field);
  });
});
