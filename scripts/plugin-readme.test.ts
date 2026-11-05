import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { LIMITS } from "../packages/contract/src/limits.ts";

/** The Claude plugin's README, which a person reads before installing: its
 *  numbers are typed by hand, so each must still be the contract's. */
const README = readFileSync(new URL("../plugins/claude/README.md", import.meta.url), "utf8");

describe("the Claude plugin's README", () => {
  it("states the token payment cap as LIMITS.tokenPaymentMaxUsd", () => {
    const figures = [...README.matchAll(/\$(\d[\d,]*)/g)].map(([, n]) => Number((n as string).replaceAll(",", "")));
    assert.ok(figures.length > 0, "no dollar figure");
    for (const figure of figures) assert.equal(figure, LIMITS.tokenPaymentMaxUsd);
  });

  it("states no payment link lifetime: the order's payment.expiresAt does", () => {
    assert.doesNotMatch(README, /\bexpires after about\b|\b\d+ hours?\b/);
  });
});
