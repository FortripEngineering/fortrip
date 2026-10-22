import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readlinkSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import { loadSession, saveSession } from "../src/credentials.ts";
import { cli } from "./helpers/cli.ts";
import { startFakeApi } from "./helpers/fake-api.ts";

const exec = promisify(execFile);
/** STRESS_ROUNDS=90 for a longer run. */
const ROUNDS = process.env.STRESS_ROUNDS ? Number(process.env.STRESS_ROUNDS) : undefined;

async function configDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "fortrip-stress-"));
}

function saveSessions(xdg: string, prefix: string, count: number) {
  return exec(
    process.execPath,
    ["--import", "tsx", "test/helpers/save-sessions.ts", prefix, String(count)],
    { env: { ...process.env, XDG_CONFIG_HOME: xdg } },
  );
}

async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""]);
  await once(child, "exit");
  return child.pid as number;
}

function pidNamespace(): string {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return "";
  }
}

describe("R4 stress: processes past an abandoned lock", () => {
  const rounds = ROUNDS ?? 20;
  it(`${rounds} rounds of 10 processes saving 3 sessions each lose none`, { timeout: 600_000 }, async () => {
    for (let round = 0; round < rounds; round++) {
      const xdg = await configDir();
      await mkdir(join(xdg, "fortrip"), { recursive: true });
      // Left by a process that died holding it.
      await writeFile(
        join(xdg, "fortrip", "credentials.json.lock"),
        JSON.stringify({ pid: await exitedPid(), host: hostname(), pidns: pidNamespace(), id: "x" }),
      );
      await Promise.all(Array.from({ length: 10 }, (_, p) => saveSessions(xdg, `p${p}`, 3)));

      const file = JSON.parse(await readFile(join(xdg, "fortrip", "credentials.json"), "utf8"));
      assert.equal(file.version, 2, `round ${round}`);
      assert.equal(Object.keys(file.sessions).length, 30, `round ${round}`);
    }
  });
});

describe("R2 stress: processes that find the token expired together", () => {
  const rounds = ROUNDS ? Math.ceil(ROUNDS / 3) : 5;
  it(`${rounds} rounds of 6 processes spend the rotating refresh token once`, { timeout: 600_000 }, async () => {
    const api = await startFakeApi();
    // Each process that found the token expired fetches the sign-in config.
    let refreshers = 0;
    try {
      for (let round = 0; round < rounds; round++) {
        api.reset();
        const env = {
          ...process.env,
          FORTRIP_API_URL: api.url,
          FORTRIP_TOKEN: "",
          XDG_CONFIG_HOME: await configDir(),
        };
        await saveSession(api.url, api.session({ expiresAt: Date.now() - 1_000 }), env);

        const results = await Promise.all(Array.from({ length: 6 }, () => cli(["whoami"], env)));
        assert.deepEqual(
          results.map((result) => result.code),
          Array(6).fill(0),
          `round ${round}: ${results.map((result) => result.stderr).join("\n")}`,
        );
        assert.equal(api.counts.refreshes, 1, `round ${round}`);
        const saved = await loadSession(api.url, env);
        assert.ok(saved && api.refreshTokens.has(saved.refreshToken), `round ${round}`);
        refreshers += api.counts.config;
      }
      // Processes did race: more than one per round set out to refresh.
      assert.ok(refreshers > rounds, `${refreshers} refreshers in ${rounds} rounds`);
    } finally {
      await api.close();
    }
  });
});
