import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hotelOffersResult,
  order,
  searchResult,
} from "@fortrip/agent-contract";

import { TOOL_INPUTS } from "../lib/reference/input-docs.ts";
import { inputRows, outputRows } from "../lib/reference/schema-rows.ts";

test("every tool input field has a description", () => {
  for (const [tool, schema] of Object.entries(TOOL_INPUTS)) {
    const rows = inputRows(schema);
    assert.ok(rows.length > 0, tool);
    for (const row of rows) {
      if (row.variant) continue;
      assert.ok(row.description, `${tool}: ${row.path} has no description`);
    }
  }
});

test("row keys are unique, so a union's branches can repeat a path", () => {
  for (const [tool, schema] of Object.entries(TOOL_INPUTS)) {
    const keys = inputRows(schema).map((row) => row.key);
    assert.equal(new Set(keys).size, keys.length, tool);
  }
  for (const schema of [searchResult, hotelOffersResult, order]) {
    const keys = outputRows(schema).map((row) => row.key);
    assert.equal(new Set(keys).size, keys.length);
  }
});

test("input rows carry type, required and constraints", () => {
  const rows = new Map(
    inputRows(TOOL_INPUTS.search_hotels).map((row) => [row.key, row]),
  );
  assert.equal(rows.get("stay.checkIn")?.badge, "required");
  assert.equal(rows.get("text")?.badge, undefined);
  assert.deepEqual(rows.get("limit")?.meta, ["1–50"]);
  assert.equal(rows.get("currency")?.type, '"USD" | "CNY"');
  assert.equal(rows.get("stay.rooms[].adults")?.depth, 2);
  assert.deepEqual(rows.get("stay.rooms[].adults")?.meta, ["1–8"]);

  const guestName = inputRows(TOOL_INPUTS.book_hotel).find(
    (row) => row.path === "items[].hotel.rooms[].guests[].firstName",
  );
  assert.equal(guestName?.badge, "required");
});

test("a union input lists each branch with its own fields", () => {
  const rows = inputRows(TOOL_INPUTS.search_hotels);
  const destination = rows.find((row) => row.key === "destination");
  assert.equal(destination?.type, "object");
  const branches = rows.filter(
    (row) => row.variant && row.path === "destination",
  );
  assert.deepEqual(
    branches.map((row) => row.type),
    [
      'kind: "place_name"',
      'kind: "place"',
      'kind: "point"',
      'kind: "country"',
      'kind: "locality"',
    ],
  );
  // A branch states what its discriminator means.
  assert.ok(branches.every((row) => row.description));
  const name = rows.find((row) => row.key === "destination<place_name>.name");
  assert.equal(name?.path, "destination.name");
  assert.equal(name?.badge, "required");
  assert.equal(name?.depth, 2);
  // The same field in two branches keeps each branch's own description.
  const placeIds = rows.filter((row) => row.path === "destination.placeId");
  assert.equal(placeIds.length, 2);
  const lat = rows.find((row) => row.key === "destination<point>.location.lat");
  assert.equal(lat?.depth, 3);
});

test("output rows show nulls, open enums and object arrays with []", () => {
  const rows = new Map(outputRows(searchResult).map((row) => [row.key, row]));
  assert.equal(rows.get("data")?.type, "object[]");
  assert.equal(rows.get("data[].price")?.type, "object | null");
  assert.equal(rows.get("data[].price.fromPerRoomNight.amount")?.depth, 3);
  assert.equal(rows.get("nextCursor")?.type, "string | null");
  const sort = rows.get("sort");
  assert.equal(
    sort?.type,
    '"distance" | "relevance" | "stars_desc" | "price_asc" | "price_desc"',
  );
  assert.ok(sort?.meta.some((meta) => /any other string/.test(meta)));
  // Output rows have no required badge: every field is always there.
  assert.equal(rows.get("coverage")?.badge, undefined);
});

test("an open union in an output lists its known branches", () => {
  const rows = outputRows(order);
  const items = rows.filter((row) => row.variant && row.path === "items[]");
  assert.deepEqual(
    items.map((row) => row.type),
    ['type: "hotel"'],
  );
  assert.ok(
    rows.some((row) => row.key === "items[]<hotel>.hotel.confirmationNumber"),
  );
});
