import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { openEnum, openObject, openUnion } from "../src/conventions/open.ts";
import {
  jsonSchemaOf,
  OUTPUT_SCHEMAS,
  PUBLISHED_SCHEMAS,
  type JsonSchema,
} from "./output-schemas-v1.ts";

/*
 * Spec §6, Evolution: every published output schema is open. Objects allow
 * extra fields; enums are "one of these, or any string"; every union has a
 * fallback branch; no tuples; no literal-typed field except the discriminator
 * constant of a known branch in a union with a fallback.
 */

const STRING = JSON.stringify({ type: "string" });
const NULL = JSON.stringify({ type: "null" });
const same = (node: unknown, json: string) => JSON.stringify(node) === json;

/** The discriminator of an open union's `anyOf`, or null when it isn't one. */
function openUnionDiscriminator(branches: JsonSchema[]): string | null {
  const fallback = branches.at(-1)!;
  const props = fallback.properties as Record<string, unknown> | undefined;
  if (fallback.type !== "object" || !props) return null;
  const keys = Object.keys(props);
  if (keys.length !== 1 || !same(props[keys[0]!], STRING)) return null;
  const d = keys[0]!;
  const known = branches.slice(0, -1);
  if (known.length === 0) return null;
  const allConst = known.every((branch) => {
    const p = (branch.properties as Record<string, JsonSchema> | undefined)?.[d];
    return branch.type === "object" && typeof p?.const === "string";
  });
  return allConst ? d : null;
}

function opennessViolations(root: JsonSchema): string[] {
  const out: string[] = [];

  const visit = (node: JsonSchema, at: string, discriminator: string | null) => {
    for (const key of ["$ref", "$defs", "prefixItems", "allOf", "oneOf", "not"]) {
      if (key in node) out.push(`${at}: uses ${key}`);
    }
    if ("enum" in node) out.push(`${at}: closed enum`);
    if ("const" in node) out.push(`${at}: literal-typed field`);

    const anyOf = node.anyOf as JsonSchema[] | undefined;
    if (anyOf) {
      if (anyOf.length === 2 && "enum" in anyOf[0]! && same(anyOf[1], STRING)) {
        // An open enum: "one of these, or any string".
        const { enum: _values, type: _type, ...rest } = anyOf[0]!;
        if (Object.keys(rest).length > 0) out.push(`${at}: enum carries ${Object.keys(rest)}`);
      } else if (anyOf.length === 2 && anyOf.some((b) => same(b, NULL))) {
        visit(anyOf.find((b) => !same(b, NULL))!, at, null);
      } else {
        const d = openUnionDiscriminator(anyOf);
        if (d === null) {
          out.push(`${at}: union without a fallback branch`);
          anyOf.forEach((b, i) => visit(b, `${at}|${i}`, null));
        } else {
          anyOf.forEach((b, i) => visit(b, `${at}|${i}`, i < anyOf.length - 1 ? d : null));
        }
      }
    }

    if (node.type === "object" || "properties" in node) {
      const extra = node.additionalProperties;
      if (extra === undefined || extra === false) out.push(`${at}: closed object`);
      const props = (node.properties ?? {}) as Record<string, JsonSchema>;
      for (const [key, sub] of Object.entries(props)) {
        if (key === discriminator && typeof sub.const === "string") {
          const { const: _c, type, ...rest } = sub;
          if (type !== "string" || Object.keys(rest).length > 0) {
            out.push(`${at}.${key}: discriminator carries more than its constant`);
          }
          continue;
        }
        visit(sub, `${at}.${key}`, null);
      }
    }

    if (node.items) visit(node.items as JsonSchema, `${at}[]`, null);
  };

  visit(root, "$", null);
  return out;
}

describe("the openness walk itself", () => {
  it("passes an open schema", () => {
    const s = openObject({
      mode: openEnum(["a", "b"]).nullable(),
      list: z.array(openObject({ n: z.number() })).min(1),
      item: openUnion("type", [openObject({ type: z.literal("x"), y: z.string() })]),
    });
    assert.deepEqual(opennessViolations(jsonSchemaOf(s)), []);
  });

  it("catches each kind of closed schema", () => {
    const cases: [string, z.ZodType][] = [
      ["closed object", z.object({ a: z.string() })],
      ["closed enum", openObject({ a: z.enum(["x", "y"]) })],
      ["literal-typed field", openObject({ a: z.literal("x") })],
      [
        "union without a fallback branch",
        openObject({
          a: z.union([
            openObject({ t: z.literal("x") }),
            openObject({ t: z.literal("y") }),
          ]),
        }),
      ],
      ["uses prefixItems", openObject({ a: z.tuple([z.string()]) })],
    ];
    for (const [expected, schema] of cases) {
      const found = opennessViolations(jsonSchemaOf(schema));
      assert.ok(
        found.some((v) => v.includes(expected)),
        `${expected}: got ${JSON.stringify(found)}`,
      );
    }
  });
});

describe("every v1 output schema is open", () => {
  it("finds the output schemas", () => {
    assert.ok(Object.keys(OUTPUT_SCHEMAS).length >= 15);
  });

  for (const [name, schema] of Object.entries(OUTPUT_SCHEMAS)) {
    it(name, () => {
      assert.deepEqual(opennessViolations(jsonSchemaOf(schema)), []);
    });
  }
});

const SNAPSHOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "__snapshots__",
  "schemas.json",
);

describe("the published response schemas", () => {
  it("equal the snapshot (UPDATE_SNAPSHOTS=1 rewrites it)", () => {
    const current = Object.fromEntries(
      Object.entries(PUBLISHED_SCHEMAS)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, schema]) => [name, jsonSchemaOf(schema)]),
    );
    const text = `${JSON.stringify(current, null, 2)}\n`;
    if (process.env.UPDATE_SNAPSHOTS === "1") {
      mkdirSync(dirname(SNAPSHOT), { recursive: true });
      writeFileSync(SNAPSHOT, text);
    }
    assert.ok(existsSync(SNAPSHOT), "no snapshot: run with UPDATE_SNAPSHOTS=1");
    assert.deepEqual(JSON.parse(readFileSync(SNAPSHOT, "utf8")), current);
  });
});
