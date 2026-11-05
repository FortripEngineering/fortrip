import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MCP_SERVER_URL,
  ME_SCOPES,
  ORDER_HTTP,
  SEARCH_RULES,
  SKILL_INSTALL_COMMAND,
  REPOSITORY_URL,
  DOCS_ORIGIN,
} from "../src/index.ts";

describe("stated facts", () => {
  it("states the search rules", () => {
    assert.deepEqual(SEARCH_RULES, {
      largeSettlementPopulation: 50_000,
      dominanceRatio: 100,
      nearDuplicateMeters: 5_000,
      hubIncludes: 3,
    });
  });
  it("states how order creation answers", () => {
    assert.deepEqual(ORDER_HTTP, {
      createdStatus: 201,
      replayedStatus: 200,
      replayedHeader: "Idempotent-Replayed",
    });
  });
  it("states the scopes /v1/me needs", () => {
    assert.deepEqual(ME_SCOPES, { email: "email", name: "profile" });
  });
  it("states the install constants", () => {
    assert.equal(MCP_SERVER_URL, "https://mcp.fortrip.ai/");
    assert.equal(
      SKILL_INSTALL_COMMAND,
      "npx skills add FortripEngineering/fortrip --skill fortrip-cli",
    );
    assert.equal(REPOSITORY_URL, "https://github.com/FortripEngineering/fortrip");
    assert.equal(DOCS_ORIGIN, "https://docs.fortrip.ai");
  });
});
