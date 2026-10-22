import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import {
  childrenAges,
  flag,
  isoDate,
  nonEmpty,
  oneOf,
  positiveId,
  strictInput,
  text,
  wholeNumber,
} from "../src/fields.ts";

/** The messages of every issue the schema raises for `value`, or `null` if it passes. */
function messages(schema: z.ZodType, value: unknown): string[] | null {
  const result = schema.safeParse(value);
  return result.success ? null : result.error.issues.map((i) => i.message);
}

describe("strictInput", () => {
  const input = strictInput({ a: z.string() });

  it("accepts exactly the declared keys", () => {
    assert.deepEqual(input.parse({ a: "x" }), { a: "x" });
  });

  it("names the keys it doesn't know", () => {
    assert.deepEqual(messages(input, { a: "x", b: 1 }), [
      "Unknown argument(s): b",
    ]);
    assert.deepEqual(messages(input, { a: "x", b: 1, c: 2 }), [
      "Unknown argument(s): b, c",
    ]);
  });

  it("says what it expected when it is not given an object", () => {
    for (const value of [null, "x", 3, [1]]) {
      assert.deepEqual(messages(input, value), ["Expected a JSON object"]);
    }
  });
});

describe("wholeNumber", () => {
  const rooms = wholeNumber("rooms", 1, 8);
  const message = "rooms must be a whole number from 1 to 8";

  it("accepts the whole numbers in range, both ends included", () => {
    for (const value of [1, 4, 8]) assert.equal(rooms.parse(value), value);
  });

  it("rejects everything else with the one message", () => {
    for (const value of [9, 0, -1, 1.5, "3", null, undefined, Number.NaN]) {
      assert.deepEqual(messages(rooms, value), [message], String(value));
    }
  });
});

describe("positiveId", () => {
  const id = positiveId("hotelId");

  it("accepts positive whole numbers", () => {
    assert.equal(id.parse(12_345), 12_345);
  });

  it("rejects zero, negatives, fractions and strings", () => {
    for (const value of [0, -3, 1.5, "7"]) {
      assert.deepEqual(
        messages(id, value),
        ["hotelId must be a positive whole number"],
        String(value),
      );
    }
  });
});

describe("isoDate", () => {
  const checkIn = isoDate("checkIn");

  it("accepts real calendar dates", () => {
    for (const value of ["2026-10-22", "2028-02-29"]) {
      assert.equal(checkIn.parse(value), value);
    }
  });

  it("rejects impossible, non-canonical and non-string values", () => {
    for (const value of [
      "2026-02-30",
      "2027-02-29",
      "2026-2-3",
      "2026/10/22",
      "20261022",
      "",
      20_261_022,
    ]) {
      assert.deepEqual(
        messages(checkIn, value),
        ["checkIn must be a real yyyy-MM-dd calendar date"],
        String(value),
      );
    }
  });
});

describe("nonEmpty", () => {
  it("accepts any text and rejects the empty string", () => {
    const query = nonEmpty("query");
    assert.equal(query.parse("Paris"), "Paris");
    assert.deepEqual(messages(query, ""), ["query must be a non-empty string"]);
    assert.deepEqual(messages(query, 7), ["query must be a non-empty string"]);
  });
});

describe("text", () => {
  const name = text("guestName", 2, 5);
  const message = "guestName must be text of 2 to 5 characters";

  it("accepts text of the length range, both ends included", () => {
    for (const value of ["ab", "abcde"]) assert.equal(name.parse(value), value);
  });

  it("rejects shorter, longer and non-text values", () => {
    for (const value of ["a", "abcdef", 12]) {
      assert.deepEqual(messages(name, value), [message], String(value));
    }
  });
});

describe("oneOf", () => {
  const currency = oneOf("currency", ["CNY", "USD"] as const);

  it("accepts a listed value", () => {
    assert.equal(currency.parse("USD"), "USD");
  });

  it("lists the allowed values when given another", () => {
    for (const value of ["EUR", "usd", 1]) {
      assert.deepEqual(
        messages(currency, value),
        ["currency must be one of: CNY, USD"],
        String(value),
      );
    }
  });
});

describe("flag", () => {
  const freeCancellation = flag("freeCancellation");

  it("accepts booleans only", () => {
    assert.equal(freeCancellation.parse(false), false);
    for (const value of ["true", 1, null]) {
      assert.deepEqual(
        messages(freeCancellation, value),
        ["freeCancellation must be true or false"],
        String(value),
      );
    }
  });
});

describe("childrenAges", () => {
  const ages = childrenAges(2);

  it("accepts up to the maximum, ages 0 to 17", () => {
    assert.deepEqual(ages.parse([]), []);
    assert.deepEqual(ages.parse([0, 17]), [0, 17]);
  });

  it("rejects too many children with the list message", () => {
    assert.deepEqual(messages(ages, [1, 2, 3]), [
      "childrenAges must list each child's age (0 to 17) in one room, at most 2",
    ]);
  });

  it("rejects an age out of range or not whole", () => {
    for (const value of [[18], [-1], [2.5], ["5"]]) {
      assert.deepEqual(
        messages(ages, value),
        ["Each child's age must be a whole number from 0 to 17"],
        JSON.stringify(value),
      );
    }
  });

  it("rejects a non-list", () => {
    assert.deepEqual(messages(ages, 5), [
      "childrenAges must list each child's age (0 to 17) in one room, at most 2",
    ]);
  });
});
