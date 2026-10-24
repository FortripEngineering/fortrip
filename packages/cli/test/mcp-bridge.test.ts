import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { CONTRACT_VERSION, renderGuide, TOOLS } from "@fortrip/agent-contract";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  InMemoryTransport,
  type JSONRPCMessage,
  McpServer,
  Server,
  type StandardSchemaWithJSON,
  type ToolCallback,
} from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { loadSession, saveSession, tryLoginLock } from "../src/credentials.ts";
import { runMcpBridge } from "../src/mcp-bridge.ts";
import { type FakeApi, MCP_TOOLS, startFakeApi } from "./helpers/fake-api.ts";

let api: FakeApi;
let apiUrl: string;
before(async () => {
  api = await startFakeApi();
  apiUrl = api.url;
});
after(() => api.close());

type Message = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: Record<string, unknown> };
};

const initialize = (id = 1): Message => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.0" },
  },
});
const initialized: Message = { jsonrpc: "2.0", method: "notifications/initialized" };
const listTools = (id: number): Message => ({ jsonrpc: "2.0", id, method: "tools/list" });
const callTool = (id: number, name = "search_hotels"): Message => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: {} },
});

/**
 * The hosted MCP server as its route registers it (`serverInfo`,
 * `instructions`, then each contract tool with its title, description,
 * annotations and schemas), with handlers that are never called.
 */
function hostedServer(): McpServer {
  const server = new McpServer(
    { name: "fortrip", version: CONTRACT_VERSION },
    { instructions: renderGuide("mcp", "main") },
  );
  const handler = () => ({ content: [] });
  for (const spec of TOOLS) {
    const config = {
      title: spec.title,
      description: spec.description,
      annotations: spec.annotations,
      outputSchema: spec.output ?? undefined,
    };
    if (spec.input === null) {
      server.registerTool(spec.name, config, handler);
    } else {
      server.registerTool(
        spec.name,
        { ...config, inputSchema: spec.input },
        handler as ToolCallback<StandardSchemaWithJSON>,
      );
    }
  }
  return server;
}

/** What a fresh `hostedServer()` answers each of `requests` with, in order. */
async function hostedAnswers(...requests: Message[]): Promise<Message[]> {
  const [client, server] = InMemoryTransport.createLinkedPair();
  const answers: Message[] = [];
  client.onmessage = (message) => void answers.push(message as Message);
  await hostedServer().connect(server);
  for (const request of requests) {
    const count = answers.length + 1;
    await client.send(request as JSONRPCMessage);
    await until(() => (answers.length === count ? true : undefined));
  }
  await client.close();
  return answers;
}

/** The tools an SDK client lists from a fresh `hostedServer()`, as JSON
 *  carries them (no keys whose value is `undefined`). */
async function hostedTools(): Promise<unknown> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await hostedServer().connect(serverSide);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  return JSON.parse(JSON.stringify(tools));
}

/** Polls until `read` has a value. */
async function until<T>(read: () => T | undefined): Promise<T> {
  for (let waited = 0; waited < 5_000; waited += 5) {
    const value = read();
    if (value !== undefined) return value;
    await sleep(5);
  }
  assert.fail("timed out waiting");
}

const bridges: Bridge[] = [];
interface Bridge {
  /** Every line the bridge wrote to stdout, as written. */
  lines: string[];
  messages: Message[];
  done: Promise<void>;
  send(message: Message): void;
  reply(id: string | number): Promise<Message>;
  request(message: Message): Promise<Message>;
  close(): Promise<void>;
}

/** An MCP client on the stdio of a bridge run in this process. */
function startBridge(url = apiUrl, options?: { switchTimeoutMs?: number }): Bridge {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const lines: string[] = [];
  const messages: Message[] = [];
  let buffer = "";
  stdout.setEncoding("utf8");
  stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      lines.push(line);
      // A line that isn't JSON fails the check after the test.
      try {
        messages.push(JSON.parse(line) as Message);
      } catch {}
    }
  });
  const done = runMcpBridge(url, { stdin, stdout }, options);
  const bridge: Bridge = {
    lines,
    messages,
    done,
    send: (message) => void stdin.write(`${JSON.stringify(message)}\n`),
    reply: (id) => until(() => messages.find((m) => m.id === id && !m.method)),
    request(message) {
      bridge.send(message);
      return bridge.reply(message.id as string | number);
    },
    async close() {
      stdin.end();
      await done;
    },
  };
  bridges.push(bridge);
  return bridge;
}

beforeEach(async () => {
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "fortrip-mcp-"));
  delete process.env.FORTRIP_TOKEN;
  api.reset();
});

afterEach(async () => {
  mock.restoreAll();
  for (const bridge of bridges.splice(0)) {
    await bridge.close();
    // stdout is the client's: nothing but JSON-RPC may reach it.
    for (const line of bridge.lines) assert.equal(JSON.parse(line).jsonrpc, "2.0", line);
    // Each request is answered once at most.
    const answered = bridge.messages.filter((m) => m.id !== undefined && !m.method).map((m) => m.id);
    assert.equal(new Set(answered).size, answered.length, `answered twice: ${answered.join(", ")}`);
  }
});

/** Saves a session the fake accepts, and returns its access token. */
async function signIn(): Promise<string> {
  const session = api.session();
  await saveSession(apiUrl, session);
  return session.accessToken;
}

/** An initialized bridge whose session the server then stops accepting. */
async function bridgeWithRevokedToken(): Promise<{ bridge: Bridge; revoked: string }> {
  const revoked = await signIn();
  const bridge = startBridge();
  await bridge.request(initialize());
  api.accessTokens.delete(revoked);
  return { bridge, revoked };
}

describe("fortrip mcp bridge", () => {
  it("initialize and tools/list pass through unchanged", async () => {
    const token = await signIn();
    const bridge = startBridge();

    assert.deepEqual(await bridge.request(initialize()), {
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-fortrip", version: "0.0.0" },
      },
    });
    bridge.send(initialized);
    await until(() => (api.mcpRequests.length === 2 ? true : undefined));
    assert.deepEqual(await bridge.request(listTools(2)), {
      jsonrpc: "2.0",
      id: 2,
      result: { tools: MCP_TOOLS },
    });

    assert.deepEqual(
      api.mcpRequests.map((request) => request.message),
      [initialize(), initialized, listTools(2)],
    );
    assert.deepEqual(
      api.mcpRequests.map((request) => request.token),
      [token, token, token],
    );
    // The session the server opened and the version agreed in the handshake
    // are carried by every request after it.
    assert.deepEqual(
      api.mcpRequests.map((request) => [request.sessionId, request.protocolVersion]),
      [
        [undefined, undefined],
        ["fake-session-1", "2025-06-18"],
        ["fake-session-1", "2025-06-18"],
      ],
    );
  });

  it("sends messages on in the order the client wrote them", async () => {
    await signIn();
    const bridge = startBridge();
    await bridge.request(initialize());
    const count = 100;

    for (let n = 0; n < count; n++) {
      bridge.send({ jsonrpc: "2.0", method: "notifications/message", params: { n } });
    }
    await until(() => (api.mcpRequests.length === count + 1 ? true : undefined));

    assert.deepEqual(
      api.mcpRequests.slice(1).map((request) => (request.message.params as { n: number }).n),
      Array.from({ length: count }, (_, n) => n),
    );
  });

  it("passes server notifications and requests through, and the client's answers back", async () => {
    await signIn();
    const bridge = startBridge();
    await bridge.request(initialize());

    assert.deepEqual(await bridge.request(callTool(2)), {
      jsonrpc: "2.0",
      id: 2,
      result: { content: [{ type: "text", text: "ok" }] },
    });
    assert.deepEqual(bridge.messages.slice(1, 3), [
      { jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "searching" } },
      { jsonrpc: "2.0", id: "srv-1", method: "ping" },
    ]);

    const answer: Message = { jsonrpc: "2.0", id: "srv-1", result: {} };
    bridge.send(answer);
    await until(() => api.mcpRequests.find((request) => request.message.id === "srv-1"));
    assert.deepEqual(api.mcpRequests.at(-1)?.message, answer);
  });

  it("replays a request once after refreshing on 401", async () => {
    const { bridge, revoked } = await bridgeWithRevokedToken();

    assert.deepEqual(await bridge.request(listTools(2)), {
      jsonrpc: "2.0",
      id: 2,
      result: { tools: MCP_TOOLS },
    });

    assert.equal(api.counts.refreshes, 1);
    const tokens = api.mcpRequests.map((request) => request.token);
    assert.equal(tokens.length, 3);
    assert.deepEqual(tokens.slice(0, 2), [revoked, revoked]);
    const [, , replayed] = tokens;
    assert.ok(replayed && replayed !== revoked && api.accessTokens.has(replayed));
    // The next request starts from the refreshed session.
    assert.equal((await loadSession(apiUrl))?.accessToken, replayed);
    await bridge.request(listTools(3));
    assert.equal(api.mcpRequests.at(-1)?.token, replayed);
    assert.equal(api.counts.refreshes, 1);
  });

  it("requests that are turned down together refresh once", async () => {
    const { bridge } = await bridgeWithRevokedToken();

    const [first, second] = await Promise.all([
      bridge.request(listTools(2)),
      bridge.request(listTools(3)),
    ]);

    assert.deepEqual(first.result, { tools: MCP_TOOLS });
    assert.deepEqual(second.result, { tools: MCP_TOOLS });
    assert.equal(api.counts.refreshes, 1);
  });

  it("a second 401 answers with a sign-in error, not a crash", async () => {
    const { bridge } = await bridgeWithRevokedToken();
    api.options.rejectAll = true;
    const sent = api.mcpRequests.length;

    const reply = await bridge.request(listTools(2));

    assert.equal(reply.result, undefined);
    assert.equal(reply.error?.code, -32001);
    assert.match(reply.error?.message ?? "", /npx -y fortrip login/);
    // One refresh and one replay; no more.
    assert.equal(api.counts.refreshes, 1);
    assert.equal(api.mcpRequests.length - sent, 2);

    // The bridge is still serving, and the session it refreshed still works.
    api.options.rejectAll = false;
    assert.deepEqual((await bridge.request(listTools(3))).result, { tools: MCP_TOOLS });
  });

  it("a refresh the server refuses answers with the sign-in link", async () => {
    const { bridge } = await bridgeWithRevokedToken();
    api.refreshTokens.clear();

    const reply = await bridge.request(listTools(2));

    const loginUrl = `${apiUrl}/device?user_code=CODE-1`;
    assert.equal(reply.error?.code, -32001);
    assert.match(reply.error?.message ?? "", /npx -y fortrip login/);
    assert.ok(reply.error?.message.includes(loginUrl));
    assert.equal(reply.error?.data?.loginUrl, loginUrl);
  });

  it("a FORTRIP_TOKEN alone, with no saved session, is sent on at initialize", async () => {
    const token = api.session().accessToken;
    process.env.FORTRIP_TOKEN = token;
    const bridge = startBridge();

    assert.deepEqual((await bridge.request(initialize())).result, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "fake-fortrip", version: "0.0.0" },
    });
    assert.deepEqual(
      api.mcpRequests.map((request) => [request.message.method, request.token]),
      [["initialize", token]],
    );
  });

  it("a FORTRIP_TOKEN the server turns down is named at the first tool call, and never refreshed", async () => {
    process.env.FORTRIP_TOKEN = "not-a-token";
    await signIn();
    const bridge = startBridge();

    assert.deepEqual(await bridge.request(initialize()), (await hostedAnswers(initialize()))[0]);
    const reply = await bridge.request(callTool(2));

    assert.equal(reply.error?.code, -32001);
    assert.match(reply.error?.message ?? "", /FORTRIP_TOKEN/);
    assert.equal(api.counts.refreshes, 0);
    // Tried at `initialize`, and again at the tool call.
    assert.deepEqual(
      api.mcpRequests.map((request) => [request.message.method, request.token]),
      [
        ["initialize", "not-a-token"],
        ["initialize", "not-a-token"],
      ],
    );
  });

  it("a FORTRIP_TOKEN with a line break is refused by name, without being echoed", async () => {
    process.env.FORTRIP_TOKEN = "abc\nSECRETPART";
    await signIn();
    const bridge = startBridge();

    assert.ok((await bridge.request(initialize())).result);
    const reply = await bridge.request(callTool(2));

    assert.equal(reply.error?.code, -32001);
    assert.match(reply.error?.message ?? "", /FORTRIP_TOKEN/);
    assert.match(reply.error?.message ?? "", /line break/);
    assert.ok(!JSON.stringify(reply).includes("SECRETPART"));
    assert.ok(!bridge.lines.join("\n").includes("SECRETPART"));
    // Nothing was sent, and nothing was refreshed.
    assert.deepEqual(api.mcpRequests, []);
    assert.equal(api.counts.refreshes, 0);
  });

  it("a 503 is an error for that request, not a sign-in", async () => {
    await signIn();
    const bridge = startBridge();
    await bridge.request(initialize());
    api.scripts.mcp = [
      { status: 503, body: { success: false, error: "Sign-in service unavailable" } },
    ];

    const reply = await bridge.request(listTools(2));

    assert.equal(reply.error?.code, -32603);
    assert.match(reply.error?.message ?? "", /503/);
    assert.match(reply.error?.message ?? "", /Sign-in service unavailable/);
    assert.doesNotMatch(reply.error?.message ?? "", /fortrip login/);
    assert.equal(reply.error?.data?.status, 503);
    assert.equal(api.counts.refreshes, 0);
    assert.deepEqual((await bridge.request(listTools(3))).result, { tools: MCP_TOOLS });
  });

  it("passes the error the server answers a request with", async () => {
    await signIn();
    const bridge = startBridge();
    await bridge.request(initialize());
    api.scripts.mcp = [
      {
        status: 400,
        body: { jsonrpc: "2.0", error: { code: -32602, message: "Invalid params" }, id: null },
      },
    ];

    const reply = await bridge.request(listTools(2));

    assert.deepEqual(reply, {
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32602, message: "Invalid params" },
    });
  });

  it("a stream that ends before the answer fails that request", async () => {
    await signIn();
    const bridge = startBridge();
    await bridge.request(initialize());

    const reply = await bridge.request(callTool(2, "drop"));

    assert.equal(reply.error?.code, -32603);
    assert.match(reply.error?.message ?? "", /connection/i);
    assert.deepEqual((await bridge.request(listTools(3))).result, { tools: MCP_TOOLS });
  });

  it("a server that can't be reached answers with an error", async () => {
    // A port that was just free to listen on, and now nothing listens on.
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const unreachable = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise((resolve) => closed.close(resolve));
    await saveSession(unreachable, api.session());
    const bridge = startBridge(unreachable);

    const reply = await bridge.request(initialize());

    assert.equal(reply.error?.code, -32603);
    assert.match(reply.error?.message ?? "", new RegExp(`Could not reach ${unreachable}: .*ECONNREFUSED`));
  });

  it("SIGTERM closes both transports and ends the bridge", async () => {
    await signIn();
    const closes = [StdioServerTransport, StreamableHTTPClientTransport].map((transport) =>
      mock.method(transport.prototype, "close"),
    );
    const listeners = process.listenerCount("SIGTERM");
    const bridge = startBridge();
    await bridge.request(initialize());
    assert.equal(process.listenerCount("SIGTERM"), listeners + 1);

    process.emit("SIGTERM", "SIGTERM");
    await bridge.done;

    for (const close of closes) assert.equal(close.mock.callCount(), 1);
    assert.equal(process.listenerCount("SIGTERM"), listeners);
  });

  it("closing stdin closes the HTTP transport and ends the bridge", async () => {
    await signIn();
    const close = mock.method(StreamableHTTPClientTransport.prototype, "close");
    const bridge = startBridge();
    await bridge.request(initialize());

    await bridge.close();

    assert.equal(close.mock.callCount(), 1);
    assert.equal(process.listenerCount("SIGTERM"), 0);
  });
});

describe("fortrip mcp bridge, signed out", () => {
  const loginUrl = () => `${apiUrl}/device?user_code=CODE-1`;

  it("answers initialize as the hosted server would, without calling it", async () => {
    const bridge = startBridge();
    // A version the SDK supports is kept; any other gets its latest.
    const unknownVersion = initialize(2);
    (unknownVersion.params as { protocolVersion: string }).protocolVersion = "1999-01-01";

    const first = await bridge.request(initialize());
    const second = await bridge.request(unknownVersion);

    assert.deepEqual([first, second], await hostedAnswers(initialize(), unknownVersion));
    assert.deepEqual(first.result, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: "fortrip", version: CONTRACT_VERSION },
      instructions: renderGuide("mcp", "main"),
    });
    assert.deepEqual(api.mcpRequests, []);
    assert.equal(api.counts.deviceStarts, 0);
  });

  it("lists the contract's tools as the SDK renders them", async () => {
    const bridge = startBridge();
    await bridge.request(initialize());
    bridge.send(initialized);

    const reply = await bridge.request(listTools(2));

    assert.deepEqual(reply, { jsonrpc: "2.0", id: 2, result: { tools: await hostedTools() } });
    const tools = (reply.result as { tools: Record<string, any>[] }).tools;
    assert.deepEqual(
      tools.map((tool) => tool.name),
      TOOLS.map((spec) => spec.name),
    );
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    // The MCP variants: get_hotel_offers' own default, book_hotel's nextStep.
    assert.equal(byName.get("get_hotel_offers")?.inputSchema.properties.limitPerHotel.default, 5);
    assert.ok(byName.get("book_hotel")?.outputSchema.properties.nextStep);
    assert.deepEqual(api.mcpRequests, []);
  });

  it("answers ping, and a method the hosted server lacks as the SDK does", async () => {
    const bridge = startBridge();
    await bridge.request(initialize());
    const ping: Message = { jsonrpc: "2.0", id: 2, method: "ping" };
    const unknown: Message = { jsonrpc: "2.0", id: 3, method: "resources/list" };

    const replies = [await bridge.request(ping), await bridge.request(unknown)];

    assert.deepEqual(replies[0], { jsonrpc: "2.0", id: 2, result: {} });
    assert.equal(replies[1]?.error?.code, -32601);
    assert.deepEqual(replies, (await hostedAnswers(initialize(), ping, unknown)).slice(1));
    assert.deepEqual(api.mcpRequests, []);
  });

  it("answers a tool call with the sign-in link, and keeps serving", async () => {
    const bridge = startBridge();
    await bridge.request(initialize());
    bridge.send(initialized);

    const reply = await bridge.request(callTool(2));

    assert.equal(reply.error?.code, -32001);
    assert.match(reply.error?.message ?? "", /npx -y fortrip login/);
    assert.ok(reply.error?.message.includes(loginUrl()));
    assert.equal(reply.error?.data?.loginUrl, loginUrl());
    assert.equal(reply.error?.data?.userCode, "CODE-1");
    assert.deepEqual(api.mcpRequests, []);
    assert.deepEqual((await bridge.request(listTools(3))).result, { tools: await hostedTools() });
  });

  it("once the link is approved, the next tool call initializes the hosted server once and goes there", async () => {
    api.options.protocolVersion = "2025-03-26";
    const bridge = startBridge();
    await bridge.request(initialize());
    bridge.send(initialized);
    assert.equal((await bridge.request(callTool(2))).error?.code, -32001);

    api.approve(loginUrl());
    const reply = await bridge.request(callTool(3));

    assert.deepEqual(reply, { jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "ok" }] } });
    // The client's initialize, as it sent it; the bridge's initialized; the call.
    assert.deepEqual(
      api.mcpRequests.map((request) => request.message),
      [initialize(), initialized, callTool(3)],
    );
    // The session the hosted server opened and the version it answered with
    // ride on the requests after it.
    assert.deepEqual(
      api.mcpRequests.map((request) => [request.sessionId, request.protocolVersion]),
      [
        [undefined, undefined],
        ["fake-session-1", "2025-03-26"],
        ["fake-session-1", "2025-03-26"],
      ],
    );
    // The client heard the local initialize answer, that the tool list may
    // have changed (the local answer said it can), and the call's messages;
    // not the hosted server's initialize answer.
    assert.equal(bridge.messages.filter((m) => m.id === 1).length, 1);
    assert.deepEqual(
      bridge.messages.slice(2).map((m) => m.method ?? m.id),
      ["notifications/tools/list_changed", "notifications/message", "ping", 3],
    );
  });

  it("tells the client the tool list may have changed only if its local initialize said it can", async () => {
    // A local server that doesn't advertise `tools.listChanged`.
    mock.method(Server.prototype, "getCapabilities", () => ({ tools: {} }));
    const bridge = startBridge();
    const { result } = await bridge.request(initialize());
    assert.deepEqual((result as { capabilities: unknown }).capabilities, { tools: {} });
    bridge.send(initialized);
    await signIn();

    assert.ok((await bridge.request(callTool(2))).result);

    assert.ok(!bridge.messages.some((m) => m.method === "notifications/tools/list_changed"));
  });

  it("a switch whose answer stream ends without the answer fails that call, and the bridge keeps serving", async () => {
    const bridge = startBridge();
    await bridge.request(initialize());
    bridge.send(initialized);
    await signIn();
    api.options.stall = { method: "initialize", how: "drop" };

    const reply = await bridge.request(callTool(2));

    assert.equal(reply.error?.code, -32603);
    assert.match(reply.error?.message ?? "", /connection/i);
    assert.equal(reply.error?.data?.retryable, true);
    assert.deepEqual((await bridge.request({ jsonrpc: "2.0", id: 3, method: "ping" })).result, {});
    api.options.stall = undefined;
    assert.ok((await bridge.request(callTool(4))).result);
  });

  it("an error answer to the switch's initialize answers that call, and the bridge stays local", async () => {
    const bridge = startBridge();
    await bridge.request(initialize());
    bridge.send(initialized);
    await signIn();
    const error = { code: -32602, message: "Unsupported protocol version" };
    api.options.initializeError = error;

    const reply = await bridge.request(callTool(2));

    assert.deepEqual(reply, { jsonrpc: "2.0", id: 2, error });
    assert.deepEqual((await bridge.request(listTools(3))).result, { tools: await hostedTools() });
    assert.deepEqual(
      api.mcpRequests.map((request) => request.message.method),
      ["initialize"],
    );
    api.options.initializeError = undefined;
    assert.ok((await bridge.request(callTool(4))).result);
    assert.deepEqual(
      api.mcpRequests.map((request) => request.message.method),
      ["initialize", "initialize", "notifications/initialized", "tools/call"],
    );
  });

  it("a timed-out switch that settles after the next one started leaves that one its answer", async () => {
    const bridge = startBridge(apiUrl, { switchTimeoutMs: 1_500 });
    await bridge.request(initialize());
    bridge.send(initialized);
    // A session due for a refresh, while another command holds the login
    // lock: the switch waits on the lock past its deadline.
    await saveSession(apiUrl, api.session({ expiresAt: Date.now() }));
    const release = await tryLoginLock();
    assert.ok(release);

    assert.equal((await bridge.request(callTool(2))).error?.code, -32603);
    // The next switch starts while the first still waits on the lock; the
    // first settles once it is released.
    bridge.send(callTool(3));
    await release();

    assert.ok((await bridge.reply(3)).result);
    assert.equal(api.counts.refreshes, 1);
  });

  for (const method of ["initialize", "notifications/initialized"]) {
    it(`a switch whose ${method} isn't answered in time fails the calls waiting on it, and the bridge stays local`, async () => {
      const bridge = startBridge(apiUrl, { switchTimeoutMs: 200 });
      await bridge.request(initialize());
      bridge.send(initialized);
      await signIn();
      api.options.stall = { method, how: "hang" };

      bridge.send(callTool(2));
      bridge.send(callTool(3));
      bridge.send({ jsonrpc: "2.0", id: 4, method: "ping" });
      bridge.send(listTools(5));
      const replies = await Promise.all([2, 3, 4, 5].map((id) => bridge.reply(id)));

      // Both calls waited on the one switch, and get the retryable error.
      for (const reply of replies.slice(0, 2)) {
        assert.equal(reply.error?.code, -32603);
        assert.equal(reply.error?.data?.retryable, true);
      }
      // The bridge is still local: ping and tools/list are answered here.
      assert.deepEqual(replies[2]?.result, {});
      assert.deepEqual(replies[3]?.result, { tools: await hostedTools() });
      const tried = api.mcpRequests.map((request) => request.message.method);
      assert.equal(tried.filter((m) => m === "initialize").length, 1);
      assert.ok(!tried.includes("tools/call"));

      // The next call tries the switch again.
      api.options.stall = undefined;
      assert.ok((await bridge.request(callTool(6))).result);
      assert.deepEqual(
        api.mcpRequests.slice(tried.length).map((request) => request.message.method),
        ["initialize", "notifications/initialized", "tools/call"],
      );
    });
  }

  it("requests sent during the switch go on in order after one initialize; earlier notifications don't", async () => {
    const bridge = startBridge();
    await bridge.request(initialize());
    bridge.send(initialized);
    await bridge.request(listTools(2));
    await signIn();
    bridge.send({ jsonrpc: "2.0", method: "notifications/roots/list_changed" });

    bridge.send(callTool(3));
    bridge.send(callTool(4));
    const replies = [await bridge.reply(3), await bridge.reply(4)];

    for (const reply of replies) {
      assert.deepEqual(reply.result, { content: [{ type: "text", text: "ok" }] });
    }
    assert.deepEqual(
      api.mcpRequests.map((request) => request.message.method),
      ["initialize", "notifications/initialized", "tools/call", "tools/call"],
    );
    assert.deepEqual(
      api.mcpRequests.slice(2).map((request) => request.message.id),
      [3, 4],
    );
  });

  it("a saved session the hosted server turns down at initialize is answered locally", async () => {
    await signIn();
    api.options.rejectAll = true;
    const bridge = startBridge();

    const reply = await bridge.request(initialize());

    assert.deepEqual(reply, (await hostedAnswers(initialize()))[0]);
    // One refresh and one replay, as for any request.
    assert.equal(api.counts.refreshes, 1);
    assert.deepEqual(
      api.mcpRequests.map((request) => request.message.method),
      ["initialize", "initialize"],
    );

    // Still turned down at the first tool call; accepted at the next.
    assert.equal((await bridge.request(callTool(2))).error?.code, -32001);
    api.options.rejectAll = false;
    assert.ok((await bridge.request(callTool(3))).result);
  });

  it("a saved session whose refresh is refused is answered locally, with the link at the tool call", async () => {
    await saveSession(apiUrl, { ...api.session(), accessToken: "revoked", refreshToken: "spent" });
    const bridge = startBridge();

    const reply = await bridge.request(initialize());

    assert.deepEqual(reply, (await hostedAnswers(initialize()))[0]);
    assert.equal(api.counts.refreshes, 1);
    const call = await bridge.request(callTool(2));
    assert.equal(call.error?.code, -32001);
    assert.equal(call.error?.data?.loginUrl, loginUrl());
  });
});

describe("fortrip mcp", () => {
  const children: ChildProcess[] = [];
  // A process left running by a failed test would keep the test run alive.
  afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
  });

  /** `fortrip mcp` in its own process, run against the fake. */
  function spawnBridge(env: NodeJS.ProcessEnv = {}) {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "mcp"], {
      env: { ...process.env, FORTRIP_API_URL: apiUrl, FORTRIP_TOKEN: "", ...env },
    });
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => void (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => void (stderr += chunk));
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.on("exit", (code, signal) => resolve({ code, signal })),
    );
    /** Every line of stdout, each of which must be a JSON-RPC message. */
    const messages = () =>
      stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as Message;
          } catch {
            return assert.fail(`stdout has a line that isn't JSON: ${line}`);
          }
        });
    return {
      child,
      exit,
      messages,
      stderr: () => stderr,
      request(message: Message) {
        child.stdin.write(`${JSON.stringify(message)}\n`);
        return until(() => messages().find((m) => m.id === message.id && !m.method));
      },
    };
  }

  it("bridges stdin and stdout to the hosted server and exits 0 on SIGTERM", async () => {
    const token = await signIn();
    const bridge = spawnBridge();

    assert.ok((await bridge.request(initialize())).result);
    assert.deepEqual((await bridge.request(listTools(2))).result, { tools: MCP_TOOLS });
    bridge.child.kill("SIGTERM");

    assert.deepEqual(await bridge.exit, { code: 0, signal: null });
    assert.deepEqual(
      bridge.messages().map((m) => m.jsonrpc),
      ["2.0", "2.0"],
    );
    assert.ok(!bridge.stderr().includes(token));
  });

  it("serves a signed-out client, answers its tool call with the sign-in link, logs to stderr, and exits 0 when stdin ends", async () => {
    const bridge = spawnBridge();

    assert.ok((await bridge.request(initialize())).result);
    assert.equal(
      ((await bridge.request(listTools(2))).result as { tools: unknown[] }).tools.length,
      TOOLS.length,
    );
    const reply = await bridge.request(callTool(3));
    bridge.child.stdin.end();

    assert.equal(reply.error?.code, -32001);
    assert.match(reply.error?.message ?? "", /npx -y fortrip login/);
    assert.deepEqual(await bridge.exit, { code: 0, signal: null });
    // stdout held the three replies; the diagnosis went to stderr.
    assert.equal(bridge.messages().length, 3);
    assert.match(bridge.stderr(), /fortrip mcp/);
  });

  it("signed out, answers what a client writes before closing stdin straight away", async () => {
    const bridge = spawnBridge();

    bridge.child.stdin.end(`${JSON.stringify(initialize())}\n${JSON.stringify(listTools(2))}\n`);

    assert.deepEqual(await bridge.exit, { code: 0, signal: null });
    const [init, list] = bridge.messages();
    assert.deepEqual([init?.id, list?.id], [1, 2]);
    assert.equal((list?.result as { tools: unknown[] }).tools.length, TOOLS.length);
    assert.deepEqual(api.mcpRequests, []);
  });

  it("a FORTRIP_TOKEN with a line break is named in the error and appears in neither stdout nor stderr", async () => {
    const bridge = spawnBridge({ FORTRIP_TOKEN: "abc\nSECRETPART" });

    assert.ok((await bridge.request(initialize())).result);
    const reply = await bridge.request(callTool(2));
    bridge.child.stdin.end();

    assert.equal(reply.error?.code, -32001);
    assert.match(reply.error?.message ?? "", /FORTRIP_TOKEN/);
    assert.deepEqual(await bridge.exit, { code: 0, signal: null });
    assert.ok(!JSON.stringify(bridge.messages()).includes("SECRETPART"));
    assert.ok(!bridge.stderr().includes("SECRETPART"));
    assert.deepEqual(api.mcpRequests, []);
  });
});
