import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";

import { login, logout, requireToken, whoami } from "../src/auth.ts";
import {
  addPendingLogin,
  deleteToken,
  loadPendingLogins,
  loadStoredToken,
  saveToken,
} from "../src/credentials.ts";
import { CliError, EXIT } from "../src/errors.ts";

const run = promisify(execFile);

/**
 * A fake Fortrip API. The token endpoint follows the real device-login
 * rules (a poll sooner than `minPollGapMs` after the last one gets
 * `slow_down`; an approved code is redeemed once), unless `pollScript` has
 * replies queued.
 */
let pollScript: Array<{ status: number; body: unknown }>;
let deviceInterval: number;
let minPollGapMs: number;
let auths: Map<
  string,
  { userCode: string; status: string; lastPolledAt?: number }
>;
let validTokens: Set<string>;
let slowDowns: number;
let polls: number;
let deviceStartBody: unknown;
let deviceStarts = 0;
/** Run before a poll or a device start is answered, e.g. to act as
 *  another command. */
let onPoll: (() => Promise<void>) | undefined;
let onDeviceStart: (() => Promise<void>) | undefined;
/** Runs before a 401 from whoami is sent. */
let onRejected: (() => Promise<void>) | undefined;
const TOKEN = `fth_${"x".repeat(43)}`;
let server: Server;
let apiUrl: string;

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => void handle(req.method, req.url, req.headers.authorization, raw, res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function handle(
  method: string | undefined,
  url: string | undefined,
  authorization: string | undefined,
  raw: string,
  res: import("node:http").ServerResponse,
) {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const token = authorization?.replace(/^Bearer /, "") ?? "";
  switch (`${method} ${url}`) {
    case "POST /api/cli/auth/device": {
      deviceStartBody = JSON.parse(raw);
      await onDeviceStart?.();
      deviceStarts += 1;
      const deviceCode = `dc${deviceStarts}`;
      const userCode = `CODE-${deviceStarts}`;
      auths.set(deviceCode, { userCode, status: "pending" });
      return send(200, {
        success: true,
        data: {
          deviceCode,
          userCode,
          verificationUri: `${apiUrl}/cli/authorize`,
          verificationUriComplete: `${apiUrl}/cli/authorize?code=${userCode}`,
          interval: deviceInterval,
          expiresIn: 600,
        },
      });
    }
    case "POST /api/cli/auth/token": {
      polls += 1;
      await onPoll?.();
      const scripted = pollScript.shift();
      if (scripted) return send(scripted.status, scripted.body);
      const auth = auths.get(JSON.parse(raw).deviceCode);
      if (!auth) return send(400, { success: false, error: "expired_token" });
      const now = Date.now();
      const previous = auth.lastPolledAt;
      auth.lastPolledAt = now;
      if (previous !== undefined && now - previous < minPollGapMs) {
        slowDowns += 1;
        return send(400, {
          success: false,
          error: "slow_down",
          interval: deviceInterval + 1,
        });
      }
      switch (auth.status) {
        case "pending":
          return send(400, { success: false, error: "authorization_pending" });
        case "denied":
          return send(400, { success: false, error: "access_denied" });
        case "consumed":
          return send(400, { success: false, error: "expired_token" });
      }
      auth.status = "consumed";
      const minted = `fth_${"t".repeat(40)}${String(validTokens.size).padStart(3, "0")}`;
      validTokens.add(minted);
      return send(200, { success: true, data: { accessToken: minted } });
    }
    case "GET /api/cli/auth/whoami":
      if (validTokens.has(token)) {
        return send(200, { success: true, data: { userId: "user_1", email: "a@b.c" } });
      }
      await onRejected?.();
      return send(401, { success: false, error: "Invalid or revoked token" });
    case "POST /api/cli/auth/revoke":
      if (!validTokens.delete(token)) {
        return send(401, { success: false, error: "Invalid or revoked token" });
      }
      return send(200, { success: true, data: { revoked: true } });
    default:
      return send(404, { success: false, error: "not found" });
  }
}

/** The user approves (or denies) the code a loginUrl names. */
function decide(loginUrl: unknown, status: "approved" | "denied") {
  const userCode = new URL(String(loginUrl)).searchParams.get("code");
  for (const auth of auths.values()) {
    if (auth.userCode === userCode) auth.status = status;
  }
}

const waits: number[] = [];
const logs: string[] = [];
beforeEach(async () => {
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "fortrip-cli-"));
  delete process.env.FORTRIP_TOKEN;
  deviceStarts = 0;
  deviceInterval = 0;
  minPollGapMs = 0;
  auths = new Map();
  validTokens = new Set([TOKEN]);
  slowDowns = 0;
  polls = 0;
  pollScript = [];
  onPoll = undefined;
  onDeviceStart = undefined;
  onRejected = undefined;
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

/** The CliError a promise rejects with. */
async function failure(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof CliError);
    return error;
  }
  assert.fail("expected a CliError");
}

describe("login", () => {
  it("polls through pending and slow_down, saves the token and reports the account", async () => {
    deviceInterval = 5;
    pollScript = [
      { status: 400, body: { success: false, error: "authorization_pending" } },
      { status: 400, body: { success: false, error: "slow_down", interval: 10 } },
      { status: 200, body: { success: true, data: { accessToken: TOKEN } } },
    ];
    const result = await runLogin();

    assert.deepEqual(result, { userId: "user_1", email: "a@b.c", apiUrl });
    assert.deepEqual(waits, [5_000, 5_000, 10_000]);
    assert.equal(await loadStoredToken(apiUrl), TOKEN);
    assert.ok(logs.some((line) => line.includes("CODE-1")));
    assert.ok(logs.some((line) => line.includes("/cli/authorize?code=CODE-1")));
    assert.equal((deviceStartBody as { platform?: string }).platform, process.platform);
  });

  it("stops on access_denied without saving anything", async () => {
    pollScript = [{ status: 400, body: { success: false, error: "access_denied" } }];
    const error = await failure(runLogin());
    assert.equal(error.exitCode, EXIT.error);
    assert.equal(await loadStoredToken(apiUrl), null);
  });
});

describe("login from a command (agents)", () => {
  async function loginUrlOf(promise: Promise<unknown>): Promise<string> {
    const error = await failure(promise);
    assert.equal(error.exitCode, EXIT.unauthenticated);
    assert.match(String(error.details.userCode), /^CODE-\d+$/);
    assert.equal(typeof error.details.expiresInSeconds, "number");
    return String(error.details.loginUrl);
  }

  it("exits 3 with loginUrl, reuses it while pending, then finishes once approved", async () => {
    const loginUrl = await loginUrlOf(requireToken(apiUrl));
    assert.equal(loginUrl, `${apiUrl}/cli/authorize?code=CODE-1`);
    assert.equal(await loginUrlOf(requireToken(apiUrl)), loginUrl);
    assert.equal(deviceStarts, 1);

    decide(loginUrl, "approved");
    const { token, source } = await requireToken(apiUrl);
    assert.equal(source, "file");
    assert.equal(await loadStoredToken(apiUrl), token);
    assert.deepEqual(await loadPendingLogins(apiUrl), []);
  });

  it("starts a fresh login when the pending one was denied", async () => {
    decide(await loginUrlOf(requireToken(apiUrl)), "denied");
    assert.equal(
      await loginUrlOf(requireToken(apiUrl)),
      `${apiUrl}/cli/authorize?code=CODE-2`,
    );
    assert.equal(deviceStarts, 2);
    assert.equal((await loadPendingLogins(apiUrl)).length, 1);
  });

  it("commands run in parallel share one login link", async () => {
    const urls = await Promise.all(
      [1, 2, 3].map(() => loginUrlOf(requireToken(apiUrl))),
    );
    assert.equal(deviceStarts, 1);
    assert.deepEqual(urls, [urls[0], urls[0], urls[0]]);
    assert.equal((await loadPendingLogins(apiUrl)).length, 1);
  });

  it("doesn't poll a login known to be unapproved since the command started", async () => {
    for (const [n, checkedAt] of [
      [1, new Date(Date.now() - 60_000)],
      [2, new Date(Date.now() + 60_000)],
    ] as const) {
      auths.set(`dc${n}`, { userCode: `CODE-${n}`, status: "pending" });
      await addPendingLogin(apiUrl, {
        deviceCode: `dc${n}`,
        userCode: `CODE-${n}`,
        loginUrl: `${apiUrl}/cli/authorize?code=CODE-${n}`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        checkedAt: checkedAt.toISOString(),
      });
    }
    assert.equal(
      await loginUrlOf(requireToken(apiUrl)),
      `${apiUrl}/cli/authorize?code=CODE-2`,
    );
    assert.equal(polls, 1); // dc1 only
    assert.equal(auths.get("dc2")?.lastPolledAt, undefined);
  });

  it("polls every pending login, and any approved one signs in", async () => {
    // E.g. left by 0.3.0 commands run in parallel.
    for (const n of [1, 2, 3]) {
      auths.set(`dc${n}`, { userCode: `CODE-${n}`, status: "pending" });
      await addPendingLogin(apiUrl, {
        deviceCode: `dc${n}`,
        userCode: `CODE-${n}`,
        loginUrl: `${apiUrl}/cli/authorize?code=CODE-${n}`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    }
    decide(`${apiUrl}/cli/authorize?code=CODE-2`, "approved");

    const { token } = await requireToken(apiUrl);
    assert.ok(validTokens.has(token));
    assert.equal(await loadStoredToken(apiUrl), token);
    assert.deepEqual(await loadPendingLogins(apiUrl), []);
    assert.equal(polls, 2);
    assert.equal(deviceStarts, 0);
  });

  it("waits out the poll interval instead of earning slow_down", async () => {
    deviceInterval = 1;
    minPollGapMs = 900;
    const loginUrl = await loginUrlOf(requireToken(apiUrl));
    await loginUrlOf(requireToken(apiUrl)); // polls: still pending
    decide(loginUrl, "approved");

    const started = Date.now();
    await requireToken(apiUrl);
    assert.ok(Date.now() - started >= 800, "polled before the interval was up");
    assert.equal(slowDowns, 0);
  });

  it("parallel reruns after approval all get the one token", async () => {
    deviceInterval = 1;
    minPollGapMs = 500;
    decide(await loginUrlOf(requireToken(apiUrl)), "approved");

    const results = await Promise.all(
      [1, 2, 3, 4].map(() => requireToken(apiUrl)),
    );
    const minted = [...validTokens].filter((token) => token !== TOKEN);
    assert.equal(minted.length, 1);
    assert.deepEqual(
      results.map((result) => result.token),
      [1, 2, 3, 4].map(() => minted[0]),
    );
    assert.equal(await loadStoredToken(apiUrl), minted[0]);
  });

  it("polls again after a slow_down another command's poll caused", async () => {
    minPollGapMs = 500;
    const loginUrl = await loginUrlOf(requireToken(apiUrl));
    decide(loginUrl, "approved");
    // Another command polls dc1 without saving the token (it got slow_down
    // itself, or crashed); this command's next poll is too soon.
    auths.get("dc1")!.lastPolledAt = Date.now();

    const { token } = await requireToken(apiUrl);
    assert.ok(validTokens.has(token));
    assert.equal(slowDowns, 1);
  });

  it("uses a token saved while it polled instead of starting a login", async () => {
    await loginUrlOf(requireToken(apiUrl));
    // `fortrip login` finishes in another terminal while this one polls.
    onPoll = () => saveToken(apiUrl, TOKEN);
    assert.deepEqual(await requireToken(apiUrl), { token: TOKEN, source: "file" });
    assert.equal(deviceStarts, 1);
  });

  it("re-reads the saved token before reporting exit 3", async () => {
    onDeviceStart = () => saveToken(apiUrl, TOKEN);
    assert.deepEqual(await requireToken(apiUrl), { token: TOKEN, source: "file" });
  });

  it("an interval edited out of range can't stall the command", async () => {
    for (const interval of [1e6, 1e309, Number.NaN, "5"]) {
      auths.set("dc9", { userCode: "CODE-9", status: "pending" });
      await addPendingLogin(apiUrl, {
        deviceCode: "dc9",
        userCode: "CODE-9",
        loginUrl: `${apiUrl}/cli/authorize?code=CODE-9`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        interval: interval as number,
        lastPolledAt: new Date(Date.now() - 3_600_000).toISOString(),
      });
      decide(`${apiUrl}/cli/authorize?code=CODE-9`, "approved");
      const started = Date.now();
      await requireToken(apiUrl);
      assert.ok(Date.now() - started < 1_000, String(interval));
      await deleteToken(apiUrl);
    }
  });

  it("parallel CLI processes share one link, and reruns poll it once", async () => {
    deviceInterval = 1;
    minPollGapMs = 500;
    const env = {
      ...process.env,
      FORTRIP_API_URL: apiUrl,
      FORTRIP_TOKEN: "",
    };
    const cli = (args: string[]) =>
      run(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { env }).then(
        ({ stdout }) => ({ code: 0, stdout, stderr: "" }),
        (error: { code: number; stdout: string; stderr: string }) => error,
      );

    const first = await Promise.all([cli(["whoami"]), cli(["whoami"]), cli(["whoami"])]);
    assert.deepEqual(
      first.map((result) => result.code),
      [3, 3, 3],
    );
    const urls = first.map((result) => JSON.parse(result.stderr).loginUrl);
    assert.deepEqual(urls, [urls[0], urls[0], urls[0]]);
    assert.equal(deviceStarts, 1);
    decide(urls[0], "approved");

    polls = 0;
    const reruns = await Promise.all([cli(["whoami"]), cli(["whoami"]), cli(["whoami"])]);
    assert.deepEqual(
      reruns.map((result) => result.code),
      [0, 0, 0],
      reruns.map((result) => result.stderr).join("\n"),
    );
    for (const { stdout } of reruns) {
      assert.equal(JSON.parse(stdout).email, "a@b.c");
    }
    assert.equal(polls, 1);
    assert.equal(slowDowns, 0);
    assert.equal(validTokens.size, 2); // TOKEN and the one minted
  });
});

describe("a rejected token", () => {
  it("a saved token the server rejects is forgotten and a new login starts in the same run", async () => {
    await saveToken(apiUrl, TOKEN);
    validTokens.delete(TOKEN);

    const error = await failure(whoami(apiUrl));
    assert.equal(error.exitCode, EXIT.unauthenticated);
    assert.equal(error.details.loginUrl, `${apiUrl}/cli/authorize?code=CODE-1`);
    assert.equal(await loadStoredToken(apiUrl), null);
    assert.equal((await loadPendingLogins(apiUrl)).length, 1);
  });

  it("keeps a token another command saved meanwhile and retries with it", async () => {
    const stale = `fth_${"s".repeat(43)}`;
    await saveToken(apiUrl, stale);
    onRejected = () => saveToken(apiUrl, TOKEN);

    assert.deepEqual(await whoami(apiUrl), { userId: "user_1", email: "a@b.c", apiUrl });
    assert.equal(await loadStoredToken(apiUrl), TOKEN);
    assert.equal(deviceStarts, 0);
  });

  it("a rejected FORTRIP_TOKEN is reported as such; the saved login is left alone", async () => {
    await saveToken(apiUrl, TOKEN);
    process.env.FORTRIP_TOKEN = `fth_${"y".repeat(43)}`;

    const error = await failure(whoami(apiUrl));
    assert.equal(error.exitCode, EXIT.unauthenticated);
    assert.match(error.message, /FORTRIP_TOKEN/);
    assert.equal(error.details.loginUrl, undefined);
    assert.equal(error.details.tokenSource, "FORTRIP_TOKEN");
    assert.equal(await loadStoredToken(apiUrl), TOKEN);
    assert.equal(deviceStarts, 0);
  });
});

describe("logout and whoami", () => {
  it("logout revokes on the server and forgets locally; whoami then exits 3", async () => {
    pollScript = [{ status: 200, body: { success: true, data: { accessToken: TOKEN } } }];
    await runLogin();

    assert.deepEqual(await logout(apiUrl), { loggedOut: true, apiUrl });
    assert.equal(validTokens.has(TOKEN), false);
    assert.equal(await loadStoredToken(apiUrl), null);
    const error = await failure(whoami(apiUrl));
    assert.equal(error.exitCode, EXIT.unauthenticated);
    assert.equal(typeof error.details.loginUrl, "string");
  });
});
