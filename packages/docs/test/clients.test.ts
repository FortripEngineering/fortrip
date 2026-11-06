// Reads the output of `next build`, which the package's test script runs first.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MCP_SERVER_URL } from "@fortrip/agent-contract";

import { CLIENT_IDS, CLIENT_SETUP } from "../lib/prose/clients.ts";
import { pageText } from "./built-page.ts";

describe("client setup", () => {
  it("covers each client once, in order", () => {
    assert.deepEqual(Object.keys(CLIENT_SETUP), [...CLIENT_IDS]);
    assert.deepEqual(CLIENT_IDS, ["codex", "claude-code", "cursor", "claude-desktop", "claude-ai", "chatgpt"]);
  });

  it("promises no store listing", () => {
    const all = JSON.stringify(CLIENT_SETUP);
    assert.doesNotMatch(all, /\bsoon\b|\bstore\b|\blisting\b/i);
  });

  it("every client uses the MCP server URL; Claude Desktop adds it like claude.ai, with the local bridge as the fallback", () => {
    for (const id of CLIENT_IDS) {
      assert.ok(JSON.stringify(CLIENT_SETUP[id]).includes(MCP_SERVER_URL), id);
    }
    const desktop = CLIENT_SETUP["claude-desktop"];
    assert.equal(desktop.code?.text, MCP_SERVER_URL);
    assert.match(desktop.steps[0] ?? "", /^The same as claude\.ai: go to Customize → Connectors/);
    assert.match(desktop.note ?? "", /\[local bridge\]\(#local-mcp\)/);
  });

  it("ChatGPT says it asks before an action that changes an order", () => {
    assert.match(CLIENT_SETUP.chatgpt.note ?? "", /approve each action that creates, pays or cancels an order/);
  });

  it("/install shows every client and the MCP Registry entry", () => {
    const text = pageText("/install");
    for (const id of CLIENT_IDS) assert.ok(text.includes(CLIENT_SETUP[id].name), id);
    assert.ok(text.includes(MCP_SERVER_URL));
    assert.match(text, /MCP Registry/);
    assert.doesNotMatch(text, /coming soon/i);
  });
});
