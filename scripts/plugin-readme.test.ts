import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { LIMITS } from "../packages/contract/src/limits.ts";

/** The Claude plugin's README, which a person reads before installing: its
 *  numbers are typed by hand, so each must still be the contract's. */
const README = readFileSync(new URL("../plugins/claude/README.md", import.meta.url), "utf8");

describe("the Claude plugin's README", () => {
  it("names no payment by token: Claude and Claude Code are not offered it", () => {
    assert.doesNotMatch(README, /pay an order|one-time token|payment token|Link wallet|\$\d/i);
  });

  it("states the stay limits as LIMITS.nightsSupplier and LIMITS.rooms", () => {
    assert.match(README, new RegExp(`\\b1 to ${LIMITS.nightsSupplier} nights\\b`));
    assert.match(README, new RegExp(`\\b1 to ${LIMITS.rooms} rooms\\b`));
  });

  it("states no payment link lifetime: the order's payment.expiresAt does", () => {
    assert.doesNotMatch(README, /\bexpires after about\b|\b\d+ hours?\b/);
  });
});
