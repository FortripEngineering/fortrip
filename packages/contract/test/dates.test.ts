import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addIsoDateDays, countIsoDateDays, isIsoDate } from "../src/dates.ts";

describe("isIsoDate", () => {
  it("accepts real Gregorian dates, leap days included", () => {
    for (const value of ["2026-10-22", "2028-02-29", "2000-02-29", "2026-12-31"]) {
      assert.equal(isIsoDate(value), true, value);
    }
  });

  it("rejects dates the calendar doesn't have", () => {
    for (const value of [
      "2026-02-30",
      "2027-02-29",
      "1900-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2026-10-00",
    ]) {
      assert.equal(isIsoDate(value), false, value);
    }
  });

  it("rejects anything but the canonical yyyy-MM-dd form", () => {
    for (const value of [
      "",
      "2026-2-3",
      "2026/10/22",
      "20261022",
      "2026-10-22T00:00:00Z",
      " 2026-10-22",
      "2026-10-22 ",
      "２０２６-１０-２２",
    ]) {
      assert.equal(isIsoDate(value), false, JSON.stringify(value));
    }
  });
});

describe("addIsoDateDays", () => {
  it("steps across months, years and leap days", () => {
    assert.equal(addIsoDateDays("2026-10-22", 1), "2026-10-23");
    assert.equal(addIsoDateDays("2026-10-31", 1), "2026-11-01");
    assert.equal(addIsoDateDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addIsoDateDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addIsoDateDays("2027-02-28", 1), "2027-03-01");
  });

  it("steps backwards and by zero", () => {
    assert.equal(addIsoDateDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addIsoDateDays("2026-01-01", -1), "2025-12-31");
    assert.equal(addIsoDateDays("2026-10-22", 0), "2026-10-22");
  });

  it("is the same in every month, DST changes or not", () => {
    for (const start of ["2026-03-07", "2026-03-28", "2026-10-24", "2026-11-01"]) {
      assert.equal(countIsoDateDays(start, addIsoDateDays(start, 15)), 15, start);
    }
  });
});

describe("countIsoDateDays", () => {
  it("counts the days in the half-open range [start, end)", () => {
    assert.equal(countIsoDateDays("2026-10-22", "2026-10-23"), 1);
    assert.equal(countIsoDateDays("2026-10-22", "2026-10-22"), 0);
    assert.equal(countIsoDateDays("2026-02-28", "2026-03-01"), 1);
    assert.equal(countIsoDateDays("2028-02-28", "2028-03-01"), 2);
    assert.equal(countIsoDateDays("2026-01-01", "2027-01-01"), 365);
  });

  it("is signed", () => {
    assert.equal(countIsoDateDays("2026-10-23", "2026-10-22"), -1);
  });
});
