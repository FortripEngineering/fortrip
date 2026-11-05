import assert from "node:assert/strict";
import { describe, it } from "node:test";

import cli from "../../cli/package.json" with { type: "json" };

import { fact, type FactPath } from "../components/fact.tsx";

describe("fact", () => {
  it("reads a limit from the contract", () => {
    assert.equal(fact("LIMITS.rooms"), "8");
  });

  it("reads a nested rate limit", () => {
    assert.equal(fact("RATE_LIMITS.search.limit"), "10");
  });

  it("formats numbers with thousands separators", () => {
    assert.equal(fact("LIMITS.radiusMetersMax"), "80,000");
  });

  it("reads a top-level constant", () => {
    assert.equal(fact("MCP_SERVER_URL"), "https://mcp.fortrip.ai/");
  });

  it("reads the oldest Node.js the CLI supports from its package", () => {
    assert.equal(`>=${fact("CLI_NODE_MAJOR")}`, cli.engines.node);
  });

  it("fails on a path the contract doesn't have", () => {
    assert.throws(() => fact("LIMITS.nope" as FactPath), /Unknown fact: LIMITS\.nope/);
  });

  it("fails on a path that stops short of a value", () => {
    assert.throws(() => fact("RATE_LIMITS.search" as FactPath), /Unknown fact/);
    assert.throws(() => fact("MCP_SERVER_URL.length" as FactPath), /Unknown fact/);
  });
});
