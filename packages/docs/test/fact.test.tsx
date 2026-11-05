import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fact, type FactPath } from "../components/fact.tsx";

describe("fact", () => {
  it("reads a limit from the contract", () => {
    assert.equal(fact("LIMITS.rooms"), "8");
  });

  it("reads a nested rate limit", () => {
    assert.equal(fact("RATE_LIMITS.search.limit"), "10");
  });

  it("reads a top-level constant", () => {
    assert.equal(fact("MCP_SERVER_URL"), "https://mcp.fortrip.ai/");
  });

  it("fails on a path the contract doesn't have", () => {
    assert.throws(() => fact("LIMITS.nope" as FactPath), /Unknown fact: LIMITS\.nope/);
  });

  it("fails on a path that stops short of a value", () => {
    assert.throws(() => fact("RATE_LIMITS.search" as FactPath), /Unknown fact/);
    assert.throws(() => fact("MCP_SERVER_URL.length" as FactPath), /Unknown fact/);
  });
});
