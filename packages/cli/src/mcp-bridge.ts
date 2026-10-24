import { randomBytes } from "node:crypto";
import type { Readable, Writable } from "node:stream";

import { CONTRACT_VERSION, renderError, renderGuide, TOOLS } from "@fortrip/agent-contract";
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
import type { z } from "zod";

import { isEnvelope } from "./api.ts";
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
 * `fetch` for the hosted server at `mcpUrl`, signed in as for `apiUrl`
 * (`resolveMcpUrl` pairs them): every request carries the user's token, and
 * a 401 gets one refresh and one replay with the new token, as in
 * `authorizedRequest`. A token the server still turns down is the user's to
 * fix: `SignInRequired`. Any other answer, a 503 included, goes on to the
 * transport, which makes it an error for that request.
 */
function authorizedFetch(mcpUrl: string, apiUrl: string): FetchLike {
  const attempt: FetchLike = async (url, init) => {
    try {
      return await fetch(url, init);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      const cause = (error as { cause?: Error })?.cause ?? (error as Error);
      throw new Error(`Could not reach ${mcpUrl}: ${cause?.message ?? String(error)}`);
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

function isRpcError(value: unknown): value is RpcError {
  return (
    isRecord(value) &&
    !(value instanceof Error) &&
    typeof value.code === "number" &&
    typeof value.message === "string"
  );
}

/** What the server's HTTP answer said, parsed; undefined if it isn't JSON. */
function bodyOf(error: SdkHttpError): unknown {
  try {
    return JSON.parse(typeof error.data.text === "string" ? error.data.text : "");
  } catch {
    return undefined;
  }
}

/** The error a failed send is answered with: `error` itself if it is one
 *  already (an answer of the server's, or the bridge's own). */
function rpcErrorOf(error: unknown): RpcError {
  if (isRpcError(error)) return error;
  if (error instanceof SignInRequired) {
    return { code: SIGN_IN_REQUIRED, message: error.message, data: error.data };
  }
  if (error instanceof SdkHttpError) {
    const { status } = error;
    const text = typeof error.data.text === "string" ? error.data.text : "";
    const body = bodyOf(error);
    // A JSON-RPC error in the body is the server's own answer to the request.
    if (isRecord(body) && isRecord(body.error)) {
      const { code, message } = body.error;
      if (typeof code === "number" && typeof message === "string") return body.error as RpcError;
    }
    // The v1 envelope: the hosted server's error outside the tools.
    if (isEnvelope(body)) {
      const { message, requestId, retryable, retryAfterSeconds } = body.error;
      return {
        code: INTERNAL_ERROR,
        message: `Fortrip answered HTTP ${status}${typeof message === "string" ? `: ${message}` : ""}${
          typeof requestId === "string" ? ` (request id ${requestId})` : ""
        }`,
        data: {
          status,
          ...(retryable === true ? { retryable } : {}),
          ...(typeof retryAfterSeconds === "number" ? { retryAfterSeconds } : {}),
        },
      };
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

/**
 * A tool call that failed with a v1 envelope, answered as the hosted server
 * answers a tool's error (spec §6): `isError`, the rendered error and the
 * envelope as JSON text, the envelope in `_meta`, and no
 * `structuredContent`. The envelope is the hosted server's own when it
 * turned the HTTP request down with one, Fortrip's when the API refused a
 * step of the sign-in with one (`/v1/auth/config` answering 503, say), and
 * the bridge's for a sign-in it couldn't make: `unauthenticated`, as the hosted server answers a request
 * without a token it takes, with no `details` (§11) and a request id of
 * the bridge's own (`local_…`): that answer is the bridge's, not Fortrip's.
 * Any other failure has no envelope: undefined.
 */
function toolErrorOf(error: unknown) {
  let envelope: unknown;
  if (error instanceof SignInRequired) {
    envelope = {
      error: {
        code: "unauthenticated",
        message: error.message,
        retryable: false,
        requestId: `local_${randomBytes(10).toString("hex")}`,
      },
    };
  } else if (error instanceof SdkHttpError) {
    envelope = bodyOf(error);
  } else if (error instanceof CliError) {
    envelope = error.envelope;
  }
  if (!isEnvelope(envelope)) return undefined;
  return {
    isError: true,
    content: [
      { type: "text", text: renderError(envelope) },
      { type: "text", text: JSON.stringify(envelope) },
    ],
    _meta: { "ai.fortrip/error": envelope },
  };
}

/** The answer to a request of the client's that failed with `error`. */
function failureAnswer(id: RequestId, method: string, error: unknown): JSONRPCMessage {
  const result = method === "tools/call" ? toolErrorOf(error) : undefined;
  return result ? { jsonrpc: "2.0", id, result } : { jsonrpc: "2.0", id, error: rpcErrorOf(error) };
}

const CONNECTION_LOST: RpcError = {
  code: INTERNAL_ERROR,
  message: "The connection to Fortrip ended before it answered.",
  data: { retryable: true },
};

/** How long the switch to the hosted server may take: its `initialize` and
 *  `notifications/initialized`, the sign-in check included. */
const SWITCH_TIMEOUT_MS = 60_000;

/** Whether there is a sign-in to offer the hosted server: `FORTRIP_TOKEN`
 *  or a saved session. Unlike `requireToken` it never starts a device login.
 *  A credentials file that can't be read counts as none here; the first
 *  tool call then answers with what is wrong with it. */
async function hasSignIn(apiUrl: string): Promise<boolean> {
  if (process.env.FORTRIP_TOKEN?.trim()) return true;
  return (await loadSession(apiUrl).catch(() => null)) !== null;
}

/** A schema the SDK advertises as published and never enforces, as the
 *  hosted server registers each tool's: its validator passes every value
 *  through, and its JSON Schema is the contract's. */
function passThrough(schema: z.ZodType): StandardSchemaWithJSON {
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
 * What answers the client while it isn't signed in: an MCP SDK server set up
 * as the hosted one is (its `serverInfo`, `instructions` and the contract's
 * tools, registered as the hosted server registers them: pass-through
 * schemas, an output schema on every tool but the guide), so `initialize`,
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
      ...(spec.output ? { outputSchema: passThrough(spec.output) } : {}),
    };
    if (spec.input === null) {
      server.registerTool(spec.name, config, handler);
    } else {
      server.registerTool(
        spec.name,
        { ...config, inputSchema: passThrough(spec.input) },
        handler as ToolCallback<StandardSchemaWithJSON>,
      );
    }
  }
  return server;
}

/**
 * `fortrip mcp`: a stdio MCP server for Fortrip's hosted server at `mcpUrl`
 * (Streamable HTTP, signed in with the CLI's session for `apiUrl`; the CLI
 * pairs them with `resolveMcpUrl`). It runs until stdin ends or it is told
 * to stop with SIGINT or SIGTERM; requests still waiting then go
 * unanswered, as for any stdio server.
 *
 * With a sign-in the hosted server takes, it forwards every JSON-RPC message
 * there and the hosted server's messages back, unchanged ("remote"). Without
 * one (none saved, or the hosted server or a refresh turns it down) it
 * answers `initialize`, `tools/list` and `ping` itself, as the hosted server
 * would ("local"), so a client connects and lists the tools before the user
 * has signed in. A tool call while local checks the sign-in the way the
 * commands do. Still signed out, the call is answered as the hosted server
 * answers a tool's error, with `unauthenticated` (`toolErrorOf`), whose
 * message names `LOGIN_COMMAND` and the sign-in link it starts. Signed in
 * by now (the link approved, or `LOGIN_COMMAND` run), the
 * bridge sends the client's `initialize` on to the hosted server and is
 * remote from that call on, no restart needed; it then tells the client the
 * tool list may have changed, so that it lists the hosted server's. A switch
 * that takes longer than `switchTimeoutMs` (a minute) fails that call, and
 * those that came in meanwhile, with a retryable error, and the bridge stays
 * local.
 *
 * stdout carries only JSON-RPC, so a problem the user has to fix is the
 * answer to the request that hit it (a tool error for a tool call, as
 * above, a JSON-RPC error -32001 for any other request), and the bridge
 * stays up. A sign-in that stops working mid-session fails only that
 * request. All diagnostics go to stderr.
 */
export async function runMcpBridge(
  mcpUrl: string,
  apiUrl: string,
  io: { stdin: Readable; stdout: Writable; stderr?: Writable } = {
    stdin: process.stdin,
    stdout: process.stdout,
  },
  { switchTimeoutMs = SWITCH_TIMEOUT_MS }: { switchTimeoutMs?: number } = {},
): Promise<void> {
  const stderr = io.stderr ?? process.stderr;
  const stdio = new StdioServerTransport(io.stdin, io.stdout);
  const http = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    fetch: authorizedFetch(mcpUrl, apiUrl),
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
  /** Whether the local answer to it said the tool list can change. */
  let listChanged = false;
  /** Messages from the client so far; those up to `abandonedThrough` came
   *  in while a switch ran out of time. */
  let received = 0;
  let abandonedThrough = 0;
  /** Requests sent on that the server hasn't answered, with their method. */
  const pending = new Map<RequestId, string>();
  let initializeId: RequestId | undefined;
  /** Requests whose answer the bridge waits for itself (`ask`). */
  const asked = new Map<RequestId, (answer: JSONRPCResponse) => void>();

  const log = (message: string) => {
    if (!closed) stderr.write(`fortrip mcp: ${message}\n`);
  };
  const toClient = (message: JSONRPCMessage) => {
    stdio.send(message).catch((cause: Error) => log(cause.message));
  };
  const fail = (id: RequestId, error: unknown) => {
    const method = pending.get(id);
    if (closed || method === undefined) return;
    pending.delete(id);
    toClient(failureAnswer(id, method, error));
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
    pending.set(message.id, message.method);
    if (message.method === "initialize") initializeId = message.id;
    try {
      await http.send(message, { onRequestStreamEnd: () => fail(message.id, CONNECTION_LOST) });
    } catch (error) {
      fail(message.id, error);
    }
  };

  /** Sends `request` to the hosted server and resolves with its answer,
   *  which doesn't go on to the client; rejects with what sending threw.
   *  `signal` aborts the request. An aborted request can settle after the
   *  next one with its id was sent, so it forgets only its own waiter. */
  const ask = (request: JSONRPCRequest, signal?: AbortSignal) => {
    let waiter!: (answer: JSONRPCResponse) => void;
    return new Promise<JSONRPCResponse>((resolve, reject) => {
      waiter = resolve;
      asked.set(request.id, resolve);
      http
        .send(request, {
          requestSignal: signal,
          onRequestStreamEnd: () =>
            resolve({ jsonrpc: "2.0", id: request.id, error: CONNECTION_LOST }),
        })
        .catch(reject);
    }).finally(() => {
      if (asked.get(request.id) === waiter) asked.delete(request.id);
    });
  };

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
   * The switch's handshake with the hosted server: the client's `initialize`
   * (whose answer stays here: the client is initialized already), then, once
   * it is answered, the protocol version adopted and
   * `notifications/initialized` sent. Sending the `initialize` checks the
   * sign-in as the commands do: it finishes a login the user has approved,
   * else fails with the sign-in link. Resolves with what the tool call
   * failed with (a JSON-RPC error, or what sending threw), or undefined
   * once the bridge can go remote. Past `switchTimeoutMs` it aborts what it
   * sent, so no answer comes after, and gives up with CONNECTION_LOST, as
   * do the tool calls that came in meanwhile.
   */
  const handshake = async (initialize: JSONRPCRequest): Promise<{ error: unknown } | undefined> => {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), switchTimeoutMs);
    const late = new Promise<undefined>((resolve) =>
      deadline.signal.addEventListener("abort", () => resolve(undefined)),
    );
    try {
      let answer: JSONRPCResponse | undefined;
      try {
        answer = await Promise.race([ask(initialize, deadline.signal), late]);
      } catch (error) {
        return { error };
      }
      if (answer && !isJSONRPCResultResponse(answer)) return { error: answer.error };
      if (answer) {
        adopt(answer);
        await http
          .send(
            { jsonrpc: "2.0", method: "notifications/initialized" },
            { requestSignal: deadline.signal },
          )
          .catch(() => {});
      }
      if (!deadline.signal.aborted) return undefined;
      abandonedThrough = received;
      return { error: CONNECTION_LOST };
    } finally {
      clearTimeout(timer);
    }
  };

  /** A tool call while local: the switch, then this call goes on, and the
   *  client hears that the tool list may have changed if the local answer
   *  to its `initialize` said it can (the hosted server's list is the one
   *  that counts from now on). */
  const callTool = async (call: JSONRPCRequest) => {
    if (clientInitialize) {
      const failed = await handshake(clientInitialize);
      if (failed) return toClient(failureAnswer(call.id, call.method, failed.error));
    }
    remote = true;
    void forward(call);
    if (listChanged) toClient({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  };

  /** One message from the client. While local, a notification (the client's
   *  `initialized` among them) or an answer goes to the local server only. */
  const handle = async (message: JSONRPCMessage, seq: number) => {
    if (closed) return;
    if (remote) return void forward(message);
    if (isJSONRPCRequest(message) && message.method === "initialize") return initialize(message);
    if (isJSONRPCRequest(message) && message.method === "tools/call") {
      // It waited on a switch that ran out of time: no second wait.
      if (seq <= abandonedThrough) {
        return toClient({ jsonrpc: "2.0", id: message.id, error: CONNECTION_LOST });
      }
      return callTool(message);
    }
    await local.send(message);
  };

  // Each message is handled once the one before it has been: a tool call
  // while local can wait on a sign-in and the switch, and what the client
  // sends meanwhile reaches the hosted server after it, in order. Remote,
  // handling a message only starts sending it.
  let inbox: Promise<void> = Promise.resolve();
  stdio.onmessage = (message: JSONRPCMessage) => {
    const seq = ++received;
    inbox = inbox.then(() => handle(message, seq)).catch((error: Error) => log(error.message));
  };
  local.onmessage = (message: JSONRPCMessage) => {
    if (isJSONRPCResultResponse(message) && message.id === clientInitialize?.id) {
      const { capabilities } = message.result as { capabilities?: { tools?: { listChanged?: unknown } } };
      listChanged = capabilities?.tools?.listChanged === true;
    }
    toClient(message);
  };
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
