import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { API } from "../src/paths.ts";
import { ERROR_REASONS } from "../src/reasons.ts";
import { CONTRACT_VERSION } from "../src/version.ts";

describe("API", () => {
  it("puts every endpoint under /api/agent/v1, apart from the MCP server", () => {
    for (const [name, path] of Object.entries(API)) {
      if (typeof path !== "string" || name === "mcp") continue;
      assert.ok(path.startsWith("/api/agent/v1/"), `${name}: ${path}`);
    }
    assert.equal(API.mcp, "/api/mcp");
  });

  it("builds a hotel's path, asking for rooms only when told to", () => {
    assert.equal(API.hotel(12_345), "/api/agent/v1/hotels/12345");
    assert.equal(API.hotel(12_345, false), "/api/agent/v1/hotels/12345");
    assert.equal(
      API.hotel(12_345, true),
      "/api/agent/v1/hotels/12345?include=rooms",
    );
  });
});

describe("ERROR_REASONS", () => {
  it("maps each reason to a non-empty list of 4xx/5xx HTTP statuses", () => {
    for (const [reason, statuses] of Object.entries(ERROR_REASONS)) {
      assert.ok(statuses.length > 0, reason);
      for (const status of statuses) {
        assert.ok(status >= 400 && status < 600, `${reason}: ${status}`);
      }
    }
  });

  it("lists every status each reason is sent with", () => {
    assert.deepEqual(
      { ...ERROR_REASONS },
      {
        already_booked: [409],
        price_or_terms_changed: [409],
        rate_unavailable: [422],
        refused: [422],
        supplier_unavailable: [503, 504],
      },
    );
  });

  it("lets a status read off a response be looked up", () => {
    assert.ok(ERROR_REASONS.supplier_unavailable.includes(504));
    assert.ok(!ERROR_REASONS.already_booked.includes(504));
  });
});

describe("CONTRACT_VERSION", () => {
  it("is the version in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    assert.equal(CONTRACT_VERSION, pkg.version);
  });
});
