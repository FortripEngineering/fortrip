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

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { loadSession, saveSession } from "../src/credentials.ts";
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
function startBridge(url = apiUrl): Bridge {
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
  const done = runMcpBridge(url, { stdin, stdout });
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

  it("without a session the first request is answered with the sign-in link", async () => {
    const bridge = startBridge();

    const reply = await bridge.request(initialize());

    const loginUrl = `${apiUrl}/device?user_code=CODE-1`;
    assert.equal(reply.error?.code, -32001);
    assert.match(reply.error?.message ?? "", /npx -y fortrip login/);
    assert.ok(reply.error?.message.includes(loginUrl));
    assert.equal(reply.error?.data?.loginUrl, loginUrl);
    assert.equal(reply.error?.data?.userCode, "CODE-1");
    assert.deepEqual(api.mcpRequests, []);

    // Once the user approves the link, the next request signs in by itself.
    api.approve(loginUrl);
    assert.ok((await bridge.request(initialize(2))).result);
  });

  it("a FORTRIP_TOKEN the server turns down is named, and never refreshed", async () => {
    process.env.FORTRIP_TOKEN = "not-a-token";
    await signIn();
    const bridge = startBridge();

    const reply = await bridge.request(initialize());

    assert.equal(reply.error?.code, -32001);
    assert.match(reply.error?.message ?? "", /FORTRIP_TOKEN/);
    assert.equal(api.counts.refreshes, 0);
    assert.deepEqual(
      api.mcpRequests.map((request) => request.token),
      ["not-a-token"],
    );
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

describe("fortrip mcp", () => {
  const children: ChildProcess[] = [];
  // A process left running by a failed test would keep the test run alive.
  afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
  });

  /** `fortrip mcp` in its own process, run against the fake. */
  function spawnBridge() {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "mcp"], {
      env: { ...process.env, FORTRIP_API_URL: apiUrl, FORTRIP_TOKEN: "" },
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

  it("answers a signed-out client with the sign-in link, logs to stderr, and exits 0 when stdin ends", async () => {
    const bridge = spawnBridge();

    const reply = await bridge.request(initialize());
    bridge.child.stdin.end();

    assert.equal(reply.error?.code, -32001);
    assert.match(reply.error?.message ?? "", /npx -y fortrip login/);
    assert.deepEqual(await bridge.exit, { code: 0, signal: null });
    // stdout held the one reply; the diagnosis went to stderr.
    assert.equal(bridge.messages().length, 1);
    assert.match(bridge.stderr(), /fortrip mcp/);
  });
});
