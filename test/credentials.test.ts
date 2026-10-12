import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";

import {
  credentialsPath,
  deleteToken,
  loadStoredToken,
  resolveApiUrl,
  resolveToken,
  saveToken,
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
});

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
