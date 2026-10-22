import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Session } from "../../src/credentials.ts";

type Reply = { status: number; body: unknown };

/**
 * A fake of what the CLI signs in with and calls, for tests: the Fortrip
 * API's public `/api/agent/v1/auth/config` and `/api/agent/v1/me`, and the
 * OAuth server the config names (RFC 8628 device authorization, the token
 * endpoint for device codes and refresh tokens, RFC 7009 revocation).
 *
 * Device logins follow the real server: a poll sooner than `minPollGapMs`
 * after the last gets `slow_down`, and an approved code is redeemed once.
 * Refresh tokens rotate unless `rotate` is off: a spent or revoked one
 * answers `invalid_grant`. Old access tokens keep working until removed from
 * `accessTokens`, as a JWT does until it expires.
 */
export interface FakeApi {
  url: string;
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
    /** `/me` answers 401 whatever the token. */
    rejectAll: boolean;
  };
  /** Answers for the next device polls, refreshes, revocations, config and
   *  `/me` requests, before the fake's own logic. */
  scripts: {
    poll: Reply[];
    refresh: Reply[];
    revoke: Reply[];
    config: Reply[];
    me: Reply[];
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
      };
      api.scripts = { poll: [], refresh: [], revoke: [], config: [], me: [] };
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
      case "GET /api/agent/v1/auth/config": {
        api.counts.config += 1;
        const scripted = api.scripts.config.shift();
        if (scripted) return scripted;
        return {
          status: 200,
          body: {
            success: true,
            data: {
              issuer: api.url,
              clientId: api.clientId,
              scopes: SCOPES,
              deviceAuthorizationEndpoint: `${api.url}/oauth/device_authorization`,
              tokenEndpoint: `${api.url}/oauth/token`,
              revocationEndpoint: `${api.url}/oauth/token/revoke`,
              ...api.configOverrides,
            },
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
      case "GET /api/agent/v1/me": {
        api.counts.me += 1;
        const token = authorization.replace(/^Bearer /, "");
        api.meTokens.push(token);
        const scripted = api.scripts.me.shift();
        if (scripted) return scripted;
        if (api.accessTokens.has(token) && !api.options.rejectAll) {
          return {
            status: 200,
            body: { success: true, data: { userId: "user_1", email: "a@b.c", name: "Ada" } },
          };
        }
        await api.hooks.onRejected?.();
        return { status: 401, body: { success: false, error: "Invalid or expired token" } };
      }
      default:
        return { status: 404, body: { success: false, error: "not found" } };
    }
  }

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
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
  api.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return api;
}
