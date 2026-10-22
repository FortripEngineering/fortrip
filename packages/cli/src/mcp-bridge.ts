import type { Readable, Writable } from "node:stream";

import { API } from "@fortrip/agent-contract";
import {
  type FetchLike,
  isJSONRPCErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type RequestId,
  SdkHttpError,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { refreshSession, requireToken } from "./auth.ts";
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

/**
 * `fortrip mcp`: a stdio MCP server that forwards every JSON-RPC message to
 * Fortrip's hosted server (Streamable HTTP, signed in with the CLI's session)
 * and the hosted server's messages back, unchanged. It runs until stdin ends
 * or it is told to stop with SIGINT or SIGTERM; requests still waiting then
 * go unanswered, as for any stdio server.
 *
 * stdout carries only JSON-RPC, so a problem the user has to fix (not signed
 * in, a token the server won't take) is the error response (-32001, whose
 * message names `LOGIN_COMMAND` and the sign-in link) to the request that
 * hit it, and the bridge stays up. A sign-in that stops working mid-session
 * fails only that request. Signed out from the start, that request is
 * `initialize`; clients treat a failed `initialize` as a failed connection and
 * close it, which ends the bridge, so the user signs in and then restarts or
 * reconnects the server. All diagnostics go to stderr.
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
  let closed = false;
  /** Requests sent on that the server hasn't answered. */
  const pending = new Set<RequestId>();
  let initializeId: RequestId | undefined;

  const log = (message: string) => {
    if (!closed) stderr.write(`fortrip mcp: ${message}\n`);
  };
  const fail = (id: RequestId, error: RpcError) => {
    if (closed || !pending.delete(id)) return;
    stdio.send({ jsonrpc: "2.0", id, error }).catch((cause: Error) => log(cause.message));
  };

  stdio.onmessage = async (message: JSONRPCMessage) => {
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
  http.onmessage = (message: JSONRPCMessage) => {
    if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
      if (message.id !== undefined) pending.delete(message.id);
      // What a Client does once it is initialized: later requests name the
      // protocol version they agreed on.
      if (isJSONRPCResultResponse(message) && message.id === initializeId) {
        const { protocolVersion } = message.result;
        if (typeof protocolVersion === "string") http.setProtocolVersion(protocolVersion);
      }
    }
    stdio.send(message).catch((cause: Error) => log(cause.message));
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
    await Promise.allSettled([http.close(), stdio.close()]);
    stopped();
  };
  stdio.onclose = shutdown;
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await http.start();
  await stdio.start();
  return done;
}
