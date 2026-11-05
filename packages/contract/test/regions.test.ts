import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENABLED_REGIONS } from "../src/regions.ts";

describe("enabled regions", () => {
  it("lists 754 regions with unique place ids", () => {
    assert.equal(ENABLED_REGIONS.length, 754);
    const ids = ENABLED_REGIONS.map((region) => region.placeId);
    assert.ok(ids.every((id) => /^plc_\d+$/.test(id)));
    assert.equal(new Set(ids).size, ids.length);
  });
});
