import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, it } from "node:test";

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

  it("takes over a lock left by a process that died holding it", async () => {
    const path = credentialsPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.lock`, "");
    const longAgo = new Date(Date.now() - 60_000);
    await utimes(`${path}.lock`, longAgo, longAgo);

    await saveToken("https://fortrip.ai", "fth_prod", env);
    assert.equal(await loadStoredToken("https://fortrip.ai", env), "fth_prod");
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
