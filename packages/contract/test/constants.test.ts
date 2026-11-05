import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { renderGuide } from "../src/guide.ts";
import { LIMITS } from "../src/limits.ts";
import { TOOLS } from "../src/tools.ts";
import { CONTRACT_VERSION } from "../src/version.ts";

describe("CONTRACT_VERSION", () => {
  it("is the version in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    assert.equal(CONTRACT_VERSION, pkg.version);
  });
});

describe("order limits", () => {
  it("caps the orders one stay can have", () => {
    assert.equal(LIMITS.ordersPerStay, 20);
  });
});

describe("pay-eligibility limits", () => {
  it("states the token and wallet numbers", () => {
    assert.equal(LIMITS.tokenPaymentMaxUsd, 500);
    assert.equal(LIMITS.payMinMinutesLeft, 15);
    assert.equal(LIMITS.tokensPerOrder, 5);
    assert.equal(LIMITS.wechatCodeMinutes, 120);
  });

  it("states the pay cutoff below the pay-start floor", () => {
    assert.equal(LIMITS.payCutoffMinutes, 2);
    assert.ok(LIMITS.payCutoffMinutes < LIMITS.payMinMinutesLeft);
  });

  it("renders the code lifetime in the guide and the pay_order tool", () => {
    assert.ok(renderGuide("cli", "main").includes("120 minutes"));
    const pay = TOOLS.find((tool) => tool.name === "pay_order");
    assert.ok(pay?.description.includes("120 minutes"));
  });
});
