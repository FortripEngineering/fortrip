import assert from "node:assert/strict";
import { test } from "node:test";

import { TOOLS } from "@fortrip/agent-contract";

import { RESPONSE_DOCS, responseDocFor } from "../lib/reference/response-docs.ts";
import { outputRows } from "../lib/reference/schema-rows.ts";

test("every tool that answers an object has its response documented once", () => {
  for (const tool of TOOLS) {
    const docs = RESPONSE_DOCS.filter((doc) => doc.tools.includes(tool.name));
    assert.equal(docs.length, tool.output ? 1 : 0, tool.name);
    assert.equal(responseDocFor(tool.name), docs[0], tool.name);
  }
});

test("a documented response is the contract's schema, or the MCP one less nextStep", () => {
  for (const doc of RESPONSE_DOCS) {
    assert.ok(doc.rows.length > 0, doc.id);
    assert.deepEqual(
      doc.rows,
      outputRows(doc.schema),
      `${doc.id}: rows come from the schema`,
    );
    for (const name of doc.tools) {
      const tool = TOOLS.find((candidate) => candidate.name === name);
      assert.ok(tool?.output, name);
      if (tool.output === doc.schema) continue;
      // The MCP answer adds `nextStep` (the consent rule) and nothing else.
      const mcp = outputRows(tool.output).map((row) => row.key);
      assert.deepEqual(
        mcp.filter((key) => key !== "nextStep"),
        doc.rows.map((row) => row.key),
        name,
      );
      assert.ok(mcp.includes("nextStep"), name);
      assert.equal(doc.mcpNextStep, true, name);
    }
  }
});

test("the anchors are unique", () => {
  const ids = RESPONSE_DOCS.map((doc) => doc.id);
  assert.equal(new Set(ids).size, ids.length);
});
