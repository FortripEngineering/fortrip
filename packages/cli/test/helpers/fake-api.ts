import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { renderToolResult } from "@fortrip/agent-contract";

import type { Session } from "../../src/credentials.ts";

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

/** What a request to the fake MCP endpoint carried. */
export interface McpRequest {
  /** The bearer token, without `Bearer `. */
  token: string;
  sessionId?: string;
  protocolVersion?: string;
  /** The JSON-RPC message the POST carried. */
  message: Record<string, unknown>;
}

/** What the fake MCP server answers `initialize` and `tools/list` with. */
export const MCP_SESSION_ID = "fake-session-1";
export const MCP_TOOLS = [
  { name: "search_hotels", description: "Search", inputSchema: { type: "object" } },
  { name: "get_planning_guide", description: "Guide", inputSchema: { type: "object" } },
];

/** Where the fake MCP server answers: the path a non-production Fortrip
 *  host serves it on. */
export const MCP_FAKE_PATH = "/api/public/mcp";

const fixture = (name: string) =>
  (
    JSON.parse(
      readFileSync(new URL(`../../../contract/test/fixtures/v1/${name}.json`, import.meta.url), "utf8"),
    ) as { data: Record<string, unknown> }
  ).data;

/** What the fake answers a `tools/call` with, as the hosted server shapes a
 *  success: the compact text, the full object and the request id. */
export const MCP_CALL_RESULT = (() => {
  const data = fixture("search-shanghai-area");
  return {
    content: [{ type: "text", text: renderToolResult("search_hotels", data) }],
    structuredContent: data,
    _meta: { "ai.fortrip/requestId": "req_fakecall" },
  };
})();

/**
 * A fake of what the CLI signs in with and calls, for tests: the Fortrip
 * API's public `/v1/auth/config` and `/v1/me`, which answer with the
 * resource itself or the v1 error envelope, and the OAuth server the config
 * names (RFC 8628 device authorization, the token endpoint for device codes
 * and refresh tokens, RFC 7009 revocation).
 *
 * `POST /api/public/mcp` (`mcpUrl`) is the hosted MCP server (Streamable
 * HTTP): it takes the OAuth access tokens the fake issued (any other token
 * gets the hosted route's 401: the v1 envelope and `WWW-Authenticate`),
 * answers `initialize` with a session id that later requests must carry,
 * `tools/list` as JSON, and `tools/call` as an event stream with a
 * notification and a server request before the result (`toolResults` by
 * tool name, else `MCP_CALL_RESULT`). A `tools/call` of the tool `drop`
 * ends its stream without a result.
 *
 * Device logins follow the real server: a poll sooner than `minPollGapMs`
 * after the last gets `slow_down`, and an approved code is redeemed once.
 * Refresh tokens rotate unless `rotate` is off: a spent or revoked one
 * answers `invalid_grant`. Old access tokens keep working until removed from
 * `accessTokens`, as a JWT does until it expires.
 */
export interface FakeApi {
  url: string;
  /** The fake MCP server's URL. */
  mcpUrl: string;
  clientId: string;
  options: {
    /** `interval` and `expires_in` of a device authorization, in seconds. */
    deviceInterval: number;
    deviceExpiresIn: number;
    minPollGapMs: number;
    /** `expires_in` of an access token, in seconds. */
    accessTtl: number;
    rotate: boolean;
    /** Every device poll answers `expired_token`. */
    expireAll: boolean;
    /** `/me` and the MCP server answer 401 whatever the token. */
    rejectAll: boolean;
    /** The protocol version `initialize` answers with, instead of the
     *  client's. */
    protocolVersion?: string;
    /** The JSON-RPC error `initialize` answers with, instead of a result. */
    initializeError?: { code: number; message: string };
    /** An MCP method the server never answers (`hang`), or answers with an
     *  event stream that ends without the result (`drop`). */
    stall?: { method: string; how: "hang" | "drop" };
  };
  /** Answers for the next device polls, refreshes, revocations, config and
   *  `/me` requests, before the fake's own logic. */
  scripts: {
    poll: Reply[];
    refresh: Reply[];
    revoke: Reply[];
    config: Reply[];
    me: Reply[];
    /** Answers for the next MCP POSTs, whatever the token. */
    mcp: Reply[];
  };
  /** Run before the matching request is answered, e.g. to act as another
   *  command. */
  hooks: {
    onPoll?: () => Promise<unknown>;
    onDeviceStart?: () => Promise<unknown>;
    onRefresh?: () => Promise<unknown>;
    onRejected?: () => Promise<unknown>;
  };
  /** Fields the config answers with instead of the fake's own. */
  configOverrides: Record<string, string>;
  auths: Map<string, { userCode: string; status: string; lastPolledAt?: number }>;
  accessTokens: Set<string>;
  refreshTokens: Set<string>;
  counts: {
    config: number;
    deviceStarts: number;
    polls: number;
    slowDowns: number;
    refreshes: number;
    me: number;
  };
  /** The form of the last device authorization request. */
  lastDeviceRequest?: Record<string, string>;
  /** Every refresh token a refresh was asked with, and every token a
   *  revocation was asked for. */
  refreshedWith: string[];
  revoked: string[];
  /** The access token of every `/me` request. */
  meTokens: string[];
  /** Every POST to the MCP server, in order. */
  mcpRequests: McpRequest[];
  /** What a `tools/call` of the tool answers with, instead of
   *  `MCP_CALL_RESULT`. */
  toolResults: Record<string, unknown>;
  /** Every token the fake has issued, to check none is printed. */
  issued: string[];
  approve(loginUrl: string): void;
  deny(loginUrl: string): void;
  /** A session the OAuth server issued, as the CLI saves it. */
  session(overrides?: Partial<Session>): Session;
  reset(): void;
  close(): Promise<void>;
}

const SCOPES = "openid profile email offline_access";

/** The v1 error envelope (spec §11). */
export function envelope(code: string, message: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message, retryable: false, requestId: "req_fake", ...extra } };
}

export async function startFakeApi(): Promise<FakeApi> {
  let serial = 0;
  const mint = (kind: string) => {
    serial += 1;
    const token = `${kind}_${String(serial).padStart(4, "0")}_${Math.random().toString(36).slice(2, 12)}`;
    api.issued.push(token);
    return token;
  };
  const decide = (loginUrl: string, status: string) => {
    const userCode = new URL(loginUrl).searchParams.get("user_code");
    for (const auth of api.auths.values()) {
      if (auth.userCode === userCode) auth.status = status;
    }
  };
  const grant = () => {
    const accessToken = mint("access");
    const refreshToken = mint("refresh");
    api.accessTokens.add(accessToken);
    api.refreshTokens.add(refreshToken);
    return { accessToken, refreshToken };
  };

  const api: FakeApi = {
    url: "",
    mcpUrl: "",
    clientId: "client_cli",
    options: {} as FakeApi["options"],
    scripts: {} as FakeApi["scripts"],
    hooks: {},
    configOverrides: {},
    auths: new Map(),
    accessTokens: new Set(),
    refreshTokens: new Set(),
    counts: {} as FakeApi["counts"],
    refreshedWith: [],
    revoked: [],
    meTokens: [],
    mcpRequests: [],
    toolResults: {},
    issued: [],
    approve: (loginUrl) => decide(loginUrl, "approved"),
    deny: (loginUrl) => decide(loginUrl, "denied"),
    session(overrides = {}) {
      return {
        ...grant(),
        expiresAt: Date.now() + api.options.accessTtl * 1_000,
        clientId: api.clientId,
        ...overrides,
      };
    },
    reset() {
      api.options = {
        deviceInterval: 0,
        deviceExpiresIn: 600,
        minPollGapMs: 0,
        accessTtl: 3_600,
        rotate: true,
        expireAll: false,
        rejectAll: false,
        protocolVersion: undefined,
        initializeError: undefined,
        stall: undefined,
      };
      api.scripts = { poll: [], refresh: [], revoke: [], config: [], me: [], mcp: [] };
      api.hooks = {};
      api.configOverrides = {};
      api.auths = new Map();
      api.accessTokens = new Set();
      api.refreshTokens = new Set();
      api.counts = { config: 0, deviceStarts: 0, polls: 0, slowDowns: 0, refreshes: 0, me: 0 };
      api.lastDeviceRequest = undefined;
      api.refreshedWith = [];
      api.revoked = [];
      api.meTokens = [];
      api.mcpRequests = [];
      api.toolResults = {};
      api.issued = [];
    },
    close: async () => {},
  };
  api.reset();

  const tokenAnswer = (accessToken: string, refreshToken?: string) => ({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: api.options.accessTtl,
    scope: SCOPES,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
  });

  async function handle(
    method: string,
    path: string,
    authorization: string,
    raw: string,
  ): Promise<Reply> {
    const form = Object.fromEntries(new URLSearchParams(raw));
    const oauthError = (error: string, status = 400) => ({ status, body: { error } });
    switch (`${method} ${path}`) {
      case "GET /v1/auth/config": {
        api.counts.config += 1;
        const scripted = api.scripts.config.shift();
        if (scripted) return scripted;
        return {
          status: 200,
          body: {
            issuer: api.url,
            clientId: api.clientId,
            scopes: SCOPES,
            deviceAuthorizationEndpoint: `${api.url}/oauth/device_authorization`,
            tokenEndpoint: `${api.url}/oauth/token`,
            revocationEndpoint: `${api.url}/oauth/token/revoke`,
            ...api.configOverrides,
          },
        };
      }
      case "POST /oauth/device_authorization": {
        api.lastDeviceRequest = form;
        if (form.client_id !== api.clientId) return oauthError("invalid_client", 401);
        await api.hooks.onDeviceStart?.();
        api.counts.deviceStarts += 1;
        const n = api.counts.deviceStarts;
        api.auths.set(`dc${n}`, { userCode: `CODE-${n}`, status: "pending" });
        return {
          status: 200,
          body: {
            device_code: `dc${n}`,
            user_code: `CODE-${n}`,
            verification_uri: `${api.url}/device`,
            verification_uri_complete: `${api.url}/device?user_code=CODE-${n}`,
            expires_in: api.options.deviceExpiresIn,
            interval: api.options.deviceInterval,
          },
        };
      }
      case "POST /oauth/token": {
        if (form.client_id !== api.clientId) return oauthError("invalid_client", 401);
        if (form.grant_type === "refresh_token") {
          api.counts.refreshes += 1;
          api.refreshedWith.push(form.refresh_token ?? "");
          await api.hooks.onRefresh?.();
          const scripted = api.scripts.refresh.shift();
          if (scripted) return scripted;
          const spent = form.refresh_token ?? "";
          if (!api.refreshTokens.has(spent)) return oauthError("invalid_grant");
          const accessToken = mint("access");
          api.accessTokens.add(accessToken);
          if (!api.options.rotate) return { status: 200, body: tokenAnswer(accessToken) };
          api.refreshTokens.delete(spent);
          const refreshToken = mint("refresh");
          api.refreshTokens.add(refreshToken);
          return { status: 200, body: tokenAnswer(accessToken, refreshToken) };
        }
        if (form.grant_type !== "urn:ietf:params:oauth:grant-type:device_code") {
          return oauthError("unsupported_grant_type");
        }
        api.counts.polls += 1;
        await api.hooks.onPoll?.();
        const scripted = api.scripts.poll.shift();
        if (scripted) return scripted;
        const auth = api.auths.get(form.device_code ?? "");
        if (api.options.expireAll) return oauthError("expired_token");
        if (!auth) return oauthError("invalid_grant");
        const now = Date.now();
        const previous = auth.lastPolledAt;
        auth.lastPolledAt = now;
        if (previous !== undefined && now - previous < api.options.minPollGapMs) {
          api.counts.slowDowns += 1;
          return oauthError("slow_down");
        }
        switch (auth.status) {
          case "pending":
            return oauthError("authorization_pending");
          case "denied":
            return oauthError("access_denied");
          case "consumed":
            return oauthError("invalid_grant");
        }
        auth.status = "consumed";
        const { accessToken, refreshToken } = grant();
        return { status: 200, body: tokenAnswer(accessToken, refreshToken) };
      }
      case "POST /oauth/token/revoke": {
        api.revoked.push(form.token ?? "");
        const scripted = api.scripts.revoke.shift();
        if (scripted) return scripted;
        api.refreshTokens.delete(form.token ?? "");
        return { status: 200, body: {} };
      }
      case "GET /v1/me": {
        api.counts.me += 1;
        const token = authorization.replace(/^Bearer /, "");
        api.meTokens.push(token);
        const scripted = api.scripts.me.shift();
        if (scripted) return scripted;
        if (api.accessTokens.has(token) && !api.options.rejectAll) {
          return { status: 200, body: { userId: "user_1", email: "a@b.c", name: "Ada" } };
        }
        await api.hooks.onRejected?.();
        return { status: 401, body: envelope("unauthenticated", "Invalid or expired token") };
      }
      default:
        return { status: 404, body: envelope("not_found", "not found") };
    }
  }

  /** One POST to the MCP server. */
  function handleMcp(req: IncomingMessage, res: ServerResponse, raw: string): void {
    const header = (name: string) => {
      const value = req.headers[name];
      return typeof value === "string" ? value : undefined;
    };
    const token = (header("authorization") ?? "").replace(/^Bearer /, "");
    const message = JSON.parse(raw) as {
      id?: unknown;
      method?: unknown;
      params?: Record<string, unknown>;
    };
    api.mcpRequests.push({
      token,
      sessionId: header("mcp-session-id"),
      protocolVersion: header("mcp-protocol-version"),
      message,
    });
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const scripted = api.scripts.mcp.shift();
    if (scripted) return json(scripted.status, scripted.body, scripted.headers);
    if (!api.accessTokens.has(token) || api.options.rejectAll) {
      return json(
        401,
        envelope("unauthenticated", "Send a valid OAuth access token as `Authorization: Bearer <token>`."),
        {
          "www-authenticate": `Bearer error="invalid_token", resource_metadata="${api.url}/api/public/mcp-resource"`,
        },
      );
    }
    const { stall } = api.options;
    if (stall && message.method === stall.method) {
      if (stall.how === "hang") return;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders();
      return void setImmediate(() => res.destroy());
    }
    // Notifications, and a client's answers to the server's requests.
    if (message.id === undefined || typeof message.method !== "string") {
      res.writeHead(202);
      return void res.end();
    }
    const { id, method, params = {} } = message;
    if (method !== "initialize" && header("mcp-session-id") !== MCP_SESSION_ID) {
      return json(400, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null,
      });
    }
    const result = (value: unknown) => ({ jsonrpc: "2.0", id, result: value });
    switch (method) {
      case "initialize":
        if (api.options.initializeError) {
          return json(200, { jsonrpc: "2.0", id, error: api.options.initializeError });
        }
        return json(
          200,
          result({
            protocolVersion: api.options.protocolVersion ?? params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "fake-fortrip", version: "0.0.0" },
          }),
          { "mcp-session-id": MCP_SESSION_ID },
        );
      case "tools/list":
        return json(200, result({ tools: MCP_TOOLS }));
      case "tools/call": {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const event = (value: unknown) =>
          res.write(`event: message\ndata: ${JSON.stringify(value)}\n\n`);
        event({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "searching" } });
        event({ jsonrpc: "2.0", id: "srv-1", method: "ping" });
        if (params.name === "drop") return void setImmediate(() => res.destroy());
        const name = String(params.name);
        event(result(Object.hasOwn(api.toolResults, name) ? api.toolResults[name] : MCP_CALL_RESULT));
        return void res.end();
      }
      default:
        return json(200, {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
  }

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (req.url === MCP_FAKE_PATH) {
        // It offers no event stream apart from a POST's.
        if (req.method !== "POST") {
          res.writeHead(405);
          return void res.end();
        }
        return handleMcp(req, res, raw);
      }
      void handle(req.method ?? "", req.url ?? "", req.headers.authorization ?? "", raw).then(
        ({ status, body }) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        },
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  api.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  api.mcpUrl = `${api.url}${MCP_FAKE_PATH}`;
  api.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return api;
}
