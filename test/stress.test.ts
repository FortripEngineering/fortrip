import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readlinkSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import { loadStoredToken, saveToken } from "../src/credentials.ts";
import { startFakeApi } from "./helpers/fake-api.ts";
import { cli } from "./helpers/cli.ts";

const exec = promisify(execFile);
/** STRESS_ROUNDS=90 for a longer run. */
const ROUNDS = process.env.STRESS_ROUNDS ? Number(process.env.STRESS_ROUNDS) : undefined;

async function configDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "fortrip-stress-"));
}

function saveTokens(xdg: string, prefix: string, count: number) {
  return exec(
    process.execPath,
    ["--import", "tsx", "test/helpers/save-tokens.ts", prefix, String(count)],
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

describe("I4 stress: processes past an abandoned lock", () => {
  const rounds = ROUNDS ?? 20;
  it(`${rounds} rounds of 10 processes saving 3 tokens each lose none`, { timeout: 600_000 }, async () => {
    for (let round = 0; round < rounds; round++) {
      const xdg = await configDir();
      await mkdir(join(xdg, "fortrip"), { recursive: true });
      // Left by a process that died holding it.
      await writeFile(
        join(xdg, "fortrip", "credentials.json.lock"),
        JSON.stringify({ pid: await exitedPid(), host: hostname(), pidns: pidNamespace(), id: "x" }),
      );
      await Promise.all(Array.from({ length: 10 }, (_, p) => saveTokens(xdg, `p${p}`, 3)));

      const file = JSON.parse(await readFile(join(xdg, "fortrip", "credentials.json"), "utf8"));
      assert.equal(Object.keys(file.tokens).length, 30, `round ${round}`);
    }
  });
});

describe("I2 stress: 0.3.0 writing while this version writes", () => {
  const rounds = ROUNDS ?? 6;
  it(`${rounds} rounds: no token is lost to a misread, nobody crashes`, { timeout: 600_000 }, async () => {
    const api = await startFakeApi();
    // Every login 0.3.0 polls is dead, so each 0.3.0 run writes the file.
    api.options.expireAll = true;
    try {
      for (let round = 0; round < rounds; round++) {
        const xdg = await configDir();
        const env = {
          ...process.env,
          FORTRIP_API_URL: api.url,
          FORTRIP_TOKEN: "",
          XDG_CONFIG_HOME: xdg,
        };
        await saveToken("https://keep.example", "fth_keep", env);
        // A big file keeps 0.3.0's truncate-then-write window open longer,
        // so readers land in it.
        const path = join(xdg, "fortrip", "credentials.json");
        const file = JSON.parse(await readFile(path, "utf8"));
        for (let n = 0; n < 20_000; n++) {
          file.tokens[`https://filler-${n}.example`] = { accessToken: `fth_${n}`, createdAt: "x" };
        }
        await writeFile(path, JSON.stringify(file));

        const old: number[] = [];
        const [, current, saves] = await Promise.all([
          (async () => {
            for (let n = 0; n < 8; n++) old.push((await cli("0.3.0", ["whoami"], env)).code);
          })(),
          Promise.all(Array.from({ length: 5 }, () => cli("current", ["whoami"], env))),
          Promise.all(Array.from({ length: 3 }, (_, p) => saveTokens(xdg, `r${round}p${p}`, 20))),
        ]);

        assert.deepEqual(old, Array(8).fill(3), `round ${round}: 0.3.0 exits`);
        assert.deepEqual(
          current.map((result) => result.code),
          [3, 3, 3, 3, 3],
          current.map((result) => result.stderr).join("\n"),
        );
        assert.equal(saves.length, 3);
        // Both versions only ever rewrite what they read, so a token that
        // was there before the round is still there unless something took
        // a half-written file for the whole file.
        assert.equal(await loadStoredToken("https://keep.example", env), "fth_keep", `round ${round}`);
      }
    } finally {
      await api.close();
    }
  });
});
