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

  it("remote clients use the MCP server URL; Claude Desktop runs the local bridge", () => {
    for (const id of ["codex", "claude-code", "cursor", "claude-ai", "chatgpt"] as const) {
      assert.ok(JSON.stringify(CLIENT_SETUP[id]).includes(MCP_SERVER_URL), id);
    }
    const desktop = CLIENT_SETUP["claude-desktop"].code?.text ?? "";
    assert.deepEqual(JSON.parse(desktop), {
      mcpServers: { fortrip: { command: "npx", args: ["-y", "fortrip", "mcp"] } },
    });
  });

  it("/install shows every client and the MCP Registry entry", () => {
    const text = pageText("/install");
    for (const id of CLIENT_IDS) assert.ok(text.includes(CLIENT_SETUP[id].name), id);
    assert.ok(text.includes(MCP_SERVER_URL));
    assert.match(text, /MCP Registry/);
    assert.doesNotMatch(text, /coming soon/i);
  });
});
