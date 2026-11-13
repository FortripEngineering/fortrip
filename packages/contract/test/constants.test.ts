import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { LIMITS } from "../src/limits.ts";
import { CONTRACT_VERSION } from "../src/version.ts";

describe("CONTRACT_VERSION", () => {
  it("is the version in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    assert.equal(CONTRACT_VERSION, pkg.version);
  });
});

describe("pay-eligibility limits", () => {
  it("states the token numbers, and none for a wallet payment", () => {
    assert.equal(LIMITS.tokenPaymentMaxUsd, 500);
    assert.equal(LIMITS.payMinMinutesLeft, 15);
    assert.equal(LIMITS.tokensPerOrder, 5);
    assert.ok(!("wechatCodeMinutes" in LIMITS));
  });

  it("states the pay cutoff below the pay-start floor", () => {
    assert.equal(LIMITS.payCutoffMinutes, 2);
    assert.ok(LIMITS.payCutoffMinutes < LIMITS.payMinMinutesLeft);
  });
});
