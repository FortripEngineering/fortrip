import assert from "node:assert/strict";
import { test } from "node:test";

import { ENABLED_REGIONS } from "@fortrip/agent-contract/regions";

import { regionGroups } from "../lib/reference/regions.ts";

test("the page lists every contract region once, in the EnabledRegion shape", () => {
  const listed = regionGroups().flatMap((group) => group.regions);
  assert.equal(listed.length, ENABLED_REGIONS.length);
  assert.deepEqual(
    listed.map((region) => region.placeId).sort(),
    ENABLED_REGIONS.map((region) => region.placeId).sort(),
  );
  for (const region of listed) {
    assert.deepEqual(Object.keys(region).sort(), ["countryCode", "name", "placeId"]);
    assert.match(region.placeId, /^plc_\d{1,12}$/);
    assert.match(region.countryCode, /^[A-Z]{2}$/);
    assert.ok(region.name.trim());
  }
});

test("regions are grouped by country, each group and region in name order", () => {
  const groups = regionGroups([
    { placeId: "plc_3", countryCode: "KR", name: "Seoul" },
    { placeId: "plc_1", countryCode: "JP", name: "Tokyo" },
    { placeId: "plc_2", countryCode: "KR", name: "Jeju-do" },
  ]);
  assert.deepEqual(
    groups.map((group) => [
      group.countryCode,
      group.country,
      group.regions.map((region) => region.name),
    ]),
    [
      ["JP", "Japan", ["Tokyo"]],
      ["KR", "South Korea", ["Jeju-do", "Seoul"]],
    ],
  );
});
