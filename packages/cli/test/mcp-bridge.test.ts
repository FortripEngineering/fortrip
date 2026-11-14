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

import {
  CONTRACT_VERSION,
  errorEnvelope,
  parseOpen,
  renderError,
  renderGuide,
  SERVER_INFO,
  TOOLS,
} from "@fortrip/agent-contract";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  InMemoryTransport,
  type JSONRPCMessage,
  McpServer,
  Server,
  type StandardSchemaWithJSON,
  type ToolCallback,
} from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import { loadSession, saveSession, tryLoginLock } from "../src/credentials.ts";
import { runMcpBridge } from "../src/mcp-bridge.ts";
import { USER_AGENT, VERSION } from "../src/version.ts";
import {
  CLIENT_OUTDATED,
  envelope,
  type FakeApi,
  MCP_CALL_RESULT,
  MCP_TOOLS,
  mcpToolError as hostedToolError,
  startFakeApi,
} from "./helpers/fake-api.ts";

let api: FakeApi;
let apiUrl: string;
let mcpUrl: string;
before(async () => {
  api = await startFakeApi();
  apiUrl = api.url;
  mcpUrl = api.mcpUrl;
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

/** The hosted server's schema wrapper: the SDK advertises the contract's
 *  JSON Schema and its validator passes every value through. */
function hostedPassThrough(schema: StandardSchemaWithJSON): StandardSchemaWithJSON {
  return {
    "~standard": {
      version: 1,
      vendor: "fortrip",
      validate: (value) => ({ value }),
      jsonSchema: schema["~standard"].jsonSchema,
    },
  };
}

/**
 * The hosted MCP server as its route registers it in 6.0 (the contract's
 * `SERVER_INFO` with its version, `instructions`, then each contract tool
 * with its title, description, annotations and wrapped input schema, and no
 * output schema: a result is text only), with handlers that are never
 * called.
 */
function hostedServer(): McpServer {
  const server = new McpServer(
    { ...SERVER_INFO, version: CONTRACT_VERSION },
    { instructions: renderGuide("mcp", "main") },
  );
  const handler = () => ({ content: [] });
  for (const spec of TOOLS) {
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        annotations: spec.annotations,
        inputSchema: hostedPassThrough(spec.input as unknown as StandardSchemaWithJSON),
      },
      handler as ToolCallback<StandardSchemaWithJSON>,
    );
  }
  return server;
}

/** A tool error in the hosted server's 6.0 shape: `isError`, ONE text block,
 *  the envelope in `_meta`, and nothing else (no second block with the
 *  envelope as JSON, no `structuredContent`). Returns the text and the
 *  envelope. */
function toolError(reply: Message): { text: string; sent: { error: Record<string, unknown> } } {
  assert.equal(reply.error, undefined, JSON.stringify(reply.error));
  const result = reply.result as { content: { type: string; text: string }[]; _meta: Record<string, unknown> };
  assert.deepEqual(Object.keys(result).sort(), ["_meta", "content", "isError"]);
  assert.equal((result as { isError?: unknown }).isError, true);
  assert.equal(result.content.length, 1);
  assert.deepEqual(Object.keys(result.content[0] as object).sort(), ["text", "type"]);
  assert.equal(result.content[0]?.type, "text");
  assert.deepEqual(Object.keys(result._meta), ["ai.fortrip/error"]);
  const sent = result._meta["ai.fortrip/error"] as { error: Record<string, unknown> };
  assert.doesNotThrow(() => parseOpen(errorEnvelope, sent));
  return { text: result.content[0]?.text as string, sent };
}

/** The `unauthenticated` error a tool call was answered with, after
 *  checking that it has the hosted server's error shape and is a v1
 *  envelope with no `details`. Its one text block is the contract's words
 *  for a sign-in on the CLI, then the bridge's advice: returned as `advice`,
 *  it is what a model reads of what to do, and the end of the envelope's
 *  message. */
function signInRefusal(reply: Message): { advice: string; requestId: string } {
  const { text, sent } = toolError(reply);
  assert.deepEqual(Object.keys(sent).sort(), ["error"]);
  assert.deepEqual(Object.keys(sent.error).sort(), ["code", "message", "requestId", "retryable"]);
  assert.equal(sent.error.code, "unauthenticated");
  assert.equal(sent.error.retryable, false);
  const rendered = `${renderError(sent, undefined, "cli")}\n`;
  assert.ok(text.startsWith(rendered), text);
  const advice = text.slice(rendered.length);
  assert.ok(advice.length > 0 && !advice.includes("\n"), text);
  assert.ok((sent.error.message as string).endsWith(advice), text);
  return { advice, requestId: sent.error.requestId as string };
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

/**
 * The tools the hosted server lists, built from the contract alone (the
 * hosted route test's oracle): each tool's title, description and
 * annotations, and its input as `z.toJSONSchema(input, { io: "input" })`.
 * No tool has an output schema.
 */
function contractTools(): unknown[] {
  return TOOLS.map((spec) => ({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.input, { io: "input" }),
    annotations: spec.annotations,
  }));
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
function startBridge(
  url = mcpUrl,
  options?: { switchTimeoutMs?: number },
  signInUrl = apiUrl,
): Bridge {
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
  const done = runMcpBridge(url, signInUrl, { stdin, stdout }, options);
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
      result: MCP_CALL_RESULT,
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
    const { advice } = signInRefusal(await bridge.request(callTool(2)));

    assert.match(advice, /FORTRIP_TOKEN/);
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

    const { advice } = signInRefusal(reply);
    assert.match(advice, /FORTRIP_TOKEN/);
    assert.match(advice, /line break/);
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

  it("a tool call's answer, success or error, reaches the client unchanged", async () => {
    await signIn();
    const bridge = startBridge();
    await bridge.request(initialize());
    const booked = {
      content: [{ type: "text", text: "Order ord_00000000000000000001\n\nAsk first." }],
      _meta: { "ai.fortrip/requestId": "req_fakebook", "ai.fortrip/replayed": true },
    };
    const notFound = hostedToolError(envelope("not_found", "No such hotel."));
    api.toolResults = { create_order: booked, get_hotel: notFound };

    assert.deepEqual((await bridge.request(callTool(2, "create_order"))).result, booked);
    assert.deepEqual((await bridge.request(callTool(3, "get_hotel"))).result, notFound);
  });

  it("a tool call turned down after a refresh gets the hosted unauthenticated error; other requests a JSON-RPC error", async () => {
    const { bridge } = await bridgeWithRevokedToken();
    api.options.rejectAll = true;

    const { advice } = signInRefusal(await bridge.request(callTool(2)));
    const list = await bridge.request(listTools(3));

    assert.match(advice, /npx -y fortrip login/);
    assert.equal(list.error?.code, -32001);
    assert.match(list.error?.message ?? "", /npx -y fortrip login/);
  });

  it("a tool call the hosted server fails with the v1 envelope gets that envelope in the hosted error shape", async () => {
    await signIn();
    const bridge = startBridge();
    await bridge.request(initialize());
    const unavailable = envelope("service_unavailable", "Sign-in is unavailable right now.", {
      retryable: true,
      retryAfterSeconds: 5,
      requestId: "req_fake503",
    });
    api.scripts.mcp = [
      { status: 503, body: unavailable, headers: { "retry-after": "5" } },
      { status: 503, body: unavailable, headers: { "retry-after": "5" } },
    ];

    const call = await bridge.request(callTool(2));
    const list = await bridge.request(listTools(3));

    assert.deepEqual(call, { jsonrpc: "2.0", id: 2, result: hostedToolError(unavailable) });
    // A request that isn't a tool call can only get a JSON-RPC error: it
    // says what the envelope says.
    assert.equal(list.error?.code, -32603);
    assert.equal(
      list.error?.message,
      "Fortrip answered HTTP 503: Sign-in is unavailable right now. (request id req_fake503)",
    );
    assert.deepEqual(list.error?.data, { status: 503, retryable: true, retryAfterSeconds: 5 });
    assert.equal(api.counts.refreshes, 0);
  });

  it("every request carries the CLI's user agent: to the hosted server, and the sign-in's to the API", async () => {
    assert.equal(USER_AGENT, `fortrip-cli/${VERSION}`);
    const { bridge } = await bridgeWithRevokedToken();
    bridge.send(initialized);

    // A 401, the refresh it leads to and the replay; then a tool call.
    assert.deepEqual((await bridge.request(listTools(2))).result, { tools: MCP_TOOLS });
    assert.deepEqual((await bridge.request(callTool(3))).result, MCP_CALL_RESULT);

    const paths = new Set(api.requests.map((request) => request.path));
    for (const path of [new URL(mcpUrl).pathname, "/v1/auth/config", "/oauth/token"]) {
      assert.ok(paths.has(path), path);
    }
    assert.ok(api.mcpRequests.length >= 5, String(api.mcpRequests.length));
    for (const { method, path, userAgent } of api.requests) {
      assert.equal(userAgent, USER_AGENT, `${method} ${path}`);
    }
    for (const request of api.mcpRequests) assert.equal(request.userAgent, USER_AGENT);
  });

  it("client_outdated from the hosted server reaches the client as its tool error, and nothing retries", async () => {
    await signIn();
    const bridge = startBridge();
    await bridge.request(initialize());
    const outdated = hostedToolError(CLIENT_OUTDATED.body);
    api.toolResults = { search_hotels: outdated };
    const sent = api.mcpRequests.length;

    const reply = await bridge.request(callTool(2));

    assert.deepEqual(reply.result, outdated);
    // The one text block says what happened and the command that updates the CLI.
    assert.ok(toolError(reply).text.includes(CLIENT_OUTDATED.body.error.message));
    assert.equal(api.mcpRequests.length - sent, 1);
    assert.equal(api.counts.refreshes, 0);
  });

  it("an HTTP 426 from the hosted server is the client_outdated tool error for a tool call, sent once", async () => {
    await signIn();
    const bridge = startBridge();
    await bridge.request(initialize());
    api.scripts.mcp = [CLIENT_OUTDATED];
    const sent = api.mcpRequests.length;

    const reply = await bridge.request(callTool(2));

    assert.deepEqual(reply, { jsonrpc: "2.0", id: 2, result: hostedToolError(CLIENT_OUTDATED.body) });
    assert.equal(
      toolError(reply).text,
      // The service's message is its text, not the contract's: a JSON string.
      `Error client_outdated: ${JSON.stringify(CLIENT_OUTDATED.body.error.message)}\nNot retryable.\nRequest id: req_fakeoutdated`,
    );
    assert.equal(api.mcpRequests.length - sent, 1);
    assert.equal(api.counts.refreshes, 0);
    assert.equal(api.counts.deviceStarts, 0);

    // A request that isn't a tool call can only get a JSON-RPC error: it
    // carries the message too.
    api.scripts.mcp = [CLIENT_OUTDATED];
    const list = await bridge.request(listTools(3));
    assert.equal(list.error?.code, -32603);
    assert.ok(list.error?.message.includes(CLIENT_OUTDATED.body.error.message), list.error?.message);
    assert.equal(api.mcpRequests.length - sent, 2);
  });

  it("a redirect to another origin isn't followed: the token goes nowhere else", async () => {
    const elsewhere: string[] = [];
    const other = createServer((req, res) => {
      elsewhere.push(String(req.headers.authorization));
      res.writeHead(500).end();
    });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const target = `http://127.0.0.1:${(other.address() as AddressInfo).port}/mcp`;
    try {
      await signIn();
      const bridge = startBridge();
      api.scripts.mcp = [{ status: 307, body: {}, headers: { location: target } }];

      const reply = await bridge.request(initialize());

      assert.equal(reply.error?.code, -32603);
      assert.match(reply.error?.message ?? "", /307/);
      assert.deepEqual(elsewhere, []);
    } finally {
      await new Promise((resolve) => other.close(resolve));
    }
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
    await signIn();
    const bridge = startBridge(`${unreachable}/mcp`);

    const reply = await bridge.request(initialize());

    assert.equal(reply.error?.code, -32603);
    assert.match(reply.error?.message ?? "", new RegExp(`Could not reach ${unreachable}/mcp: .*ECONNREFUSED`));
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
      serverInfo: { ...SERVER_INFO, version: CONTRACT_VERSION },
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

    assert.deepEqual(reply, { jsonrpc: "2.0", id: 2, result: { tools: contractTools() } });
    const tools = (reply.result as { tools: Record<string, any>[] }).tools;
    assert.deepEqual(
      tools.map((tool) => tool.name),
      TOOLS.map((spec) => spec.name),
    );
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    // The service resolves limitPerHotel.
    assert.equal(byName.get("get_hotel_offers")?.inputSchema.properties.limitPerHotel.default, undefined);
    assert.deepEqual(api.mcpRequests, []);
  });

  it("registers each tool as the hosted server does: a pass-through input schema, and no output schema", async () => {
    const register = mock.method(McpServer.prototype, "registerTool");
    const bridge = startBridge();
    await bridge.request(initialize());
    const local = register.mock.calls.map((call) => call.arguments as unknown as [string, Record<string, any>]);
    register.mock.resetCalls();
    hostedServer();
    const hosted = register.mock.calls.map((call) => call.arguments as unknown as [string, Record<string, any>]);

    const shape = ([name, config]: [string, Record<string, any>]) => ({
      name,
      config: Object.keys(config).sort(),
      title: config.title,
      description: config.description,
      annotations: config.annotations,
    });
    assert.equal(local.length, TOOLS.length);
    assert.deepEqual(local.map(shape), hosted.map(shape));
    const json = (schema: any) => schema["~standard"].jsonSchema.input({ target: "draft-2020-12" });
    const notTheInput = { notAField: [1, "two"] };
    for (const [name, config] of local) {
      const spec = TOOLS.find((tool) => tool.name === name);
      assert.ok(spec);
      // A result is text only: no tool publishes an output schema.
      assert.deepEqual(Object.keys(config).sort(), ["annotations", "description", "inputSchema", "title"], name);
      // Never enforced: any value passes through, as on the hosted server.
      assert.deepEqual(config.inputSchema["~standard"].validate(notTheInput), { value: notTheInput }, name);
      assert.deepEqual(json(config.inputSchema), json(spec.input), name);
    }
  });

  it("a tool call gets the hosted unauthenticated error whatever its name or arguments", async () => {
    const bridge = startBridge();
    await bridge.request(initialize());
    bridge.send(initialized);
    const calls: Message[] = [
      { ...callTool(2), params: { name: "search_hotels", arguments: { notAField: true } } },
      { ...callTool(3), params: { name: "get_hotel" } },
      callTool(4, "no_such_tool"),
    ];

    const refusals = [];
    for (const call of calls) refusals.push(signInRefusal(await bridge.request(call)));

    for (const { advice } of refusals) assert.ok(advice.includes(loginUrl()), advice);
    // Each answer has its own request id, which says it never reached Fortrip.
    const ids = refusals.map(({ requestId }) => requestId);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^local_[0-9a-f]{20}$/);
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

    const { advice } = signInRefusal(await bridge.request(callTool(2)));

    assert.match(advice, /npx -y fortrip login/);
    assert.ok(advice.includes(loginUrl()));
    assert.deepEqual(api.mcpRequests, []);
    assert.deepEqual((await bridge.request(listTools(3))).result, { tools: contractTools() });
  });

  it("a tool call whose sign-in can't start gets Fortrip's envelope in the hosted error shape", async () => {
    const bridge = startBridge();
    await bridge.request(initialize());
    bridge.send(initialized);
    const unavailable = envelope("service_unavailable", "Sign-in is unavailable right now.", {
      retryable: true,
      retryAfterSeconds: 5,
      requestId: "req_fakeconfig",
    });
    api.scripts.config = [{ status: 503, body: unavailable }];

    const reply = await bridge.request(callTool(2));

    assert.deepEqual(reply, { jsonrpc: "2.0", id: 2, result: hostedToolError(unavailable) });
    assert.equal(api.counts.config, 1);
    assert.deepEqual(api.mcpRequests, []);
  });

  it("a CLI too old for the service: a tool call is answered client_outdated before any sign-in starts", async () => {
    const bridge = startBridge();
    await bridge.request(initialize());
    bridge.send(initialized);
    // The endpoint the CLI reads before it signs in.
    api.scripts.config = [CLIENT_OUTDATED];

    const reply = await bridge.request(callTool(2));

    assert.deepEqual(reply, { jsonrpc: "2.0", id: 2, result: hostedToolError(CLIENT_OUTDATED.body) });
    assert.ok(toolError(reply).text.includes("npm install -g fortrip@latest"));
    assert.equal(api.counts.config, 1);
    assert.equal(api.counts.deviceStarts, 0);
    assert.deepEqual(api.mcpRequests, []);
    // It keeps serving, as for any tool error.
    assert.deepEqual((await bridge.request(listTools(3))).result, { tools: contractTools() });
  });

  it("a tool call whose sign-in can't start, with no envelope, gets a retryable JSON-RPC error", async () => {
    const bridge = startBridge();
    await bridge.request(initialize());
    bridge.send(initialized);
    api.scripts.config = [{ status: 503, body: { not: "an envelope" } }];

    const reply = await bridge.request(callTool(2));

    assert.equal(reply.result, undefined);
    assert.equal(reply.error?.code, -32603);
    assert.equal(reply.error?.data?.retryable, true);
    assert.equal(api.counts.config, 1);
  });

  it("once the link is approved, the next tool call initializes the hosted server once and goes there", async () => {
    api.options.protocolVersion = "2025-03-26";
    const bridge = startBridge();
    await bridge.request(initialize());
    bridge.send(initialized);
    signInRefusal(await bridge.request(callTool(2)));

    api.approve(loginUrl());
    const reply = await bridge.request(callTool(3));

    assert.deepEqual(reply, { jsonrpc: "2.0", id: 3, result: MCP_CALL_RESULT });
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
    assert.deepEqual((await bridge.request(listTools(3))).result, { tools: contractTools() });
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
    const bridge = startBridge(mcpUrl, { switchTimeoutMs: 1_500 });
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
      const bridge = startBridge(mcpUrl, { switchTimeoutMs: 200 });
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
      assert.deepEqual(replies[3]?.result, { tools: contractTools() });
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
      assert.deepEqual(reply.result, MCP_CALL_RESULT);
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
    signInRefusal(await bridge.request(callTool(2)));
    api.options.rejectAll = false;
    assert.ok((await bridge.request(callTool(3))).result);
  });

  it("a saved session whose refresh is refused is answered locally, with the link at the tool call", async () => {
    await saveSession(apiUrl, { ...api.session(), accessToken: "revoked", refreshToken: "spent" });
    const bridge = startBridge();

    const reply = await bridge.request(initialize());

    assert.deepEqual(reply, (await hostedAnswers(initialize()))[0]);
    assert.equal(api.counts.refreshes, 1);
    const { advice } = signInRefusal(await bridge.request(callTool(2)));
    assert.ok(advice.includes(loginUrl()));
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
      env: { ...process.env, FORTRIP_API_URL: apiUrl, FORTRIP_MCP_URL: mcpUrl, FORTRIP_TOKEN: "", ...env },
    });
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => void (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => void (stderr += chunk));
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.on("exit", (code, signal) => resolve({ code, signal })),
    );
    /** Every line of stdout, each of which must be a JSON-RPC message. A
     *  line still arriving (a long one comes in several chunks) waits. */
    const messages = () =>
      stdout
        .slice(0, stdout.lastIndexOf("\n") + 1)
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

    assert.match(signInRefusal(reply).advice, /npx -y fortrip login/);
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

  it("connects to FORTRIP_MCP_URL with the sign-in saved for FORTRIP_API_URL", async () => {
    const token = await signIn();
    const bridge = spawnBridge();

    assert.ok((await bridge.request(initialize())).result);
    bridge.child.stdin.end();

    assert.deepEqual(await bridge.exit, { code: 0, signal: null });
    assert.deepEqual(
      api.mcpRequests.map((request) => [request.message.method, request.token]),
      [["initialize", token]],
    );
  });

  for (const [what, env, said] of [
    ["FORTRIP_API_URL set and FORTRIP_MCP_URL left out", { FORTRIP_MCP_URL: "" }, /FORTRIP_MCP_URL/],
    [
      "FORTRIP_MCP_URL on another origin than FORTRIP_API_URL",
      { FORTRIP_MCP_URL: "http://localhost:1/mcp" },
      /FORTRIP_MCP_URL must be on http:\/\/127\.0\.0\.1:\d+/,
    ],
    [
      "FORTRIP_MCP_URL with plain http off localhost",
      { FORTRIP_MCP_URL: "http://mcp.example.com/" },
      /FORTRIP_MCP_URL must use https \(http only for localhost\)/,
    ],
  ] as const) {
    it(`with ${what}, exits 2 and sends nothing`, async () => {
      const token = api.session().accessToken;
      const bridge = spawnBridge({ ...env, FORTRIP_TOKEN: token });

      assert.equal((await bridge.exit).code, 2);
      assert.match(bridge.stderr(), said);
      assert.ok(!bridge.stderr().includes(token));
      assert.deepEqual(bridge.messages(), []);
      assert.deepEqual(api.mcpRequests, []);
    });
  }

  it("a FORTRIP_TOKEN with a line break is named in the error and appears in neither stdout nor stderr", async () => {
    const bridge = spawnBridge({ FORTRIP_TOKEN: "abc\nSECRETPART" });

    assert.ok((await bridge.request(initialize())).result);
    const reply = await bridge.request(callTool(2));
    bridge.child.stdin.end();

    assert.match(signInRefusal(reply).advice, /FORTRIP_TOKEN/);
    assert.deepEqual(await bridge.exit, { code: 0, signal: null });
    assert.ok(!JSON.stringify(bridge.messages()).includes("SECRETPART"));
    assert.ok(!bridge.stderr().includes("SECRETPART"));
    assert.deepEqual(api.mcpRequests, []);
  });
});
