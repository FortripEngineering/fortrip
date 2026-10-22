import assert from "node:assert/strict";
import fsp, { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { login, logout, refreshSession, requireToken, whoami } from "../src/auth.ts";
import {
  addPendingLogin,
  credentialsPath,
  deleteSession,
  loadPendingLogins,
  loadRecoveredSessions,
  loadSession,
  saveSession,
  tryLoginLock,
} from "../src/credentials.ts";
import { CliError, EXIT, notices } from "../src/errors.ts";
import { cli } from "./helpers/cli.ts";
import { type FakeApi, startFakeApi } from "./helpers/fake-api.ts";

let api: FakeApi;
let apiUrl: string;
before(async () => {
  api = await startFakeApi();
  apiUrl = api.url;
});
after(() => api.close());

const ME = { userId: "user_1", email: "a@b.c", name: "Ada" };
const waits: number[] = [];
const logs: string[] = [];
beforeEach(async () => {
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "fortrip-cli-"));
  delete process.env.FORTRIP_TOKEN;
  api.reset();
  for (const key of Object.keys(notices)) delete notices[key];
  waits.length = 0;
  logs.length = 0;
});

/** Runs `fn` while the test holds the login lock, so the commands it starts
 *  all begin before any of them can poll or refresh. */
async function whileLocked<T>(fn: () => Promise<T>): Promise<T> {
  const release = await tryLoginLock();
  assert.ok(release);
  const result = fn();
  await sleep(30);
  await release();
  return result;
}

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
    assert.ok(error instanceof CliError, String(error));
    return error;
  }
  assert.fail("expected a CliError");
}

/** The link the fake shows for its nth device login. */
const linkFor = (n: number) => `${apiUrl}/device?user_code=CODE-${n}`;

/** The environment of a CLI process run against the fake. */
const cliEnv = () => ({ ...process.env, FORTRIP_API_URL: apiUrl, FORTRIP_TOKEN: "" });

/** No output names a token the fake issued. */
function assertNoTokens(outputs: string[]) {
  for (const token of api.issued) {
    for (const output of outputs) assert.ok(!output.includes(token), `printed ${token.slice(0, 4)}…`);
  }
}

/** Every login this fake starts is approved before its next poll. */
function approveEveryLogin() {
  api.hooks.onPoll = async () => {
    for (const auth of api.auths.values()) {
      if (auth.status === "pending") auth.status = "approved";
    }
  };
}

/** Renames fail as if another process had the file open. */
function failRenames() {
  mock.method(fsp, "rename", async () => {
    throw Object.assign(new Error("EPERM"), { code: "EPERM" });
  });
  syncBuiltinESMExports();
}

function restoreRenames() {
  mock.restoreAll();
  syncBuiltinESMExports();
}

describe("login", () => {
  it("login saves the session and prints userCode and the verification URL", async () => {
    api.options.deviceInterval = 5;
    api.scripts.poll = [
      { status: 400, body: { error: "authorization_pending" } },
      { status: 400, body: { error: "slow_down" } },
    ];
    approveEveryLogin();
    const result = await runLogin();

    assert.deepEqual(result, { ...ME, apiUrl });
    // slow_down adds 5 seconds to the interval (RFC 8628).
    assert.deepEqual(waits, [5_000, 5_000, 10_000]);
    assert.deepEqual(api.lastDeviceRequest, {
      client_id: api.clientId,
      scope: "openid profile email offline_access",
    });
    const saved = await loadSession(apiUrl);
    assert.ok(saved);
    assert.ok(api.accessTokens.has(saved.accessToken));
    assert.ok(api.refreshTokens.has(saved.refreshToken));
    assert.equal(saved.clientId, api.clientId);
    assert.ok(Math.abs(saved.expiresAt - (Date.now() + 3_600_000)) < 10_000);
    assert.ok(logs.some((line) => line.includes("CODE-1")));
    assert.ok(logs.some((line) => line.includes(linkFor(1))));
    assertNoTokens(logs);
  });

  it("access_denied exits 1 and saves nothing", async () => {
    api.scripts.poll = [{ status: 400, body: { error: "access_denied" } }];
    const error = await failure(runLogin());
    assert.equal(error.exitCode, EXIT.error);
    assert.match(error.message, /denied/);
    await assert.rejects(readFile(credentialsPath()));
  });

  it("an expired code stops the login with exit 1", async () => {
    api.scripts.poll = [{ status: 400, body: { error: "expired_token" } }];
    const error = await failure(runLogin());
    assert.equal(error.exitCode, EXIT.error);
    assert.match(error.message, /expired/);
  });
});

describe("login from a command (agents)", () => {
  async function loginUrlOf(promise: Promise<unknown>): Promise<string> {
    const error = await failure(promise);
    assert.equal(error.exitCode, EXIT.unauthenticated, error.message);
    assert.match(String(error.details.userCode), /^CODE-\d+$/);
    assert.equal(typeof error.details.expiresInSeconds, "number");
    return String(error.details.loginUrl);
  }

  it("an agent command exits 3 with loginUrl when signed out, reuses it while pending, then finishes once approved", async () => {
    const loginUrl = await loginUrlOf(requireToken(apiUrl));
    assert.equal(loginUrl, linkFor(1));
    assert.equal(await loginUrlOf(requireToken(apiUrl)), loginUrl);
    assert.equal(api.counts.deviceStarts, 1);

    api.approve(loginUrl);
    const { token, source } = await requireToken(apiUrl);
    assert.equal(source, "file");
    assert.ok(api.accessTokens.has(token));
    assert.equal((await loadSession(apiUrl))?.accessToken, token);
    assert.deepEqual(await loadPendingLogins(apiUrl), []);
  });

  it("starts a fresh login when the pending one was denied", async () => {
    api.deny(await loginUrlOf(requireToken(apiUrl)));
    assert.equal(await loginUrlOf(requireToken(apiUrl)), linkFor(2));
    assert.equal(api.counts.deviceStarts, 2);
    assert.equal((await loadPendingLogins(apiUrl)).length, 1);
  });

  it("commands run in parallel share one login link, and nobody polls it", async () => {
    const urls = await whileLocked(() =>
      Promise.all([1, 2, 3].map(() => loginUrlOf(requireToken(apiUrl)))),
    );
    assert.equal(api.counts.deviceStarts, 1);
    assert.deepEqual(urls, [urls[0], urls[0], urls[0]]);
    assert.equal((await loadPendingLogins(apiUrl)).length, 1);
    // Nobody has seen a link that new, so nobody can have approved it.
    assert.equal(api.counts.polls, 0);
  });

  it("reruns in parallel before approval poll the login once", async () => {
    await loginUrlOf(requireToken(apiUrl));
    const started = Date.now();
    await whileLocked(() =>
      Promise.all([1, 2, 3].map(() => loginUrlOf(requireToken(apiUrl)))),
    );
    assert.equal(api.counts.polls, 1);
    assert.ok(Date.now() - started < 2_000);
  });

  it("doesn't poll a login known to be unapproved since the command started", async () => {
    const pending = (n: number, checkedAt: Date) => {
      api.auths.set(`dc${n}`, { userCode: `CODE-${n}`, status: "pending" });
      return addPendingLogin(apiUrl, {
        deviceCode: `dc${n}`,
        userCode: `CODE-${n}`,
        loginUrl: linkFor(n),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        checkedAt: checkedAt.toISOString(),
      });
    };
    await pending(1, new Date(Date.now() - 60_000));
    // In the future: a clock step, not something learned after the start.
    await pending(3, new Date(Date.now() + 60_000));
    const url = await whileLocked(async () => {
      const result = loginUrlOf(requireToken(apiUrl));
      await sleep(20);
      // Another command learned dc2 is unapproved after this one started.
      await pending(2, new Date());
      return result;
    });
    assert.equal(url, linkFor(2));
    assert.equal(api.counts.polls, 2); // dc1 and dc3
    assert.equal(api.auths.get("dc2")?.lastPolledAt, undefined);
  });

  it("polls every pending login, and any approved one signs in", async () => {
    for (const n of [1, 2, 3]) {
      api.auths.set(`dc${n}`, { userCode: `CODE-${n}`, status: "pending" });
      await addPendingLogin(apiUrl, {
        deviceCode: `dc${n}`,
        userCode: `CODE-${n}`,
        loginUrl: linkFor(n),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    }
    api.approve(linkFor(2));

    const { token } = await requireToken(apiUrl);
    assert.ok(api.accessTokens.has(token));
    assert.equal((await loadSession(apiUrl))?.accessToken, token);
    assert.deepEqual(await loadPendingLogins(apiUrl), []);
    assert.equal(api.counts.polls, 2);
    assert.equal(api.counts.deviceStarts, 0);
  });

  it("counts the interval from when the server answered", async () => {
    api.options.deviceInterval = 1;
    api.options.minPollGapMs = 900;
    const loginUrl = await loginUrlOf(requireToken(apiUrl));
    // The poll reaches the server late (a cold start, say).
    api.hooks.onPoll = () => sleep(800);
    await loginUrlOf(requireToken(apiUrl));
    api.hooks.onPoll = undefined;
    api.approve(loginUrl);

    await requireToken(apiUrl);
    assert.equal(api.counts.slowDowns, 0);
  });

  it("waits out the poll interval instead of earning slow_down", async () => {
    api.options.deviceInterval = 1;
    api.options.minPollGapMs = 900;
    const loginUrl = await loginUrlOf(requireToken(apiUrl));
    await loginUrlOf(requireToken(apiUrl)); // polls: still pending
    api.approve(loginUrl);

    const started = Date.now();
    await requireToken(apiUrl);
    assert.ok(Date.now() - started >= 800, "polled before the interval was up");
    assert.equal(api.counts.slowDowns, 0);
  });

  it("parallel reruns after approval all get the one token", async () => {
    api.options.deviceInterval = 1;
    api.options.minPollGapMs = 500;
    api.approve(await loginUrlOf(requireToken(apiUrl)));

    const results = await Promise.all([1, 2, 3, 4].map(() => requireToken(apiUrl)));
    assert.equal(api.accessTokens.size, 1);
    const [minted] = api.accessTokens;
    assert.deepEqual(
      results.map((result) => result.token),
      [1, 2, 3, 4].map(() => minted),
    );
    assert.equal((await loadSession(apiUrl))?.accessToken, minted);
  });

  it("polls again, 5 seconds later, after a slow_down another command's poll caused", { timeout: 15_000 }, async () => {
    api.options.minPollGapMs = 500;
    const loginUrl = await loginUrlOf(requireToken(apiUrl));
    api.approve(loginUrl);
    // Another command polls dc1 without saving the token (it got slow_down
    // itself, or crashed); this command's next poll is too soon.
    const dc1 = api.auths.get("dc1");
    assert.ok(dc1);
    dc1.lastPolledAt = Date.now();

    const started = Date.now();
    const { token } = await requireToken(apiUrl);
    assert.ok(api.accessTokens.has(token));
    assert.equal(api.counts.slowDowns, 1);
    assert.ok(Date.now() - started >= 4_900);
  });

  it("uses a session saved while it polled instead of starting a login", async () => {
    await loginUrlOf(requireToken(apiUrl));
    // `fortrip login` finishes in another terminal while this one polls.
    const saved = api.session();
    api.hooks.onPoll = () => saveSession(apiUrl, saved);
    assert.deepEqual(await requireToken(apiUrl), { token: saved.accessToken, source: "file" });
    assert.equal(api.counts.deviceStarts, 1);
  });

  it("re-reads the saved session before reporting exit 3", async () => {
    const saved = api.session();
    api.hooks.onDeviceStart = () => saveSession(apiUrl, saved);
    assert.deepEqual(await requireToken(apiUrl), { token: saved.accessToken, source: "file" });
  });

  it("an edited interval or a clock step can't stall the command", { timeout: 15_000 }, async () => {
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const inAnHour = new Date(Date.now() + 3_600_000).toISOString();
    for (const [interval, lastPolledAt] of [
      [1e6, hourAgo],
      [-5, hourAgo],
      ["5", hourAgo],
      [1, inAnHour],
    ] as const) {
      api.auths.set("dc9", { userCode: "CODE-9", status: "pending" });
      await addPendingLogin(apiUrl, {
        deviceCode: "dc9",
        userCode: "CODE-9",
        loginUrl: linkFor(9),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        interval: interval as number,
        lastPolledAt,
      });
      api.approve(linkFor(9));
      const started = Date.now();
      await requireToken(apiUrl);
      assert.ok(Date.now() - started < 2_000, `${interval} ${lastPolledAt}`);
      await deleteSession(apiUrl);
    }
  });

  it("gives up waiting for another sign-in: the pending link if it has time left, else a retryable error", { timeout: 15_000 }, async () => {
    const release = await tryLoginLock();
    assert.ok(release);
    try {
      let error = await failure(requireToken(apiUrl, { loginWaitMs: 300 }));
      assert.equal(error.exitCode, EXIT.error);
      assert.equal(error.details.retryable, true);

      for (const [n, left] of [
        [1, 60_000],
        [2, 600_000],
      ] as const) {
        await addPendingLogin(apiUrl, {
          deviceCode: `dc${n}`,
          userCode: `CODE-${n}`,
          loginUrl: linkFor(n),
          expiresAt: new Date(Date.now() + left).toISOString(),
        });
        error = await failure(requireToken(apiUrl, { loginWaitMs: 300 }));
        if (n === 1) {
          // A link about to expire isn't worth showing.
          assert.equal(error.exitCode, EXIT.error);
        } else {
          assert.equal(error.exitCode, EXIT.unauthenticated);
          assert.equal(error.details.loginUrl, linkFor(2));
        }
      }
    } finally {
      await release();
    }
    assert.equal(api.counts.polls, 0);
    assert.equal(api.counts.deviceStarts, 0);
  });

  it("shows a fresh link when the pending one is about to expire, and keeps polling the old one", async () => {
    api.auths.set("dc0", { userCode: "CODE-0", status: "pending" });
    await addPendingLogin(apiUrl, {
      deviceCode: "dc0",
      userCode: "CODE-0",
      loginUrl: linkFor(0),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      interval: 0,
    });
    const url = await loginUrlOf(requireToken(apiUrl));
    assert.equal(url, linkFor(1));
    assert.equal(api.counts.polls, 1);
    assert.deepEqual(
      (await loadPendingLogins(apiUrl)).map((login) => login.deviceCode),
      ["dc0", "dc1"],
    );

    // The user approves the old link after all.
    api.approve(linkFor(0));
    const { token } = await requireToken(apiUrl);
    assert.ok(api.accessTokens.has(token));
  });

  it("a signed-out command never starts a sign-in while the sign-in config is unavailable", async () => {
    api.scripts.config = [
      { status: 503, body: { success: false, error: "Sign-in is unavailable", retryable: true } },
    ];
    const error = await failure(requireToken(apiUrl));
    assert.equal(error.exitCode, EXIT.error);
    assert.equal(error.details.retryable, true);
    assert.equal(api.counts.deviceStarts, 0);
  });

  it("R3: uses a session it couldn't save, and says where it was kept", async () => {
    api.approve(await loginUrlOf(requireToken(apiUrl)));
    failRenames();
    let token: string;
    try {
      ({ token } = await requireToken(apiUrl));
    } finally {
      restoreRenames();
    }
    assert.ok(api.accessTokens.has(token));
    assert.match(String(notices.warning), /kept in/);
    const kept = String(notices.recoveryFile);
    assert.equal(JSON.parse(await readFile(kept, "utf8")).sessions[apiUrl].accessToken, token);
    // The next command uses it.
    assert.deepEqual(await requireToken(apiUrl), { token, source: "file" });
    assert.equal(api.counts.deviceStarts, 1);
  });

  it("R3: the CLI's output stays JSON when a sign-in can't be saved, and the next command uses it", { timeout: 30_000 }, async () => {
    const env = cliEnv();
    const path = credentialsPath();

    const first = await cli(["whoami"], env);
    api.approve(JSON.parse(first.stderr).loginUrl);
    // The file turns unreadable just as the login is redeemed.
    api.hooks.onPoll = () => writeFile(path, "{not json");
    const failed = await cli(["search", "--query", "x"], env);
    api.hooks.onPoll = undefined;
    assert.equal(failed.code, 1);
    const error = JSON.parse(failed.stderr);
    assert.equal(error.error, "not found");
    assert.match(error.warning, /kept in/);
    assert.match(error.recoveryFile, /credentials\.recovered-/);

    // The user moves the broken file away, as the warning says.
    await rename(path, `${path}.broken`);
    const next = await cli(["whoami"], env);
    assert.equal(next.code, 0, next.stderr);
    assert.equal(JSON.parse(next.stdout).email, "a@b.c");
    assert.equal(next.stderr, "");
    assert.equal(api.counts.deviceStarts, 1);
    assertNoTokens([first, failed, next].flatMap(({ stdout, stderr }) => [stdout, stderr]));
  });

  it("parallel CLI processes share one link, and reruns poll it once", { timeout: 30_000 }, async () => {
    api.options.deviceInterval = 1;
    api.options.minPollGapMs = 500;
    const env = cliEnv();

    const first = await Promise.all([cli(["whoami"], env), cli(["whoami"], env), cli(["whoami"], env)]);
    assert.deepEqual(
      first.map((result) => result.code),
      [3, 3, 3],
    );
    const urls = first.map((result) => JSON.parse(result.stderr).loginUrl);
    assert.deepEqual(urls, [urls[0], urls[0], urls[0]]);
    assert.equal(api.counts.deviceStarts, 1);
    api.approve(urls[0]);

    api.counts.polls = 0;
    const reruns = await Promise.all([cli(["whoami"], env), cli(["whoami"], env), cli(["whoami"], env)]);
    assert.deepEqual(
      reruns.map((result) => result.code),
      [0, 0, 0],
      reruns.map((result) => result.stderr).join("\n"),
    );
    for (const { stdout } of reruns) {
      assert.equal(JSON.parse(stdout).email, "a@b.c");
    }
    assert.equal(api.counts.polls, 1);
    assert.equal(api.counts.slowDowns, 0);
    assert.equal(api.accessTokens.size, 1);
    assertNoTokens([...first, ...reruns].flatMap(({ stdout, stderr }) => [stdout, stderr]));
  });
});

describe("refresh", () => {
  it("refreshes before expiry", async () => {
    const old = api.session({ expiresAt: Date.now() + 30_000 });
    await saveSession(apiUrl, old);

    assert.deepEqual(await whoami(apiUrl), { ...ME, apiUrl });
    assert.equal(api.counts.refreshes, 1);
    assert.deepEqual(api.refreshedWith, [old.refreshToken]);
    const saved = await loadSession(apiUrl);
    assert.ok(saved);
    assert.notEqual(saved.accessToken, old.accessToken);
    assert.deepEqual(api.meTokens, [saved.accessToken]);
    // The server rotated the refresh token: the new one is saved.
    assert.ok(api.refreshTokens.has(saved.refreshToken));
    assert.equal(api.refreshTokens.has(old.refreshToken), false);
    assert.ok(saved.expiresAt > Date.now() + 3_000_000);
    assert.equal(saved.clientId, api.clientId);
  });

  it("uses a session with more than a minute left as it is", async () => {
    const session = api.session({ expiresAt: Date.now() + 120_000 });
    await saveSession(apiUrl, session);
    assert.deepEqual(await whoami(apiUrl), { ...ME, apiUrl });
    assert.equal(api.counts.refreshes, 0);
    assert.equal(api.counts.config, 0);
    assert.deepEqual(api.meTokens, [session.accessToken]);
  });

  it("keeps the refresh token when the server doesn't rotate it", async () => {
    api.options.rotate = false;
    const old = api.session({ expiresAt: Date.now() - 1_000 });
    await saveSession(apiUrl, old);

    assert.deepEqual(await whoami(apiUrl), { ...ME, apiUrl });
    const saved = await loadSession(apiUrl);
    assert.ok(saved);
    assert.notEqual(saved.accessToken, old.accessToken);
    assert.equal(saved.refreshToken, old.refreshToken);
    assert.equal(api.counts.refreshes, 1);
  });

  it("R2: refreshes once when two processes find the token expired", { timeout: 30_000 }, async () => {
    const old = api.session({ expiresAt: Date.now() - 1_000 });
    await saveSession(apiUrl, old);
    const release = await tryLoginLock();
    assert.ok(release);
    const runs = Promise.all([cli(["whoami"], cliEnv()), cli(["whoami"], cliEnv())]);
    // Both have read the expired session and fetched the sign-in config:
    // each is about to refresh.
    while (api.counts.config < 2) await sleep(20);
    await release();
    const results = await runs;

    assert.deepEqual(
      results.map((result) => result.code),
      [0, 0],
      results.map((result) => result.stderr).join("\n"),
    );
    assert.equal(api.counts.refreshes, 1);
    const saved = await loadSession(apiUrl);
    assert.ok(saved);
    assert.deepEqual(api.meTokens, [saved.accessToken, saved.accessToken]);
    assertNoTokens(results.flatMap(({ stdout, stderr }) => [stdout, stderr]));
  });

  it("R2: two commands in one process that find the token expired refresh it once", async () => {
    await saveSession(apiUrl, api.session({ expiresAt: Date.now() - 1_000 }));
    const results = await whileLocked(() =>
      Promise.all([requireToken(apiUrl), requireToken(apiUrl)]),
    );
    assert.equal(api.counts.refreshes, 1);
    const saved = await loadSession(apiUrl);
    assert.deepEqual(
      results.map((result) => result.token),
      [saved?.accessToken, saved?.accessToken],
    );
  });

  it("R2: refreshSession re-reads the file and uses a session another command refreshed", async () => {
    const old = api.session();
    await saveSession(apiUrl, old);
    const first = await refreshSession(apiUrl, old.accessToken);
    // Another caller still holding the old access token.
    assert.equal(await refreshSession(apiUrl, old.accessToken), first);
    assert.equal(api.counts.refreshes, 1);
  });

  it("R3: a refreshed session it couldn't save is used, kept in a recovery file, and not refreshed again", async () => {
    const old = api.session({ expiresAt: Date.now() - 1_000 });
    await saveSession(apiUrl, old);
    failRenames();
    let token: string;
    try {
      ({ token } = await requireToken(apiUrl));
    } finally {
      restoreRenames();
    }
    assert.notEqual(token, old.accessToken);
    assert.match(String(notices.warning), /kept in/);
    const kept = JSON.parse(await readFile(String(notices.recoveryFile), "utf8"));
    assert.equal(kept.sessions[apiUrl].accessToken, token);
    // The rotated refresh token is only in the recovery file: the next
    // command uses that session rather than spending the old token again.
    assert.deepEqual(await requireToken(apiUrl), { token, source: "file" });
    assert.equal(api.counts.refreshes, 1);
  });

  it("a refresh that fails with a 5xx or a network error is retryable and never starts a sign-in", async () => {
    const old = api.session({ expiresAt: Date.now() - 1_000 });
    await saveSession(apiUrl, old);

    api.scripts.refresh = [{ status: 503, body: { error: "temporarily_unavailable" } }];
    let error = await failure(whoami(apiUrl));
    assert.equal(error.exitCode, EXIT.error);
    assert.equal(error.details.retryable, true);

    api.configOverrides.tokenEndpoint = "http://127.0.0.1:1/oauth/token";
    error = await failure(whoami(apiUrl));
    assert.equal(error.exitCode, EXIT.error);
    assert.equal(error.details.retryable, true);

    api.scripts.config = [
      { status: 503, body: { success: false, error: "Sign-in is unavailable", retryable: true } },
    ];
    error = await failure(whoami(apiUrl));
    assert.equal(error.exitCode, EXIT.error);
    assert.equal(error.details.retryable, true);

    assert.equal(api.counts.deviceStarts, 0);
    assert.deepEqual(await loadSession(apiUrl), old);
  });
});

describe("R1: a 401 never deletes the saved session", () => {
  it("a 401 refreshes once and retries with the new token", async () => {
    const old = api.session();
    await saveSession(apiUrl, old);
    api.scripts.me = [{ status: 401, body: { success: false, error: "Invalid or expired token" } }];

    assert.deepEqual(await whoami(apiUrl), { ...ME, apiUrl });
    assert.equal(api.counts.refreshes, 1);
    assert.equal(api.counts.deviceStarts, 0);
    const saved = await loadSession(apiUrl);
    assert.ok(saved);
    assert.notEqual(saved.accessToken, old.accessToken);
    assert.deepEqual(api.meTokens, [old.accessToken, saved.accessToken]);
  });

  it("a 401 after refresh starts a new sign-in and keeps the session file until it succeeds", async () => {
    await saveSession(apiUrl, api.session());
    api.options.rejectAll = true;

    const error = await failure(whoami(apiUrl));
    assert.equal(error.exitCode, EXIT.unauthenticated);
    assert.equal(error.details.loginUrl, linkFor(1));
    assert.match(error.message, /saved sign-in/);
    assert.doesNotMatch(error.message, /\b(?:was|is) revoked/);
    assert.equal(api.counts.refreshes, 1);
    // The refreshed session is still saved.
    const kept = await loadSession(apiUrl);
    assert.ok(kept);
    assert.equal(kept.accessToken, api.meTokens.at(-1));

    // Fortrip revoked the old sign-in, and the user approves the link.
    api.options.rejectAll = false;
    api.accessTokens.clear();
    api.refreshTokens.clear();
    api.approve(linkFor(1));
    assert.deepEqual(await whoami(apiUrl), { ...ME, apiUrl });
    const saved = await loadSession(apiUrl);
    assert.ok(saved);
    assert.notEqual(saved.accessToken, kept.accessToken);
    assert.ok(api.accessTokens.has(saved.accessToken));
    assert.deepEqual(await loadPendingLogins(apiUrl), []);
  });

  it("after a passing 401, the next run works with the saved session", async () => {
    await saveSession(apiUrl, api.session());
    const rejected = { status: 401, body: { success: false, error: "Invalid or expired token" } };
    api.scripts.me = [rejected, rejected];
    await failure(whoami(apiUrl));

    assert.deepEqual(await whoami(apiUrl), { ...ME, apiUrl });
    assert.equal(api.counts.deviceStarts, 1);
    assert.equal(api.counts.refreshes, 1);
  });

  it("invalid_grant on refresh: sign-in required, the old session kept until a new one is saved", async () => {
    const old = api.session({ expiresAt: Date.now() - 1_000 });
    await saveSession(apiUrl, old);
    // Revoked, or expired on the server.
    api.refreshTokens.delete(old.refreshToken);

    const error = await failure(whoami(apiUrl));
    assert.equal(error.exitCode, EXIT.unauthenticated);
    assert.equal(error.details.loginUrl, linkFor(1));
    assert.deepEqual(await loadSession(apiUrl), old);
    assert.equal(api.counts.me, 0);

    api.approve(linkFor(1));
    assert.deepEqual(await whoami(apiUrl), { ...ME, apiUrl });
    const saved = await loadSession(apiUrl);
    assert.ok(saved);
    assert.notEqual(saved.accessToken, old.accessToken);
  });

  it("uses a session another command saved meanwhile instead of refreshing", async () => {
    const stale = api.session();
    await saveSession(apiUrl, stale);
    api.accessTokens.delete(stale.accessToken);
    const fresh = api.session();
    api.hooks.onRejected = () => saveSession(apiUrl, fresh);

    assert.deepEqual(await whoami(apiUrl), { ...ME, apiUrl });
    assert.deepEqual(await loadSession(apiUrl), fresh);
    assert.equal(api.counts.refreshes, 0);
    assert.equal(api.counts.deviceStarts, 0);
  });

  it("a 503 never starts a new sign-in", async () => {
    await saveSession(apiUrl, api.session());
    api.scripts.me = [
      {
        status: 503,
        body: {
          success: false,
          error: "Supplier unavailable",
          reason: "supplier_unavailable",
          retryable: true,
        },
      },
    ];
    const error = await failure(whoami(apiUrl));
    assert.equal(error.exitCode, EXIT.error);
    assert.equal(error.details.retryable, true);
    assert.equal(api.counts.refreshes, 0);
    assert.equal(api.counts.deviceStarts, 0);
  });
});

describe("FORTRIP_TOKEN", () => {
  it("wins over the saved session and is sent as it is", async () => {
    await saveSession(apiUrl, api.session({ expiresAt: Date.now() - 1_000 }));
    const fromEnv = api.session().accessToken;
    process.env.FORTRIP_TOKEN = fromEnv;

    assert.deepEqual(await requireToken(apiUrl), { token: fromEnv, source: "env" });
    assert.deepEqual(await whoami(apiUrl), { ...ME, apiUrl });
    assert.deepEqual(api.meTokens, [fromEnv]);
    assert.equal(api.counts.config, 0);
  });

  it("a rejected FORTRIP_TOKEN exits 3 with tokenSource and no loginUrl; nothing is refreshed and the saved session is left alone", async () => {
    const saved = api.session();
    await saveSession(apiUrl, saved);
    process.env.FORTRIP_TOKEN = "not-a-token";

    const error = await failure(whoami(apiUrl));
    assert.equal(error.exitCode, EXIT.unauthenticated);
    assert.match(error.message, /FORTRIP_TOKEN/);
    assert.match(error.message, /If this keeps happening/);
    assert.equal(error.details.loginUrl, undefined);
    assert.equal(error.details.tokenSource, "FORTRIP_TOKEN");
    assert.deepEqual(await loadSession(apiUrl), saved);
    assert.equal(api.counts.refreshes, 0);
    assert.equal(api.counts.deviceStarts, 0);
  });
});

describe("logout and whoami", () => {
  it("logout revokes the refresh token and removes the session; whoami then exits 3", async () => {
    approveEveryLogin();
    await runLogin();
    const session = await loadSession(apiUrl);
    assert.ok(session);

    assert.deepEqual(await logout(apiUrl), { loggedOut: true, apiUrl });
    assert.deepEqual(api.revoked, [session.refreshToken]);
    assert.equal(api.refreshTokens.has(session.refreshToken), false);
    assert.equal(await loadSession(apiUrl), null);
    api.hooks.onPoll = undefined;
    const error = await failure(whoami(apiUrl));
    assert.equal(error.exitCode, EXIT.unauthenticated);
    assert.equal(typeof error.details.loginUrl, "string");
  });

  it("logout keeps the session when the revocation fails, forgets one the server doesn't know, and exits 3 when signed out", async () => {
    const session = api.session();
    await saveSession(apiUrl, session);
    api.scripts.revoke = [{ status: 503, body: { error: "temporarily_unavailable" } }];
    let error = await failure(logout(apiUrl));
    assert.equal(error.exitCode, EXIT.error);
    assert.equal(error.details.retryable, true);
    assert.deepEqual(await loadSession(apiUrl), session);

    api.scripts.revoke = [{ status: 400, body: { error: "invalid_grant" } }];
    assert.deepEqual(await logout(apiUrl), { loggedOut: true, apiUrl });
    assert.equal(await loadSession(apiUrl), null);

    error = await failure(logout(apiUrl));
    assert.equal(error.exitCode, EXIT.unauthenticated);
  });

  it("logout revokes and removes sessions kept in recovery files", async () => {
    const saved = api.session();
    await saveSession(apiUrl, saved);
    const older = api.session({ expiresAt: Date.now() + 60_000 });
    await writeFile(
      join(dirname(credentialsPath()), "credentials.recovered-1-a.json"),
      JSON.stringify({ version: 2, sessions: { [apiUrl]: older } }),
    );

    assert.deepEqual(await logout(apiUrl), { loggedOut: true, apiUrl });
    assert.deepEqual(api.revoked.sort(), [saved.refreshToken, older.refreshToken].sort());
    assert.equal(await loadSession(apiUrl), null);
    assert.deepEqual(await loadRecoveredSessions(apiUrl), []);
  });
});

describe("a re-login revokes the session it replaced", () => {
  it("an agent command's re-login revokes the replaced refresh token, never the new one", async () => {
    const old = api.session();
    await saveSession(apiUrl, old);
    // Fortrip no longer accepts the session, and it can't be refreshed.
    api.accessTokens.delete(old.accessToken);
    api.refreshTokens.delete(old.refreshToken);
    api.approve(String((await failure(whoami(apiUrl))).details.loginUrl));
    assert.deepEqual(api.revoked, []);

    assert.deepEqual(await whoami(apiUrl), { ...ME, apiUrl });
    const saved = await loadSession(apiUrl);
    assert.ok(saved);
    assert.deepEqual(api.revoked, [old.refreshToken]);
    assert.ok(api.refreshTokens.has(saved.refreshToken));
  });

  it("`fortrip login` over a saved session revokes the old refresh token", async () => {
    const old = api.session();
    await saveSession(apiUrl, old);
    approveEveryLogin();
    await runLogin();
    const saved = await loadSession(apiUrl);
    assert.ok(saved);
    assert.notEqual(saved.refreshToken, old.refreshToken);
    assert.deepEqual(api.revoked, [old.refreshToken]);
    assert.equal(api.refreshTokens.has(old.refreshToken), false);
    assert.ok(api.refreshTokens.has(saved.refreshToken));
  });

  it("a revocation that fails doesn't change the command's outcome", async () => {
    approveEveryLogin();
    for (const fail of [
      () => {
        api.scripts.revoke = [{ status: 503, body: { error: "temporarily_unavailable" } }];
      },
      () => {
        api.configOverrides.revocationEndpoint = "http://127.0.0.1:1/oauth/token/revoke";
      },
    ]) {
      const old = api.session();
      await saveSession(apiUrl, old);
      fail();
      assert.deepEqual(await runLogin(), { ...ME, apiUrl });
      const saved = await loadSession(apiUrl);
      assert.ok(saved);
      assert.notEqual(saved.accessToken, old.accessToken);
      assert.ok(api.refreshTokens.has(saved.refreshToken));
    }
  });

  it("a first sign-in, or a refresh, revokes nothing", async () => {
    api.approve(String((await failure(requireToken(apiUrl))).details.loginUrl));
    await requireToken(apiUrl);
    await deleteSession(apiUrl);
    approveEveryLogin();
    await runLogin();
    const saved = await loadSession(apiUrl);
    assert.ok(saved);
    await refreshSession(apiUrl, saved.accessToken);
    assert.equal(api.counts.refreshes, 1);
    assert.deepEqual(api.revoked, []);
  });
});

describe("credentials file problems", () => {
  it("login fails on a credentials file it can't read before the user approves anything", async () => {
    const path = credentialsPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{not json");
    const error = await failure(runLogin());
    assert.match(error.message, /Move it away/);
    assert.equal(api.counts.deviceStarts, 0);
  });
});
