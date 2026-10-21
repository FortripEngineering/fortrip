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
  deleteToken,
  loadPendingLogins,
  loadStoredToken,
  type PendingLogin,
  resolveApiUrl,
  resolveToken,
  saveToken,
  tryLock,
  tryLoginLock,
  updatePendingLogin,
} from "../src/credentials.ts";
import { CliError } from "../src/errors.ts";

let env: NodeJS.ProcessEnv;
beforeEach(async () => {
  env = { XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), "fortrip-cli-")) };
});

describe("credentials", () => {
  it("saves under ~/.config/fortrip with 0600 and keys tokens by API URL", async () => {
    await saveToken("https://fortrip.ai", "fth_prod", env);
    await saveToken("http://localhost:3000", "fth_local", env);

    const path = credentialsPath(env);
    assert.equal(path, join(env.XDG_CONFIG_HOME as string, "fortrip", "credentials.json"));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(await loadStoredToken("https://fortrip.ai", env), "fth_prod");
    assert.equal(await loadStoredToken("http://localhost:3000", env), "fth_local");
    assert.equal(await loadStoredToken("https://other.example", env), null);
    assert.match(await readFile(path, "utf8"), /"createdAt"/);
  });

  it("FORTRIP_TOKEN wins over the saved login", async () => {
    await saveToken("https://fortrip.ai", "fth_saved", env);
    assert.deepEqual(await resolveToken("https://fortrip.ai", env), {
      token: "fth_saved",
      source: "file",
    });
    env.FORTRIP_TOKEN = "fth_env";
    assert.deepEqual(await resolveToken("https://fortrip.ai", env), {
      token: "fth_env",
      source: "env",
    });
  });

  it("deleting the last token removes the file", async () => {
    await saveToken("https://fortrip.ai", "fth_prod", env);
    await deleteToken("https://fortrip.ai", env);
    assert.equal(await resolveToken("https://fortrip.ai", env), null);
    await assert.rejects(stat(credentialsPath(env)));
  });

  it("keeps pending logins until they expire or a token replaces them", async () => {
    const pending = login(1);
    await addPendingLogin("https://fortrip.ai", pending, env);
    assert.equal((await stat(credentialsPath(env))).mode & 0o777, 0o600);
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), [pending]);
    assert.deepEqual(await loadPendingLogins("http://localhost:3000", env), []);

    await saveToken("https://fortrip.ai", "fth_prod", env);
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), []);

    await addPendingLogin(
      "https://fortrip.ai",
      { ...pending, expiresAt: new Date(Date.now() - 1).toISOString() },
      env,
    );
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), []);
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

    await saveToken("https://fortrip.ai", "fth_prod", env);
    await updatePendingLogin("https://fortrip.ai", "dc1", { lastPolledAt }, env);
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), []);
  });

  it("reads the single pending login 0.3.0 saved", async () => {
    const path = credentialsPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ tokens: {}, pending: { "https://fortrip.ai": login(1) } }),
    );
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), [login(1)]);
  });

  it("deleteToken with `only` keeps a token saved meanwhile", async () => {
    await saveToken("https://fortrip.ai", "fth_new", env);
    await deleteToken("https://fortrip.ai", env, "fth_old");
    assert.equal(await loadStoredToken("https://fortrip.ai", env), "fth_new");
    await deleteToken("https://fortrip.ai", env, "fth_new");
    assert.equal(await loadStoredToken("https://fortrip.ai", env), null);
  });

  it("replaces the file atomically in a 0700 directory and leaves no temp or lock files", async () => {
    await Promise.all([
      saveToken("https://fortrip.ai", "fth_prod", env),
      addPendingLogin("http://localhost:3000", login(1), env),
    ]);
    const dir = dirname(credentialsPath(env));
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.deepEqual(await readdir(dir), ["credentials.json"]);
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

describe("I4: one lock holder at a time", () => {
  it("takes over a lock older than its limit", async () => {
    const path = credentialsPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.lock`, "");
    const longAgo = new Date(Date.now() - 60_000);
    await utimes(`${path}.lock`, longAgo, longAgo);

    await saveToken("https://fortrip.ai", "fth_prod", env);
    assert.equal(await loadStoredToken("https://fortrip.ai", env), "fth_prod");
  });

  it("takes over at once a lock whose process on this host has ended", async () => {
    const path = credentialsPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.lock`, ownerOf(await exitedPid()));
    const started = Date.now();
    await saveToken("https://fortrip.ai", "fth_1", env);
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

describe("I2: the file 0.3.0 shares", () => {
  const read = async () => JSON.parse(await readFile(credentialsPath(env), "utf8"));

  it("keeps the newest pending login where 0.3.0 reads it, every login in pendingLogins, and other keys as they were", async () => {
    const path = credentialsPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ tokens: {}, futureKey: { a: 1 } }));
    await addPendingLogin("https://fortrip.ai", login(1), env);
    await addPendingLogin("https://fortrip.ai", login(2), env);

    const file = await read();
    assert.deepEqual(file.pending["https://fortrip.ai"], login(2));
    assert.deepEqual(file.pendingLogins["https://fortrip.ai"], [login(1), login(2)]);
    assert.deepEqual(file.futureKey, { a: 1 });
  });

  it("drops expired logins from the file when it writes", async () => {
    await addPendingLogin(
      "https://fortrip.ai",
      { ...login(1), expiresAt: new Date(Date.now() + 200).toISOString() },
      env,
    );
    await addPendingLogin("http://localhost:3000", login(2), env);
    await sleep(250);
    await saveToken("https://other.example", "fth_other", env);
    const file = await read();
    assert.equal(file.pending["https://fortrip.ai"], undefined);
    assert.equal(file.pendingLogins["https://fortrip.ai"], undefined);
    assert.deepEqual(file.pending["http://localhost:3000"], login(2));
  });

  it("merges a login 0.3.0 put in `pending` with the list it didn't keep", async () => {
    await addPendingLogin("https://fortrip.ai", login(1), env);
    // 0.3.0 starts a login: it rewrites the file from `tokens` and `pending`.
    const file = await read();
    await writeFile(
      credentialsPath(env),
      JSON.stringify({ tokens: file.tokens, pending: { "https://fortrip.ai": login(2) } }),
    );
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), [login(2)]);

    // With the list still there, both count.
    await writeFile(
      credentialsPath(env),
      JSON.stringify({
        ...file,
        pending: { "https://fortrip.ai": login(2) },
      }),
    );
    assert.deepEqual(await loadPendingLogins("https://fortrip.ai", env), [login(1), login(2)]);
  });

  it("waits out a file 0.3.0 is writing instead of taking it for empty", async () => {
    await saveToken("https://keep.example", "fth_keep", env);
    const path = credentialsPath(env);
    const before = await readFile(path, "utf8");
    // 0.3.0 truncates, then writes.
    await writeFile(path, "");
    const saving = saveToken("https://fortrip.ai", "fth_new", env);
    await sleep(150);
    await writeFile(path, before);
    await saving;
    assert.equal(await loadStoredToken("https://keep.example", env), "fth_keep");
    assert.equal(await loadStoredToken("https://fortrip.ai", env), "fth_new");
  });

  it("never overwrites or removes a file it can't parse; the error is retryable", async () => {
    const path = credentialsPath(env);
    await mkdir(dirname(path), { recursive: true });
    for (const text of ["", '{"tokens": {"https://keep', "[]"]) {
      await writeFile(path, text);
      await assert.rejects(
        deleteToken("https://fortrip.ai", env),
        (error) => error instanceof CliError && error.details.retryable === true,
      );
      assert.equal(await readFile(path, "utf8"), text);
    }
  });

  it("makes its change again when 0.3.0 wrote between its read and its write", async () => {
    await saveToken("https://keep.example", "fth_keep", env);
    const path = credentialsPath(env);
    const real = fsp.readFile;
    let reads = 0;
    // The second read of the file (the check before writing) finds that
    // 0.3.0 saved a token meanwhile.
    mock.method(fsp, "readFile", async (...args: Parameters<typeof real>) => {
      if (args[0] === path && ++reads === 2) {
        const file = JSON.parse(String(await real(path, "utf8")));
        file.tokens["https://old.example"] = { accessToken: "fth_030", createdAt: "x" };
        await writeFile(path, JSON.stringify(file));
      }
      return real(...args);
    });
    syncBuiltinESMExports();
    try {
      await saveToken("https://fortrip.ai", "fth_new", env);
    } finally {
      mock.restoreAll();
      syncBuiltinESMExports();
    }
    assert.equal(await loadStoredToken("https://old.example", env), "fth_030");
    assert.equal(await loadStoredToken("https://fortrip.ai", env), "fth_new");
    assert.equal(await loadStoredToken("https://keep.example", env), "fth_keep");
  });
});

describe("I3: a minted token survives a failed write", () => {
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
      await saveToken("https://fortrip.ai", `fth_${code}`, env);
      assert.equal(calls(), 4);
      mock.restoreAll();
      syncBuiltinESMExports();
      assert.equal(await loadStoredToken("https://fortrip.ai", env), `fth_${code}`);
    }
  });

  it("keeps the token in a recovery file when the write keeps failing", async () => {
    await saveToken("https://keep.example", "fth_keep", env);
    const before = await readFile(credentialsPath(env), "utf8");
    failRename(Number.POSITIVE_INFINITY);
    const error = await saveToken("https://fortrip.ai", "fth_minted", env).then(
      () => assert.fail("expected an error"),
      (error: unknown) => error,
    );
    assert.ok(error instanceof CliError);
    const kept = String(error.details.recoveryFile);
    assert.match(error.message, /kept in/);
    assert.equal(
      JSON.parse(await readFile(kept, "utf8")).tokens["https://fortrip.ai"].accessToken,
      "fth_minted",
    );
    assert.equal((await stat(kept)).mode & 0o777, 0o600);
    assert.equal(await readFile(credentialsPath(env), "utf8"), before);
  });
});

const IN_TEN_MINUTES = new Date(Date.now() + 600_000).toISOString();

function login(n: number): PendingLogin {
  return {
    deviceCode: `dc${n}`,
    userCode: `CODE-${n}`,
    loginUrl: `https://fortrip.ai/cli/authorize?code=CODE-${n}`,
    expiresAt: IN_TEN_MINUTES,
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
