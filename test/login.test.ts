import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { login, logout, whoami } from "../src/auth.ts";
import { loadStoredToken } from "../src/credentials.ts";
import { CliError, EXIT } from "../src/errors.ts";

/** A fake Fortrip API whose token endpoint replays `pollScript`. */
let pollScript: Array<{ status: number; body: unknown }>;
let revoked = false;
const TOKEN = `fth_${"x".repeat(43)}`;
let server: Server;
let apiUrl: string;

before(async () => {
  server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const authorized = req.headers.authorization === `Bearer ${TOKEN}` && !revoked;
    switch (`${req.method} ${req.url}`) {
      case "POST /api/cli/auth/device":
        return send(200, {
          success: true,
          data: {
            deviceCode: "dc",
            userCode: "BCDF-GHJK",
            verificationUri: `${apiUrl}/cli/authorize`,
            verificationUriComplete: `${apiUrl}/cli/authorize?code=BCDFGHJK`,
            interval: 5,
            expiresIn: 600,
          },
        });
      case "POST /api/cli/auth/token": {
        const next = pollScript.shift() ?? { status: 400, body: { error: "expired_token" } };
        return send(next.status, next.body);
      }
      case "GET /api/cli/auth/whoami":
        return authorized
          ? send(200, { success: true, data: { userId: "user_1", email: "a@b.c" } })
          : send(401, { success: false, error: "Invalid or revoked token" });
      case "POST /api/cli/auth/revoke":
        if (!authorized) return send(401, { success: false, error: "Invalid or revoked token" });
        revoked = true;
        return send(200, { success: true, data: { revoked: true } });
      default:
        return send(404, { success: false, error: "not found" });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const waits: number[] = [];
const logs: string[] = [];
beforeEach(async () => {
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "fortrip-cli-"));
  delete process.env.FORTRIP_TOKEN;
  revoked = false;
  waits.length = 0;
  logs.length = 0;
});

function runLogin() {
  return login({
    apiUrl,
    openBrowser: false,
    log: (line) => logs.push(line),
    wait: async (ms) => {
      waits.push(ms);
    },
  });
}

describe("login", () => {
  it("polls through pending and slow_down, saves the token and reports the account", async () => {
    pollScript = [
      { status: 400, body: { success: false, error: "authorization_pending" } },
      { status: 400, body: { success: false, error: "slow_down", interval: 10 } },
      { status: 200, body: { success: true, data: { accessToken: TOKEN } } },
    ];
    const result = await runLogin();

    assert.deepEqual(result, { userId: "user_1", email: "a@b.c", apiUrl });
    assert.deepEqual(waits, [5_000, 5_000, 10_000]);
    assert.equal(await loadStoredToken(apiUrl), TOKEN);
    assert.ok(logs.some((line) => line.includes("BCDF-GHJK")));
    assert.ok(logs.some((line) => line.includes("/cli/authorize?code=BCDFGHJK")));
  });

  it("stops on access_denied without saving anything", async () => {
    pollScript = [{ status: 400, body: { success: false, error: "access_denied" } }];
    await assert.rejects(runLogin(), (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.exitCode, EXIT.error);
      return true;
    });
    assert.equal(await loadStoredToken(apiUrl), null);
  });
});

describe("logout and whoami", () => {
  it("logout revokes on the server and forgets locally; whoami then exits 3", async () => {
    pollScript = [{ status: 200, body: { success: true, data: { accessToken: TOKEN } } }];
    await runLogin();

    assert.deepEqual(await logout(apiUrl), { loggedOut: true, apiUrl });
    assert.equal(revoked, true);
    assert.equal(await loadStoredToken(apiUrl), null);
    await assert.rejects(whoami(apiUrl), (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.exitCode, EXIT.unauthenticated);
      return true;
    });
  });

  it("a revoked FORTRIP_TOKEN gets exit 3 from the server's 401", async () => {
    process.env.FORTRIP_TOKEN = TOKEN;
    revoked = true;
    await assert.rejects(whoami(apiUrl), (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.exitCode, EXIT.unauthenticated);
      return true;
    });
  });
});
