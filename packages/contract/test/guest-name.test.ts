import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GUEST_NAME_PATTERN,
  guestNameRe,
  normalizeGuestName,
} from "../src/guest-name.ts";

describe("guest name character set", () => {
  it("accepts the plain Latin names the old rule already allowed", () => {
    for (const name of ["Wei", "Zhang", "HUI HSIU", "Anne-Marie", "van Dijk"]) {
      assert.ok(guestNameRe.test(name), name);
    }
  });

  // The regression this module exists for: these are ordinary passport
  // spellings the old `[A-Za-z\s-]+` rejected before the supplier ever saw them.
  it("accepts apostrophes and periods", () => {
    for (const name of ["O'Brien", "D'Angelo", "St. John", "Jr.", "O'Neill"]) {
      assert.ok(guestNameRe.test(name), name);
    }
  });

  it("accepts a curly apostrophe typed on a phone keyboard", () => {
    assert.ok(guestNameRe.test("O’Brien"));
  });

  it("still refuses CJK and accented Latin — transliteration is the rule", () => {
    for (const name of ["张", "伟", "José", "Müller", "Nguyễn"]) {
      assert.equal(guestNameRe.test(name), false, name);
    }
  });

  it("refuses names that are punctuation only or start with punctuation", () => {
    for (const name of ["", " ", "...", "-Wei", "'", ".Zhang"]) {
      assert.equal(guestNameRe.test(name), false, JSON.stringify(name));
    }
  });

  it("refuses digits and separators that aren't name punctuation", () => {
    for (const name of ["Wei2", "Zhang_Wei", "a@b", "Wei/Li"]) {
      assert.equal(guestNameRe.test(name), false, name);
    }
  });
});

// The browser pattern and the server regex are deliberately NOT the same
// expression — the browser sees raw input, the server sees normalized input.
// Asserting they're identical (the earlier version of this test) was
// tautological: `guestNameRe` was built FROM the pattern, so it could never
// fail. What has to hold is the handoff between the two stages.
describe("browser pattern vs server regex", () => {
  // Compiled the way a browser compiles `pattern`: wrapped in a non-capturing
  // group, with the `v` flag. Both details matter — without the group the
  // alternation would escape its anchors, and without `v` this file happily
  // accepted a pattern that every real browser DISCARDS as invalid (a bare `-`
  // in a character class), silently switching client-side validation off.
  const browserRe = new RegExp(`^(?:${GUEST_NAME_PATTERN})$`, "v");

  it("lets whitespace-only through so a revealed row can be undone", () => {
    for (const value of ["", " ", "   "]) {
      assert.ok(browserRe.test(value), JSON.stringify(value));
      // …and it normalizes to empty, which collectGuestsFromForm drops.
      assert.equal(normalizeGuestName(value), "");
    }
  });

  it("accepts surrounding whitespace the server would trim anyway", () => {
    for (const value of [" Wei", "Zhang ", "  O’Brien  "]) {
      assert.ok(browserRe.test(value), value);
    }
  });

  // The property that matters: nothing the browser lets through can reach the
  // server as a non-empty value the server then rejects. A mismatch here is a
  // user stranded on a form the browser said was fine.
  it("never accepts a value that normalizes to something the server refuses", () => {
    const candidates = [
      "",
      "   ",
      " Wei ",
      "O’Brien",
      "St. John",
      "Anne-Marie",
      "  HUI   HSIU  ",
      "'t Hooft",
      "-Wei",
      "...",
      "José",
      "张",
      "Wei2",
    ];
    for (const value of candidates) {
      if (!browserRe.test(value)) continue;
      const normalized = normalizeGuestName(value);
      if (normalized === "") continue;
      assert.ok(
        guestNameRe.test(normalized),
        `browser accepted ${JSON.stringify(value)} but server refuses ${JSON.stringify(normalized)}`,
      );
    }
  });

  it("still refuses the things neither stage should allow", () => {
    for (const value of ["张", "José", "Wei2", "-Wei", "..."]) {
      assert.equal(browserRe.test(value), false, value);
    }
  });

  // The regression guard for the above: assert compilation explicitly so the
  // failure reads "pattern is invalid" rather than a pile of confusing
  // per-value mismatches if someone unescapes the hyphen again.
  it("compiles under every flag a browser might use", () => {
    for (const flags of ["v", "u", ""]) {
      assert.doesNotThrow(
        () => new RegExp(`^(?:${GUEST_NAME_PATTERN})$`, flags),
        `pattern must compile with flags=${JSON.stringify(flags)}`,
      );
    }
  });
});

describe("normalizeGuestName", () => {
  it("straightens curly apostrophes", () => {
    assert.equal(normalizeGuestName("O’Brien"), "O'Brien");
    assert.equal(normalizeGuestName("O‘Brien"), "O'Brien");
  });

  it("collapses whitespace and trims", () => {
    assert.equal(normalizeGuestName("  HUI   HSIU  "), "HUI HSIU");
  });

  it("leaves an already-clean name untouched", () => {
    assert.equal(normalizeGuestName("Anne-Marie"), "Anne-Marie");
  });

  // Normalization runs BEFORE the pattern check, so a phone-typed name has to
  // survive the round trip — otherwise the fix only works on desktop.
  it("produces a value the pattern accepts", () => {
    assert.ok(guestNameRe.test(normalizeGuestName(" O’Brien ")));
  });
});
