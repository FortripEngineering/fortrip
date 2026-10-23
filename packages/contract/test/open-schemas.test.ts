import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

import {
  openEnum,
  openObject,
  openUnion,
  parseOpen,
  strictOutput,
} from "../src/conventions/open.ts";

describe("openObject", () => {
  it("keeps fields the schema does not know", () => {
    const s = openObject({ a: z.string() });
    assert.deepEqual(parseOpen(s, { a: "x", b: 2 }), { a: "x", b: 2 });
  });
});

describe("openEnum", () => {
  const s = openEnum(["a", "b"]);

  it("parses known and unknown strings, rejects non-strings", () => {
    assert.equal(s.parse("a"), "a");
    assert.equal(s.parse("c"), "c");
    assert.equal(s.safeParse(1).success, false);
  });

  it("emits JSON Schema anyOf [enum, string]", () => {
    const js = z.toJSONSchema(s) as unknown as {
      anyOf: [{ enum: string[] }, Record<string, unknown>];
    };
    assert.equal(js.anyOf.length, 2);
    assert.deepEqual(js.anyOf[0].enum, ["a", "b"]);
    assert.deepEqual(js.anyOf[1], { type: "string" });
  });
});

describe("openUnion", () => {
  const A = openObject({ kind: z.literal("a"), x: z.number() });
  const B = openObject({ kind: z.literal("b"), y: z.string() });
  const u = openUnion("kind", [A, B]);

  it("parses a known value into its branch", () => {
    assert.deepEqual(u.parse({ kind: "a", x: 1 }), { kind: "a", x: 1 });
    assert.deepEqual(u.parse({ kind: "b", y: "s", more: true }), {
      kind: "b",
      y: "s",
      more: true,
    });
  });

  it("fails a malformed known branch instead of falling back", () => {
    assert.equal(u.safeParse({ kind: "a", x: "no" }).success, false);
    assert.equal(u.safeParse({ kind: "b" }).success, false);
  });

  it("passes an unknown discriminator value through the fallback", () => {
    assert.deepEqual(u.parse({ kind: "zzz", x: 1 }), { kind: "zzz", x: 1 });
  });

  it("rejects a missing or non-string discriminator", () => {
    assert.equal(u.safeParse({ x: 1 }).success, false);
    assert.equal(u.safeParse({ kind: 3 }).success, false);
  });

  it("emits JSON Schema anyOf with one entry per branch plus the fallback", () => {
    const js = z.toJSONSchema(u, { io: "output" }) as unknown as { anyOf: unknown[] };
    assert.equal(js.anyOf.length, 3);
  });
});

describe("strictOutput", () => {
  const shape = openObject({
    id: z.string(),
    inner: openObject({ n: z.number() }),
    list: z.array(openObject({ v: z.string() })).min(1),
    maybe: openObject({ q: z.string() }).nullable().optional(),
    mode: openEnum(["fast", "slow"]),
    item: openUnion("type", [
      openObject({ type: z.literal("room"), beds: z.number() }),
    ]),
  });
  const ok = {
    id: "i",
    inner: { n: 1 },
    list: [{ v: "x" }],
    maybe: null,
    mode: "fast",
    item: { type: "room", beds: 2 },
  };
  const strict = strictOutput(shape);

  it("accepts a fully known value", () => {
    assert.deepEqual(strict.parse(ok), ok);
  });

  it("rejects unknown fields at every depth", () => {
    assert.equal(strict.safeParse({ ...ok, extra: 1 }).success, false);
    assert.equal(strict.safeParse({ ...ok, inner: { n: 1, extra: 1 } }).success, false);
    assert.equal(strict.safeParse({ ...ok, list: [{ v: "x", extra: 1 }] }).success, false);
    assert.equal(strict.safeParse({ ...ok, maybe: { q: "a", extra: 1 } }).success, false);
    assert.equal(
      strict.safeParse({ ...ok, item: { type: "room", beds: 2, extra: 1 } }).success,
      false,
    );
  });

  it("rejects unknown enum values and unknown union branches", () => {
    assert.equal(strict.safeParse({ ...ok, mode: "other" }).success, false);
    assert.equal(strict.safeParse({ ...ok, item: { type: "villa" } }).success, false);
  });

  it("leaves the open schema untouched", () => {
    assert.equal(shape.safeParse({ ...ok, extra: 1, mode: "other" }).success, true);
  });
});
