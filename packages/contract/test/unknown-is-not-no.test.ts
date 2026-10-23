import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { openObject } from "../src/conventions/open.ts";
import { UNKNOWN_IS_NOT_NO_EXEMPTIONS } from "../src/conventions/unknown-is-not-no.ts";
import {
  jsonSchemaOf,
  OUTPUT_SCHEMAS,
  type JsonSchema,
} from "./output-schemas-v1.ts";

/*
 * Spec §6, "Unknown is not no": every array or boolean in a response is
 * nullable or has a sibling flag saying whether the source stated it, except
 * the named exemptions. A field's path is its property names joined by dots
 * (array and union hops add nothing); an exemption matches the path or its
 * dotted suffix, so `localities.items` covers `coverage.localities.items`.
 */

const SIBLING_FLAGS = ["known", "listed", "disclosure", "status"];

const isNull = (node: JsonSchema) => node.type === "null";

/** "array" | "boolean" | "nullable" | other, after looking through unions. */
function kindOf(node: JsonSchema): string {
  const anyOf = node.anyOf as JsonSchema[] | undefined;
  if (anyOf) {
    if (anyOf.some(isNull)) return "nullable";
    const kinds = new Set(anyOf.map(kindOf));
    return kinds.size === 1 ? [...kinds][0]! : "mixed";
  }
  return typeof node.type === "string" ? node.type : "other";
}

function exempt(path: string, exemptions: readonly string[]): boolean {
  return exemptions.some((e) => path === e || path.endsWith(`.${e}`));
}

function unknownIsNotNoViolations(
  root: JsonSchema,
  exemptions: readonly string[],
  rootPath = "",
): string[] {
  const out: string[] = [];
  const visit = (node: JsonSchema, path: string) => {
    for (const branch of (node.anyOf as JsonSchema[] | undefined) ?? []) {
      visit(branch, path);
    }
    if (node.items) visit(node.items as JsonSchema, path);
    const props = node.properties as Record<string, JsonSchema> | undefined;
    if (!props) return;
    const hasFlag = SIBLING_FLAGS.some((flag) => flag in props);
    for (const [key, sub] of Object.entries(props)) {
      const at = path ? `${path}.${key}` : key;
      const kind = kindOf(sub);
      if ((kind === "array" || kind === "boolean") && !hasFlag && !exempt(at, exemptions)) {
        out.push(`${at}: ${kind} that is neither nullable nor flagged`);
      }
      visit(sub, at);
    }
  };
  visit(root, rootPath);
  return out;
}

const EXEMPT = Object.keys(UNKNOWN_IS_NOT_NO_EXEMPTIONS);

describe("the exemption list", () => {
  it("is the §6 list verbatim", () => {
    assert.deepEqual(EXEMPT, [
      "data",
      "notes",
      "offers",
      "items",
      "issues",
      "changes",
      "hotels",
      "unavailable",
      "candidates",
      "localities.items",
      "localities.items.includes",
      "filterable",
      "rooms",
      "childrenAges",
      "retryable",
      "mandatory",
      "worse",
      "requiresSignIn",
      "localCurrencyAtCheckout",
      "bookable",
      "cityLike",
      "known",
      "listed",
    ]);
  });

  it("gives every entry a reason", () => {
    for (const [field, reason] of Object.entries(UNKNOWN_IS_NOT_NO_EXEMPTIONS)) {
      assert.ok(reason.trim().length > 10, field);
    }
  });
});

describe("the unknown-is-not-no walk itself", () => {
  const check = (shape: z.ZodRawShape) =>
    unknownIsNotNoViolations(jsonSchemaOf(openObject(shape)), EXEMPT);

  it("flags a bare boolean or array, at any depth", () => {
    assert.deepEqual(check({ pool: z.boolean() }), [
      "pool: boolean that is neither nullable nor flagged",
    ]);
    assert.deepEqual(check({ a: openObject({ tags: z.array(z.string()) }) }), [
      "a.tags: array that is neither nullable nor flagged",
    ]);
    assert.deepEqual(
      check({ list: z.array(openObject({ ok: z.boolean() })).nullable() }),
      ["list.ok: boolean that is neither nullable nor flagged"],
    );
  });

  it("accepts nullable, flagged and exempt fields", () => {
    assert.deepEqual(check({ pool: z.boolean().nullable() }), []);
    assert.deepEqual(check({ known: z.boolean(), meals: z.array(z.string()) }), []);
    assert.deepEqual(check({ status: z.string(), steps: z.array(z.string()) }), []);
    assert.deepEqual(check({ data: z.array(z.string()) }), []);
    assert.deepEqual(
      check({
        coverage: openObject({
          localities: openObject({
            items: z.array(openObject({ includes: z.array(z.string()) })),
          }),
        }),
      }),
      [],
    );
  });

  it("matches an exemption only on a whole dotted suffix", () => {
    assert.deepEqual(check({ metadata: z.array(z.string()) }), [
      "metadata: array that is neither nullable nor flagged",
    ]);
  });
});

describe("every v1 output schema: unknown is not no", () => {
  // A component is walked under its export name, the field it fills
  // (`search.localities` as `localities`).
  for (const [name, schema] of Object.entries(OUTPUT_SCHEMAS)) {
    it(name, () => {
      const root = name.slice(name.indexOf(".") + 1);
      assert.deepEqual(unknownIsNotNoViolations(jsonSchemaOf(schema), EXEMPT, root), []);
    });
  }
});
