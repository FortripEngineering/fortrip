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

test("a documented response is the contract's schema", () => {
  for (const doc of RESPONSE_DOCS) {
    assert.ok(doc.rows.length > 0, doc.id);
    assert.deepEqual(
      doc.rows,
      outputRows(doc.schema),
      `${doc.id}: rows come from the schema`,
    );
    for (const name of doc.tools) {
      const tool = TOOLS.find((candidate) => candidate.name === name);
      // An MCP result is text only: a tool's output is its HTTP answer.
      assert.equal(tool?.output, doc.schema, name);
    }
  }
});

test("the anchors are unique", () => {
  const ids = RESPONSE_DOCS.map((doc) => doc.id);
  assert.equal(new Set(ids).size, ids.length);
});
