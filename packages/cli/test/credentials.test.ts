import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import fsp from "node:fs/promises";
import { readlinkSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
  addPendingLogin,
  credentialsPath,
  deleteSession,
  loadPendingLogins,
  loadRecoveredSessions,
  loadSession,
  type PendingLogin,
  resolveApiUrl,
  type Session,
  saveSession,
  tryLock,
  tryLoginLock,
  updatePendingLogin,
} from "../src/credentials.ts";
import { CliError } from "../src/errors.ts";

let env: NodeJS.ProcessEnv;
beforeEach(async () => {
  env = { XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), "fortrip-cli-")) };
});

const read = async () => JSON.parse(await readFile(credentialsPath(env), "utf8"));

describe("credentials", () => {
  it("saves sessions under ~/.config/fortrip with 0600, per API URL, in the version 2 format", async () => {
    await saveSession("https://fortrip.ai", session("prod"), env);
    await saveSession("http://localhost:3000", session("local"), env);

    const path = credentialsPath(env);
    assert.equal(path, join(env.XDG_CONFIG_HOME as string, "fortrip", "credentials.json"));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await loadSession("https://fortrip.ai", env), session("prod"));
    assert.deepEqual(await loadSession("http://localhost:3000", env), session("local"));
    assert.equal(await loadSession("https://other.example", env), null);
    assert.deepEqual(await read(), {
      version: 2,
      sessions: {
        "https://fortrip.ai": session("prod"),
        "http://localhost:3000": session("local"),
      },
      pendingLogins: {},
    });
  });

  it("deleting the last session leaves an empty file", async () => {
    await saveSession("https://fortrip.ai", session("prod"), env);
    await deleteSession("https://fortrip.ai", env);
    assert.equal(await loadSession("https://fortrip.ai", env), null);
    assert.deepEqual((await read()).sessions, {});
  });

  it("keeps pending logins until they expire or a sign-in replaces them", async () => {
    const pending = login(1);
    await addPendingLogin("https://fortrip.ai", pending, env);
    assert.equal((await stat(credentialsPath(env))).mode & 0o777, 0o600);
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), [pending]);
    assert.deepEqual(await loadPendingLogins("http://localhost:3000", env), []);

    await saveSession("https://fortrip.ai", session("prod"), env);
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), []);

    await addPendingLogin(
      "https://fortrip.ai",
      { ...pending, expiresAt: new Date(Date.now() - 1).toISOString() },
      env,
    );
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), []);
  });

  it("a refresh replaces only the session it refreshed, and keeps pending logins", async () => {
    await saveSession("https://fortrip.ai", session("old"), env);
    await addPendingLogin("https://fortrip.ai", login(1), env);

    // Another command signed in meanwhile: the refreshed session isn't saved.
    assert.deepEqual(
      await saveSession("https://fortrip.ai", session("refreshed"), env, "access_other"),
      session("old"),
    );
    assert.deepEqual(await loadSession("https://fortrip.ai", env), session("old"));

    assert.deepEqual(
      await saveSession("https://fortrip.ai", session("refreshed"), env, "access_old"),
      session("refreshed"),
    );
    assert.deepEqual(await loadSession("https://fortrip.ai", env), session("refreshed"));
    // The user may still approve a link they were shown.
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), [login(1)]);

    // Logged out meanwhile: nothing comes back.
    await deleteSession("https://fortrip.ai", env);
    assert.equal(
      await saveSession("https://fortrip.ai", session("late"), env, "access_refreshed"),
      null,
    );
    assert.equal(await loadSession("https://fortrip.ai", env), null);
  });

  it("keeps every pending login added in parallel", async () => {
    const logins = Array.from({ length: 20 }, (_, index) => login(index));
    await Promise.all(
      logins.map((pending) => addPendingLogin("https://fortrip.ai", pending, env)),
    );
    const saved = await loadPendingLogins("https://fortrip.ai", env);
    assert.deepEqual(
      saved.map((pending) => pending.deviceCode).sort(),
      logins.map((pending) => pending.deviceCode).sort(),
    );
  });

  it("records polls and forgets a login, but never brings one back", async () => {
    await addPendingLogin("https://fortrip.ai", login(1), env);
    await addPendingLogin("https://fortrip.ai", login(2), env);
    const lastPolledAt = new Date().toISOString();
    await updatePendingLogin("https://fortrip.ai", "dc1", { lastPolledAt, interval: 10 }, env);
    await updatePendingLogin("https://fortrip.ai", "dc2", null, env);
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), [
      { ...login(1), lastPolledAt, interval: 10 },
    ]);

    await saveSession("https://fortrip.ai", session("prod"), env);
    await updatePendingLogin("https://fortrip.ai", "dc1", { lastPolledAt }, env);
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), []);
  });

  it("drops expired logins from the file when it writes", async () => {
    await addPendingLogin(
      "https://fortrip.ai",
      { ...login(1), expiresAt: new Date(Date.now() + 200).toISOString() },
      env,
    );
    await addPendingLogin("http://localhost:3000", login(2), env);
    await sleep(250);
    await saveSession("https://other.example", session("other"), env);
    assert.deepEqual((await read()).pendingLogins, { "http://localhost:3000": [login(2)] });
  });

  it("deleteSession with `only` keeps a session saved meanwhile", async () => {
    await saveSession("https://fortrip.ai", session("new"), env);
    await deleteSession("https://fortrip.ai", env, ["access_old"]);
    assert.deepEqual(await loadSession("https://fortrip.ai", env), session("new"));
    await deleteSession("https://fortrip.ai", env, ["access_old", "access_new"]);
    assert.equal(await loadSession("https://fortrip.ai", env), null);
  });

  it("replaces the file atomically in a 0700 directory and leaves no temp or lock files", async () => {
    await Promise.all([
      saveSession("https://fortrip.ai", session("prod"), env),
      addPendingLogin("http://localhost:3000", login(1), env),
    ]);
    const dir = dirname(credentialsPath(env));
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.deepEqual(await readdir(dir), ["credentials.json"]);
  });

  it("writes other top-level keys back as they were", async () => {
    const path = credentialsPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 2, sessions: {}, futureKey: { a: 1 } }));
    await addPendingLogin("https://fortrip.ai", login(1), env);
    assert.deepEqual((await read()).futureKey, { a: 1 });
  });

  it("a file from 0.3.x (no version) counts as empty and is replaced on the next write", async () => {
    const path = credentialsPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        tokens: { "https://fortrip.ai": { accessToken: "fth_old", createdAt: "x" } },
        pending: { "https://fortrip.ai": login(1) },
        pendingLogins: { "https://fortrip.ai": [login(1)] },
      }),
    );
    assert.equal(await loadSession("https://fortrip.ai", env), null);
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), []);

    await saveSession("https://fortrip.ai", session("prod"), env);
    assert.deepEqual(await read(), {
      version: 2,
      sessions: { "https://fortrip.ai": session("prod") },
      pendingLogins: {},
    });
  });

  it("never overwrites a file it can't read, and says to move it", async () => {
    const path = credentialsPath(env);
    await mkdir(dirname(path), { recursive: true });
    for (const text of ['{"version": 2, "sessions": {"https://keep', "[]", '{"version": 3}']) {
      await writeFile(path, text);
      await assert.rejects(
        deleteSession("https://fortrip.ai", env),
        (error) =>
          error instanceof CliError &&
          error.details.retryable === undefined &&
          error.message.includes(path) &&
          /Move it away/.test(error.message),
        text,
      );
      assert.equal(await readFile(path, "utf8"), text);
    }
  });

  it("an empty file counts as empty", async () => {
    const path = credentialsPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "");
    assert.equal(await loadSession("https://fortrip.ai", env), null);
    await saveSession("https://fortrip.ai", session("new"), env);
    assert.deepEqual(await loadSession("https://fortrip.ai", env), session("new"));
  });
});

/** The lock-file contents a process writes (see `newOwner`). */
function ownerOf(pid: number, host = hostname(), pidns = pidNamespace()) {
  return JSON.stringify({ pid, host, pidns, id: "test" });
}

function pidNamespace(): string {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return "";
  }
}

async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""]);
  await once(child, "exit");
  return child.pid as number;
}

describe("R4: one lock holder at a time", () => {
  it("takes over a lock older than its limit", async () => {
    const path = credentialsPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.lock`, "");
    const longAgo = new Date(Date.now() - 60_000);
    await utimes(`${path}.lock`, longAgo, longAgo);

    await saveSession("https://fortrip.ai", session("prod"), env);
    assert.deepEqual(await loadSession("https://fortrip.ai", env), session("prod"));
  });

  it("takes over at once a lock whose process on this host has ended", async () => {
    const path = credentialsPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.lock`, ownerOf(await exitedPid()));
    const started = Date.now();
    await saveSession("https://fortrip.ai", session("1"), env);
    assert.ok(Date.now() - started < 2_000);
  });

  it("doesn't trust a pid from another host or pid namespace", async () => {
    const path = join(env.XDG_CONFIG_HOME as string, "test.lock");
    const pid = await exitedPid();
    for (const owner of [ownerOf(pid, "other.example"), ownerOf(pid, hostname(), "pid:[1]")]) {
      await writeFile(path, owner);
      assert.equal(await tryLock(path, 60_000), null, owner);
      assert.equal(await tryLock(path, 60_000), null, owner);
      assert.equal(await readFile(path, "utf8"), owner);
    }
    await writeFile(path, ownerOf(pid));
    assert.equal(await tryLock(path, 60_000), null); // removes it
    assert.ok(await tryLock(path, 60_000));
  });

  it("a lock dated in the future is taken over once seen unchanged past the limit, not before", async () => {
    const path = join(env.XDG_CONFIG_HOME as string, "test.lock");
    await writeFile(path, ownerOf(process.pid, "other.example"));
    const later = new Date(Date.now() + 3_600_000);
    await utimes(path, later, later);
    assert.equal(await tryLock(path, 300), null);
    assert.equal(await readFile(path, "utf8"), ownerOf(process.pid, "other.example"));
    await sleep(350);
    assert.equal(await tryLock(path, 300), null); // removes it
    assert.ok(await tryLock(path, 300));
  });

  it("a fresh lock is never taken over by age skew: positive age only", async () => {
    const path = join(env.XDG_CONFIG_HOME as string, "test.lock");
    await writeFile(path, ownerOf(process.pid, "other.example"));
    const soon = new Date(Date.now() + 120_000);
    await utimes(path, soon, soon);
    for (let i = 0; i < 3; i++) assert.equal(await tryLock(path, 60_000), null);
    assert.equal(await readFile(path, "utf8"), ownerOf(process.pid, "other.example"));
  });

  it("releasing leaves a lock someone else took over, and never throws", async () => {
    const path = `${credentialsPath(env)}.login-lock`;
    const release = await tryLoginLock(env);
    assert.ok(release);
    await writeFile(path, ownerOf(process.pid, "someone-else"));
    await release();
    assert.equal(await readFile(path, "utf8"), ownerOf(process.pid, "someone-else"));
    await rm(path);
    await release();
  });

  it("a takeover removes only the lock it judged abandoned", async () => {
    const path = join(env.XDG_CONFIG_HOME as string, "test.lock");
    await writeFile(path, ownerOf(await exitedPid()));
    const realWriteFile = fsp.writeFile;
    let reachGuard!: () => void;
    const atGuard = new Promise<void>((resolve) => {
      reachGuard = resolve;
    });
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let paused = false;
    // Waiter A judges the lock abandoned, then stalls before its guard.
    mock.method(fsp, "writeFile", async (...args: Parameters<typeof realWriteFile>) => {
      if (String(args[0]).endsWith(".takeover") && !paused) {
        paused = true;
        reachGuard();
        await gate;
      }
      return realWriteFile(...args);
    });
    syncBuiltinESMExports();
    try {
      const a = tryLock(path, 60_000);
      await atGuard;
      // Meanwhile waiter B takes the lock over and holds it.
      assert.equal(await tryLock(path, 60_000), null);
      const b = await tryLock(path, 60_000);
      assert.ok(b);
      const held = await readFile(path, "utf8");
      openGate();
      assert.equal(await a, null);
      assert.equal(await readFile(path, "utf8"), held);
      await b();
    } finally {
      mock.restoreAll();
      syncBuiltinESMExports();
    }
  });

  it("takes over a lock and takeover guard both left by a process that ended", async () => {
    const path = join(env.XDG_CONFIG_HOME as string, "test.lock");
    const owner = ownerOf(await exitedPid());
    await writeFile(path, owner);
    await writeFile(`${path}.takeover`, owner);
    let release = null;
    for (let tries = 0; !release && tries < 5; tries++) release = await tryLock(path, 60_000);
    assert.ok(release);
  });

  it("a live holder under another user still holds its lock", async () => {
    // pid 1 runs as root: signalling it fails with EPERM, which means running.
    const path = join(env.XDG_CONFIG_HOME as string, "test.lock");
    await writeFile(path, ownerOf(1));
    for (let tries = 0; tries < 3; tries++) assert.equal(await tryLock(path, 60_000), null);
    assert.equal(await readFile(path, "utf8"), ownerOf(1));
  });

  it("a lock it can't read is judged by age", async () => {
    const path = join(env.XDG_CONFIG_HOME as string, "test.lock");
    await writeFile(path, ownerOf(process.pid), { mode: 0o000 });
    assert.equal(await tryLock(path, 300), null);
    await sleep(350);
    assert.equal(await tryLock(path, 300), null); // removes it
    assert.ok(await tryLock(path, 300));
  });

  it("gives up on a lock it can never take, naming it", { timeout: 20_000 }, async () => {
    const path = credentialsPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.lock`, ownerOf(process.pid));
    // The lock can't even be looked at (say, a directory it can't list).
    const realLstat = fsp.lstat;
    mock.method(fsp, "lstat", async (...args: Parameters<typeof realLstat>) => {
      if (String(args[0]).endsWith(".lock")) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return realLstat(...args);
    });
    syncBuiltinESMExports();
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const ticking = setInterval(() => mock.timers.tick(5_000), 20);
    try {
      await assert.rejects(
        deleteSession("https://fortrip.ai", env),
        (error) =>
          error instanceof CliError &&
          error.details.retryable === true &&
          error.details.lockFile === `${path}.lock`,
      );
    } finally {
      clearInterval(ticking);
      mock.timers.reset();
      mock.restoreAll();
      syncBuiltinESMExports();
    }
  });

  it("two waiters can't both take over the same abandoned lock", async () => {
    const path = join(env.XDG_CONFIG_HOME as string, "test.lock");
    for (let round = 0; round < 50; round++) {
      await writeFile(path, ownerOf(await exitedPid()));
      // Many waiters in this process race to take it over and hold it.
      let holders = 0;
      let overlap = false;
      await Promise.all(
        Array.from({ length: 8 }, async () => {
          for (;;) {
            const release = await tryLock(path, 60_000);
            if (!release) {
              await sleep(Math.random() * 5);
              continue;
            }
            holders += 1;
            if (holders > 1) overlap = true;
            await sleep(Math.random() * 5);
            holders -= 1;
            await release();
            return;
          }
        }),
      );
      assert.equal(overlap, false, `round ${round}`);
    }
  });
});

describe("R3: recovery files", () => {
  const recovery = (name: string) =>
    join(env.XDG_CONFIG_HOME as string, "fortrip", `credentials.recovered-${name}.json`);

  it("reads merge them in; the next successful write merges them back, newest per API URL, and removes them", async () => {
    await saveSession("https://a.example", session("a_saved"), env);
    await saveSession("https://b.example", session("b_saved"), env);
    const later = Date.now() + 7_200_000;
    await writeFile(
      recovery("1"),
      JSON.stringify({
        version: 2,
        sessions: {
          "https://a.example": session("a_kept", later),
          "https://b.example": session("b_kept", 1_000),
          "https://c.example": session("c_kept", later),
        },
      }),
    );
    await writeFile(recovery("2"), "not json");

    assert.deepEqual(await loadRecoveredSessions("https://a.example", env), [
      session("a_kept", later),
    ]);
    // A command that only reads uses the newest session already.
    assert.deepEqual(await loadSession("https://a.example", env), session("a_kept", later));
    assert.deepEqual(await loadSession("https://b.example", env), session("b_saved"));
    assert.deepEqual(await loadSession("https://c.example", env), session("c_kept", later));

    await addPendingLogin("https://d.example", login(1), env);
    const file = await read();
    assert.deepEqual(file.sessions["https://a.example"], session("a_kept", later));
    assert.deepEqual(file.sessions["https://b.example"], session("b_saved"));
    assert.deepEqual(file.sessions["https://c.example"], session("c_kept", later));
    await assert.rejects(stat(recovery("1")));
    assert.equal(await readFile(recovery("2"), "utf8"), "not json");
  });
});

describe("R3: a minted session survives a failed write", () => {
  afterEach(() => {
    mock.restoreAll();
    syncBuiltinESMExports();
  });

  function failRename(times: number, code = "EPERM") {
    const real = fsp.rename;
    let calls = 0;
    mock.method(fsp, "rename", async (...args: Parameters<typeof real>) => {
      if (++calls <= times) throw Object.assign(new Error(code), { code });
      return real(...args);
    });
    syncBuiltinESMExports();
    return () => calls;
  }

  it("retries a rename another process blocks for a moment", async () => {
    for (const code of ["EPERM", "EACCES", "EBUSY"]) {
      const calls = failRename(3, code);
      await saveSession("https://fortrip.ai", session(code), env);
      assert.equal(calls(), 4);
      mock.restoreAll();
      syncBuiltinESMExports();
      assert.deepEqual(await loadSession("https://fortrip.ai", env), session(code));
    }
  });

  it("keeps the session in a recovery file when the write keeps failing", async () => {
    await saveSession("https://keep.example", session("keep"), env);
    const before = await readFile(credentialsPath(env), "utf8");
    failRename(Number.POSITIVE_INFINITY);
    const error = await saveSession("https://fortrip.ai", session("minted"), env).then(
      () => assert.fail("expected an error"),
      (error: unknown) => error,
    );
    assert.ok(error instanceof CliError);
    const kept = String(error.details.recoveryFile);
    assert.match(error.message, /kept in/);
    assert.doesNotMatch(error.message, /access_minted|refresh_minted/);
    assert.deepEqual(JSON.parse(await readFile(kept, "utf8")), {
      version: 2,
      sessions: { "https://fortrip.ai": session("minted") },
    });
    assert.equal((await stat(kept)).mode & 0o777, 0o600);
    assert.equal(await readFile(credentialsPath(env), "utf8"), before);
  });
});

const IN_TEN_MINUTES = new Date(Date.now() + 600_000).toISOString();
const IN_AN_HOUR = Date.now() + 3_600_000;

function login(n: number): PendingLogin {
  return {
    deviceCode: `dc${n}`,
    userCode: `CODE-${n}`,
    loginUrl: `https://accounts.example/device?user_code=CODE-${n}`,
    expiresAt: IN_TEN_MINUTES,
  };
}

function session(name: string, expiresAt = IN_AN_HOUR): Session {
  return {
    accessToken: `access_${name}`,
    refreshToken: `refresh_${name}`,
    expiresAt,
    clientId: "client_cli",
  };
}

describe("resolveApiUrl", () => {
  it("defaults to production and normalizes to the origin", () => {
    assert.equal(resolveApiUrl({}), "https://fortrip.ai");
    assert.equal(
      resolveApiUrl({ FORTRIP_API_URL: "https://preview.fortrip.ai/" }),
      "https://preview.fortrip.ai",
    );
    assert.equal(
      resolveApiUrl({ FORTRIP_API_URL: "http://localhost:3000" }),
      "http://localhost:3000",
    );
  });

  it("refuses plain http off localhost and invalid URLs", () => {
    for (const url of ["http://fortrip.ai", "ftp://x", "not a url"]) {
      assert.throws(() => resolveApiUrl({ FORTRIP_API_URL: url }), CliError);
    }
  });
});
