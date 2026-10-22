import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A fake Fortrip API for tests that run whole CLI processes. Device logins
 * follow the real server: a poll sooner than `minPollGapMs` after the last
 * gets `slow_down`, an approved code is redeemed once. With `expireAll`,
 * every poll answers `expired_token`.
 */
export interface FakeApi {
  url: string;
  auths: Map<string, { userCode: string; status: string; lastPolledAt?: number }>;
  tokens: Set<string>;
  deviceStarts: number;
  options: { minPollGapMs: number; expireAll: boolean };
  /** The user approves the code a loginUrl names. */
  approve(loginUrl: string): void;
  close(): Promise<void>;
}

export async function startFakeApi(): Promise<FakeApi> {
  const api = {
    url: "",
    auths: new Map(),
    tokens: new Set<string>(),
    deviceStarts: 0,
    options: { minPollGapMs: 0, expireAll: false },
    approve(loginUrl: string) {
      const userCode = new URL(loginUrl).searchParams.get("code");
      for (const auth of api.auths.values()) {
        if (auth.userCode === userCode) auth.status = "approved";
      }
    },
    close: async () => {},
  } as FakeApi;

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      switch (`${req.method} ${req.url}`) {
        case "POST /api/cli/auth/device": {
          api.deviceStarts += 1;
          const deviceCode = `dc${api.deviceStarts}`;
          const userCode = `CODE-${api.deviceStarts}`;
          api.auths.set(deviceCode, { userCode, status: "pending" });
          return send(200, {
            success: true,
            data: {
              deviceCode,
              userCode,
              verificationUri: `${api.url}/cli/authorize`,
              verificationUriComplete: `${api.url}/cli/authorize?code=${userCode}`,
              interval: 1,
              expiresIn: 600,
            },
          });
        }
        case "POST /api/cli/auth/token": {
          const auth = api.auths.get(JSON.parse(raw).deviceCode);
          if (!auth || api.options.expireAll) {
            return send(400, { success: false, error: "expired_token" });
          }
          const now = Date.now();
          const previous = auth.lastPolledAt;
          auth.lastPolledAt = now;
          if (previous !== undefined && now - previous < api.options.minPollGapMs) {
            return send(400, { success: false, error: "slow_down", interval: 2 });
          }
          if (auth.status === "pending") {
            return send(400, { success: false, error: "authorization_pending" });
          }
          if (auth.status !== "approved") {
            return send(400, { success: false, error: "expired_token" });
          }
          auth.status = "consumed";
          const minted = `fth_${String(api.tokens.size).padStart(43, "t")}`;
          api.tokens.add(minted);
          return send(200, { success: true, data: { accessToken: minted } });
        }
        case "GET /api/cli/auth/whoami":
          return api.tokens.has(token)
            ? send(200, { success: true, data: { userId: "user_1", email: "a@b.c" } })
            : send(401, { success: false, error: "Invalid or revoked token" });
        case "POST /api/cli/auth/revoke":
          return api.tokens.delete(token)
            ? send(200, { success: true, data: { revoked: true } })
            : send(401, { success: false, error: "Invalid or revoked token" });
        default:
          return send(404, { success: false, error: "not found" });
      }
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
