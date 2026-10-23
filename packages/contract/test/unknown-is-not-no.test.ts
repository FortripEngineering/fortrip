import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { openEnum, openObject } from "../src/conventions/open.ts";
import { UNKNOWN_IS_NOT_NO_EXEMPTIONS } from "../src/conventions/unknown-is-not-no.ts";
import {
  jsonSchemaOf,
  PUBLISHED_SCHEMAS,
  type JsonSchema,
} from "./output-schemas.ts";

/*
 * Spec §6, "Unknown is not no": every array or boolean in a response is
 * nullable or has a sibling flag saying whether the source stated it, except
 * the named exemptions.
 *
 * A field's path is root-relative: the published schema's name, then its
 * property names joined by dots (array and union hops add nothing). An
 * exemption applies only at the exact paths `EXEMPT_PATHS` gives its §6 key,
 * so the spec's bare `items` means an order's items and nothing else.
 *
 * A sibling is a "stated" flag when it is `known` or `listed` (booleans),
 * `disclosure` with an `incomplete` value, or `status` with an `unknown` value
 * (the cancellation status). An order's or a payment's `status` is a
 * lifecycle, not a flag.
 */

/** Where each §6 exemption applies. Empty: the field never needs one. */
const EXEMPT_PATHS: Record<string, readonly string[]> = {
  data: ["searchResult.data", "orderList.data", "MCP_OUTPUT.list_orders.data"],
  notes: ["searchResult.notes"],
  offers: ["hotelOffersResult.hotels.offers"],
  items: [
    "order.items",
    "orderList.data.items",
    "MCP_OUTPUT.book_hotel.items",
    "MCP_OUTPUT.get_order.items",
    "MCP_OUTPUT.list_orders.data.items",
  ],
  issues: ["errorEnvelope.error.details.issues"],
  changes: ["errorEnvelope.error.details.changes"],
  hotels: ["hotelOffersResult.hotels"],
  unavailable: ["hotelOffersResult.unavailable"],
  candidates: ["errorEnvelope.error.details.candidates"],
  "localities.items": [
    "searchResult.coverage.localities.items",
    "errorEnvelope.error.details.localities.items",
  ],
  "localities.items.includes": [
    "searchResult.coverage.localities.items.includes",
    "errorEnvelope.error.details.localities.items.includes",
  ],
  filterable: ["errorEnvelope.error.details.filterable"],
  rooms: [
    "searchResult.stay.rooms",
    "hotelOffersResult.stay.rooms",
    "order.items.hotel.rooms",
    "orderList.data.items.hotel.rooms",
    "MCP_OUTPUT.book_hotel.items.hotel.rooms",
    "MCP_OUTPUT.get_order.items.hotel.rooms",
    "MCP_OUTPUT.list_orders.data.items.hotel.rooms",
  ],
  childrenAges: [
    "searchResult.stay.rooms.childrenAges",
    "hotelOffersResult.stay.rooms.childrenAges",
    "order.items.hotel.rooms.childrenAges",
    "orderList.data.items.hotel.rooms.childrenAges",
    "MCP_OUTPUT.book_hotel.items.hotel.rooms.childrenAges",
    "MCP_OUTPUT.get_order.items.hotel.rooms.childrenAges",
    "MCP_OUTPUT.list_orders.data.items.hotel.rooms.childrenAges",
  ],
  retryable: ["errorEnvelope.error.retryable"],
  mandatory: [
    "hotelOffersResult.hotels.offers.price.payAtProperty.items.mandatory",
    "order.items.hotel.payAtProperty.items.mandatory",
    "orderList.data.items.hotel.payAtProperty.items.mandatory",
    "errorEnvelope.error.details.offer.price.payAtProperty.items.mandatory",
    "errorEnvelope.error.details.changes.previous.items.mandatory",
    "errorEnvelope.error.details.changes.current.items.mandatory",
    "MCP_OUTPUT.book_hotel.items.hotel.payAtProperty.items.mandatory",
    "MCP_OUTPUT.get_order.items.hotel.payAtProperty.items.mandatory",
    "MCP_OUTPUT.list_orders.data.items.hotel.payAtProperty.items.mandatory",
  ],
  worse: ["errorEnvelope.error.details.changes.worse"],
  requiresSignIn: [
    "order.payment.requiresSignIn",
    "orderList.data.payment.requiresSignIn",
    "MCP_OUTPUT.book_hotel.payment.requiresSignIn",
    "MCP_OUTPUT.get_order.payment.requiresSignIn",
    "MCP_OUTPUT.list_orders.data.payment.requiresSignIn",
  ],
  localCurrencyAtCheckout: [
    "order.payment.localCurrencyAtCheckout",
    "orderList.data.payment.localCurrencyAtCheckout",
    "MCP_OUTPUT.book_hotel.payment.localCurrencyAtCheckout",
    "MCP_OUTPUT.get_order.payment.localCurrencyAtCheckout",
    "MCP_OUTPUT.list_orders.data.payment.localCurrencyAtCheckout",
  ],
  bookable: ["hotel.bookable"],
  cityLike: [], // nullable wherever it appears
  known: [], // the flag itself: its own sibling
  listed: [], // the flag itself: its own sibling
};

const ALL_EXEMPT = new Set(Object.values(EXEMPT_PATHS).flat());

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

function enumValues(node: unknown): unknown[] {
  if (!node || typeof node !== "object") return [];
  const n = node as JsonSchema;
  return [
    ...((n.enum as unknown[] | undefined) ?? []),
    ...((n.anyOf as unknown[] | undefined) ?? []).flatMap(enumValues),
  ];
}

function isStatedFlag(key: string, node: JsonSchema): boolean {
  switch (key) {
    case "known":
    case "listed":
      return node.type === "boolean";
    case "disclosure":
      return enumValues(node).includes("incomplete");
    case "status":
      return enumValues(node).includes("unknown");
    default:
      return false;
  }
}

/** Unflagged arrays and booleans, ignoring exemptions. */
function unflagged(root: JsonSchema, rootPath: string): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (node: JsonSchema, path: string) => {
    for (const branch of (node.anyOf as JsonSchema[] | undefined) ?? []) {
      visit(branch, path);
    }
    if (node.items) visit(node.items as JsonSchema, path);
    const props = node.properties as Record<string, JsonSchema> | undefined;
    if (!props) return;
    const flagged = Object.entries(props).some(([k, v]) => isStatedFlag(k, v));
    for (const [key, sub] of Object.entries(props)) {
      const at = `${path}.${key}`;
      const kind = kindOf(sub);
      if ((kind === "array" || kind === "boolean") && !flagged) out.set(at, kind);
      visit(sub, at);
    }
  };
  visit(root, rootPath);
  return out;
}

function violations(root: JsonSchema, rootPath: string): string[] {
  return [...unflagged(root, rootPath)]
    .filter(([path]) => !ALL_EXEMPT.has(path))
    .map(([path, kind]) => `${path}: ${kind} that is neither nullable nor flagged`);
}

/** The JSON node at a root-relative property path (through arrays and unions). */
function nodeAt(root: JsonSchema, path: string[]): JsonSchema {
  if (path.length === 0) return root;
  const [head, ...rest] = path;
  const props = root.properties as Record<string, JsonSchema> | undefined;
  if (props?.[head!]) return nodeAt(props[head!]!, rest);
  for (const next of [root.items, ...((root.anyOf as unknown[]) ?? [])]) {
    if (!next) continue;
    try {
      return nodeAt(next as JsonSchema, path);
    } catch {
      // not down this branch
    }
  }
  throw new Error(`no ${path.join(".")}`);
}

function withoutField(name: string, objectPath: string, field: string): JsonSchema {
  const js = structuredClone(jsonSchemaOf(PUBLISHED_SCHEMAS[name]!));
  const target = nodeAt(js, objectPath.split("."));
  delete (target.properties as Record<string, unknown>)[field];
  return js;
}

describe("the exemption list", () => {
  it("is the §6 list verbatim", () => {
    assert.deepEqual(Object.keys(UNKNOWN_IS_NOT_NO_EXEMPTIONS), [
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

  it("places every entry, each path ending in its key", () => {
    assert.deepEqual(Object.keys(EXEMPT_PATHS), Object.keys(UNKNOWN_IS_NOT_NO_EXEMPTIONS));
    for (const [key, paths] of Object.entries(EXEMPT_PATHS)) {
      for (const path of paths) assert.ok(path.endsWith(`.${key}`), path);
    }
  });

  it("names no path that needs no exemption", () => {
    const needed = new Set(
      Object.entries(PUBLISHED_SCHEMAS).flatMap(([name, schema]) => [
        ...unflagged(jsonSchemaOf(schema), name).keys(),
      ]),
    );
    for (const path of ALL_EXEMPT) assert.ok(needed.has(path), path);
  });
});

describe("the unknown-is-not-no walk itself", () => {
  const check = (root: string, shape: z.ZodRawShape) =>
    violations(jsonSchemaOf(openObject(shape)), root);

  it("flags a bare boolean or array, at any depth", () => {
    assert.deepEqual(check("x", { pool: z.boolean() }), [
      "x.pool: boolean that is neither nullable nor flagged",
    ]);
    assert.deepEqual(check("x", { list: z.array(openObject({ ok: z.boolean() })).nullable() }), [
      "x.list.ok: boolean that is neither nullable nor flagged",
    ]);
  });

  it("accepts nullable and flagged fields", () => {
    assert.deepEqual(check("x", { pool: z.boolean().nullable() }), []);
    assert.deepEqual(check("x", { known: z.boolean(), meals: z.array(z.string()) }), []);
    assert.deepEqual(
      check("x", { disclosure: openEnum(["complete", "incomplete"]), fees: z.array(z.string()) }),
      [],
    );
    assert.deepEqual(
      check("x", { status: openEnum(["free", "unknown"]), steps: z.array(z.string()) }),
      [],
    );
  });

  it("takes a lifecycle status as no flag", () => {
    assert.deepEqual(
      check("order", { status: openEnum(["paid", "refunded"]), notes: z.array(z.string()) }),
      ["order.notes: array that is neither nullable nor flagged"],
    );
  });

  it("applies an exemption only at its own paths", () => {
    assert.deepEqual(check("order", { items: z.array(z.string()) }), []);
    assert.deepEqual(check("hotel", { foo: openObject({ items: z.array(z.boolean()) }) }), [
      "hotel.foo.items: array that is neither nullable nor flagged",
    ]);
    assert.deepEqual(check("hotel", { data: z.array(z.string()) }), [
      "hotel.data: array that is neither nullable nor flagged",
    ]);
  });

  it("fails a published schema that loses its flag", () => {
    assert.deepEqual(violations(withoutField("hotel", "policies", "listed"), "hotel"), [
      "hotel.policies.items: array that is neither nullable nor flagged",
    ]);
    assert.deepEqual(violations(withoutField("hotel", "amenities", "listed"), "hotel"), [
      "hotel.amenities.items: array that is neither nullable nor flagged",
    ]);
    assert.deepEqual(
      violations(
        withoutField("hotelOffersResult", "hotels.offers.price.payAtProperty", "disclosure"),
        "hotelOffersResult",
      ),
      ["hotelOffersResult.hotels.offers.price.payAtProperty.items: array that is neither nullable nor flagged"],
    );
    assert.deepEqual(
      violations(withoutField("hotelOffersResult", "hotels.offers.cancellation", "status"), "hotelOffersResult"),
      ["hotelOffersResult.hotels.offers.cancellation.penalties: array that is neither nullable nor flagged"],
    );
  });
});

describe("every published response schema: unknown is not no", () => {
  for (const [name, schema] of Object.entries(PUBLISHED_SCHEMAS)) {
    it(name, () => {
      assert.deepEqual(violations(jsonSchemaOf(schema), name), []);
    });
  }
});
