import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GUEST_NAME_PATTERN, GUEST_NAME_TITLE } from "../src/index.ts";

describe("guest-name form exports", () => {
  it("exports the HTML pattern and title as strings", () => {
    assert.equal(typeof GUEST_NAME_PATTERN, "string");
    assert.equal(typeof GUEST_NAME_TITLE, "string");
    assert.ok(GUEST_NAME_PATTERN.length > 0);
    assert.ok(GUEST_NAME_TITLE.length > 0);
  });

  // The HTML `pattern` attribute is compiled with the `v` flag, inside a
  // non-capturing group, and anchored by the browser.
  it("exports a pattern that works as an HTML pattern attribute", () => {
    const browserRe = new RegExp(`^(?:${GUEST_NAME_PATTERN})$`, "v");
    assert.equal(browserRe.test("Mueller"), true);
    assert.equal(browserRe.test("  Mueller "), true);
    assert.equal(browserRe.test("Müller"), false);
  });
});
