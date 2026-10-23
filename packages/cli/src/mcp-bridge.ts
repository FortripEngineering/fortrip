import type { Readable, Writable } from "node:stream";

import { API, CONTRACT_VERSION, renderGuide, TOOLS } from "@fortrip/agent-contract";
import {
  type FetchLike,
  isJSONRPCErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCResultResponse,
  type RequestId,
  SdkHttpError,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  InMemoryTransport,
  McpServer,
  type StandardSchemaWithJSON,
  type ToolCallback,
} from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { refreshSession, requireToken } from "./auth.ts";
import { loadSession } from "./credentials.ts";
import { CliError, EXIT } from "./errors.ts";

/** JSON-RPC error codes of the bridge's own answers: the user has to sign in,
 *  or Fortrip couldn't be reached or failed (the standard internal error). */
const SIGN_IN_REQUIRED = -32001;
const INTERNAL_ERROR = -32603;
const LOGIN_COMMAND = "npx -y fortrip login";

type RpcError = { code: number; message: string; data?: unknown };

/** What the bridge's fetch throws when only the user can fix the sign-in. */
class SignInRequired extends Error {
  constructor(
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const signInAdvice = (link = "") =>
  `Run \`${LOGIN_COMMAND}\` in a terminal${link}, then try again.`;

/**
 * Runs an auth call, turning a CliError that says "sign in" (exit 3, with
 * the link the CLI would show) into `SignInRequired`.
 */
async function signedIn<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CliError && error.exitCode === EXIT.unauthenticated) {
      // A FORTRIP_TOKEN that can't be sent: its message is the whole answer.
      if (error.details.tokenSource === "FORTRIP_TOKEN") throw new SignInRequired(error.message);
      const { loginUrl, userCode, expiresInSeconds } = error.details;
      throw new SignInRequired(
        `Not signed in to Fortrip, or the saved sign-in no longer works. ${signInAdvice(
          loginUrl ? `, or open ${loginUrl} and approve` : "",
        )}`,
        { loginUrl, userCode, expiresInSeconds },
      );
    }
    throw error;
  }
}

/**
 * `fetch` for the hosted server: every request carries the user's token, and
 * a 401 gets one refresh and one replay with the new token, as in
 * `authorizedRequest`. A token the server still turns down is the user's to
 * fix: `SignInRequired`. Any other answer, a 503 included, goes on to the
 * transport, which makes it an error for that request.
 */
function authorizedFetch(apiUrl: string): FetchLike {
  const attempt: FetchLike = async (url, init) => {
    try {
      return await fetch(url, init);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      const cause = (error as { cause?: Error })?.cause ?? (error as Error);
      throw new Error(`Could not reach ${apiUrl}: ${cause?.message ?? String(error)}`);
    }
  };
  // Each request starts only once the one before it has, so messages leave in
  // the order the client wrote them although finding a token (a file read,
  // sometimes a refresh) takes a varying time. A request doesn't wait for the
  // answer to the one before it.
  let turn: Promise<unknown> = Promise.resolve();
  return async (url, init) => {
    const withToken = (token: string) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${token}`);
      return attempt(url, { ...init, headers });
    };
    const started = turn.then(async () => {
      const { token, source } = await signedIn(() => requireToken(apiUrl));
      return { token, source, response: withToken(token) };
    });
    turn = started.catch(() => {});
    const { token, source, response } = await started;
    const first = await response;
    if (first.status !== 401) return first;
    await first.body?.cancel().catch(() => {});
    if (source === "env") {
      throw new SignInRequired(
        `Fortrip didn't accept FORTRIP_TOKEN. Replace it, or unset it and run \`${LOGIN_COMMAND}\`, then try again.`,
      );
    }
    // The token that was turned down: refreshSession uses a session another
    // request (or process) has refreshed meanwhile instead of refreshing again.
    const second = await withToken(await signedIn(() => refreshSession(apiUrl, token)));
    if (second.status !== 401) return second;
    await second.body?.cancel().catch(() => {});
    throw new SignInRequired(`Fortrip didn't accept the refreshed sign-in. ${signInAdvice()}`);
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The error a failed send is answered with. */
function rpcErrorOf(error: unknown): RpcError {
  if (error instanceof SignInRequired) {
    return { code: SIGN_IN_REQUIRED, message: error.message, data: error.data };
  }
  if (error instanceof SdkHttpError) {
    const { status } = error;
    const text = typeof error.data.text === "string" ? error.data.text : "";
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {}
    // A JSON-RPC error in the body is the server's own answer to the request.
    if (isRecord(body) && isRecord(body.error)) {
      const { code, message } = body.error;
      if (typeof code === "number" && typeof message === "string") return body.error as RpcError;
    }
    const said = isRecord(body) ? (body.error ?? body.message) : text.slice(0, 200);
    return {
      code: INTERNAL_ERROR,
      message: `Fortrip answered HTTP ${status}${typeof said === "string" && said ? `: ${said}` : ""}`,
      data: { status, ...(status >= 500 || status === 429 ? { retryable: true } : {}) },
    };
  }
  return {
    code: INTERNAL_ERROR,
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof CliError && error.details.retryable ? { data: { retryable: true } } : {}),
  };
}

const CONNECTION_LOST: RpcError = {
  code: INTERNAL_ERROR,
  message: "The connection to Fortrip ended before it answered.",
  data: { retryable: true },
};

/** Whether there is a sign-in to offer the hosted server: `FORTRIP_TOKEN`
 *  or a saved session. Unlike `requireToken` it never starts a device login.
 *  A credentials file that can't be read counts as none here; the first
 *  tool call then answers with what is wrong with it. */
async function hasSignIn(apiUrl: string): Promise<boolean> {
  if (process.env.FORTRIP_TOKEN?.trim()) return true;
  return (await loadSession(apiUrl).catch(() => null)) !== null;
}

/**
 * What answers the client while it isn't signed in: an MCP SDK server set up
 * as the hosted one is (its `serverInfo`, `instructions` and the contract's
 * tools, registered as the hosted server registers them), so `initialize`,
 * `tools/list`, `ping` and a method it lacks get the answers the hosted
 * server would give. Its tools are never called: the bridge takes a
 * `tools/call` to the hosted server.
 */
function localServer(): McpServer {
  const server = new McpServer(
    { name: "fortrip", version: CONTRACT_VERSION },
    { instructions: renderGuide("mcp", "main") },
  );
  const handler = (): never => {
    throw new Error("Fortrip's tools run on the hosted server.");
  };
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

/**
 * `fortrip mcp`: a stdio MCP server for Fortrip's hosted server (Streamable
 * HTTP, signed in with the CLI's session). It runs until stdin ends or it is
 * told to stop with SIGINT or SIGTERM; requests still waiting then go
 * unanswered, as for any stdio server.
 *
 * With a sign-in the hosted server takes, it forwards every JSON-RPC message
 * there and the hosted server's messages back, unchanged ("remote"). Without
 * one (none saved, or the hosted server or a refresh turns it down) it
 * answers `initialize`, `tools/list` and `ping` itself, as the hosted server
 * would ("local"), so a client connects and lists the tools before the user
 * has signed in. A tool call while local checks the sign-in the way the
 * commands do. Still signed out, the call is answered with a JSON-RPC error
 * (-32001, whose message names `LOGIN_COMMAND` and the sign-in link it
 * starts). Signed in by now (the link approved, or `LOGIN_COMMAND` run), the
 * bridge sends the client's `initialize` on to the hosted server and is
 * remote from that call on: no restart needed.
 *
 * stdout carries only JSON-RPC, so a problem the user has to fix is the
 * error response to the request that hit it, and the bridge stays up. A
 * sign-in that stops working mid-session fails only that request. All
 * diagnostics go to stderr.
 */
export async function runMcpBridge(
  apiUrl: string,
  io: { stdin: Readable; stdout: Writable; stderr?: Writable } = {
    stdin: process.stdin,
    stdout: process.stdout,
  },
): Promise<void> {
  const stderr = io.stderr ?? process.stderr;
  const stdio = new StdioServerTransport(io.stdin, io.stdout);
  const http = new StreamableHTTPClientTransport(new URL(API.mcp, apiUrl), {
    fetch: authorizedFetch(apiUrl),
  });
  const server = localServer();
  const [local, localServerEnd] = InMemoryTransport.createLinkedPair();
  // Looked up before stdin is read, so that signed out the answers to the
  // client's first messages wait on no I/O: a client that writes them and
  // closes stdin straight away (an inspector piping them in) still gets them.
  const signInSaved = await hasSignIn(apiUrl);
  let closed = false;
  /** Set once the hosted server has answered an `initialize`: from then on
   *  every message goes there. */
  let remote = false;
  /** The client's `initialize`, sent on to the hosted server at the switch. */
  let clientInitialize: JSONRPCRequest | undefined;
  /** Requests sent on that the server hasn't answered. */
  const pending = new Set<RequestId>();
  let initializeId: RequestId | undefined;
  /** Requests whose answer the bridge waits for itself (`ask`). */
  const asked = new Map<RequestId, (answer: JSONRPCResponse) => void>();

  const log = (message: string) => {
    if (!closed) stderr.write(`fortrip mcp: ${message}\n`);
  };
  const toClient = (message: JSONRPCMessage) => {
    stdio.send(message).catch((cause: Error) => log(cause.message));
  };
  const fail = (id: RequestId, error: RpcError) => {
    if (closed || !pending.delete(id)) return;
    toClient({ jsonrpc: "2.0", id, error });
  };
  // What a Client does once it is initialized: later requests name the
  // protocol version they agreed on.
  const adopt = ({ result }: JSONRPCResultResponse) => {
    if (typeof result.protocolVersion === "string") http.setProtocolVersion(result.protocolVersion);
  };

  /** Sends a client message on to the hosted server. */
  const forward = async (message: JSONRPCMessage) => {
    if (!isJSONRPCRequest(message)) {
      // A notification, or the client's answer to a request of the server's:
      // there's no one to tell if it fails (and the transport has said so).
      await http.send(message).catch(() => {});
      return;
    }
    pending.add(message.id);
    if (message.method === "initialize") initializeId = message.id;
    try {
      await http.send(message, { onRequestStreamEnd: () => fail(message.id, CONNECTION_LOST) });
    } catch (error) {
      fail(message.id, rpcErrorOf(error));
    }
  };

  /** Sends `request` to the hosted server and resolves with its answer,
   *  which doesn't go on to the client; rejects with what sending threw. */
  const ask = (request: JSONRPCRequest) =>
    new Promise<JSONRPCResponse>((resolve, reject) => {
      asked.set(request.id, resolve);
      http
        .send(request, {
          onRequestStreamEnd: () =>
            resolve({ jsonrpc: "2.0", id: request.id, error: CONNECTION_LOST }),
        })
        .catch(reject);
    }).finally(() => asked.delete(request.id));

  /** The client's `initialize`: answered by the hosted server if there is a
   *  sign-in it takes (or with the error reaching it failed with, as any
   *  request), else by the local server. */
  const initialize = async (request: JSONRPCRequest) => {
    clientInitialize = request;
    if (signInSaved) {
      try {
        const answer = await ask(request);
        if (isJSONRPCResultResponse(answer)) {
          adopt(answer);
          remote = true;
        }
        return toClient(answer);
      } catch (error) {
        if (!(error instanceof SignInRequired)) {
          return toClient({ jsonrpc: "2.0", id: request.id, error: rpcErrorOf(error) });
        }
      }
    }
    await local.send(request);
  };

  /**
   * A tool call while local. Sending the client's `initialize` on to the
   * hosted server checks the sign-in as the commands do (finishing a login
   * the user has approved, else answering the call with the sign-in link).
   * The hosted server's answer stays here, since the client is initialized
   * already: the bridge adopts its protocol version, sends
   * `notifications/initialized`, and is remote from this call on.
   */
  const callTool = async (call: JSONRPCRequest) => {
    if (clientInitialize) {
      let answer: JSONRPCResponse;
      try {
        answer = await ask(clientInitialize);
      } catch (error) {
        return toClient({ jsonrpc: "2.0", id: call.id, error: rpcErrorOf(error) });
      }
      if (!isJSONRPCResultResponse(answer)) return toClient({ ...answer, id: call.id });
      adopt(answer);
      await http.send({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});
    }
    remote = true;
    void forward(call);
  };

  /** One message from the client. While local, a notification (the client's
   *  `initialized` among them) or an answer goes to the local server only. */
  const handle = async (message: JSONRPCMessage) => {
    if (closed) return;
    if (remote) return void forward(message);
    if (isJSONRPCRequest(message) && message.method === "initialize") return initialize(message);
    if (isJSONRPCRequest(message) && message.method === "tools/call") return callTool(message);
    await local.send(message);
  };

  // Each message is handled once the one before it has been: a tool call
  // while local can wait on a sign-in and the switch, and what the client
  // sends meanwhile reaches the hosted server after it, in order. Remote,
  // handling a message only starts sending it.
  let inbox: Promise<void> = Promise.resolve();
  stdio.onmessage = (message: JSONRPCMessage) => {
    inbox = inbox.then(() => handle(message)).catch((error: Error) => log(error.message));
  };
  local.onmessage = toClient;
  http.onmessage = (message: JSONRPCMessage) => {
    if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
      const waiting = message.id === undefined ? undefined : asked.get(message.id);
      if (waiting) return waiting(message);
      if (message.id !== undefined) pending.delete(message.id);
      if (isJSONRPCResultResponse(message) && message.id === initializeId) adopt(message);
    }
    toClient(message);
  };
  http.onerror = (error) => log(error.message);
  stdio.onerror = (error) => log(error.message);

  let stopped!: () => void;
  const done = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  const shutdown = async () => {
    if (closed) return;
    closed = true;
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    await Promise.allSettled([http.close(), stdio.close(), server.close()]);
    stopped();
  };
  stdio.onclose = shutdown;
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await http.start();
  await server.connect(localServerEnd);
  await stdio.start();
  return done;
}
