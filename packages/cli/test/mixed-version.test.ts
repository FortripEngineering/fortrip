import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { cli } from "./helpers/cli.ts";
import { type FakeApi, startFakeApi } from "./helpers/fake-api.ts";

describe("I2: 0.3.0 and this version share one credentials file", () => {
  let api: FakeApi;
  let env: NodeJS.ProcessEnv;
  beforeEach(async () => {
    api = await startFakeApi();
    env = {
      ...process.env,
      FORTRIP_API_URL: api.url,
      FORTRIP_TOKEN: "",
      XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), "fortrip-mixed-")),
    };
  });
  afterEach(() => api.close());

  const loginUrl = (result: { stderr: string }) => JSON.parse(result.stderr).loginUrl;

  it("0.3.0 finishes a login this version started", async () => {
    const first = await cli("current", ["whoami"], env);
    assert.equal(first.code, 3);
    api.approve(loginUrl(first));

    assert.equal((await cli("0.3.0", ["whoami"], env)).code, 0);
    assert.equal((await cli("current", ["whoami"], env)).code, 0);
    assert.equal(api.tokens.size, 1);
  });

  it("this version finishes a login 0.3.0 started", async () => {
    const first = await cli("0.3.0", ["whoami"], env);
    assert.equal(first.code, 3);
    api.approve(loginUrl(first));

    assert.equal((await cli("current", ["whoami"], env)).code, 0);
    assert.equal((await cli("0.3.0", ["whoami"], env)).code, 0);
    assert.equal(api.tokens.size, 1);
  });

  it("a login 0.3.0 starts over this version's file is the one both use", async () => {
    const first = await cli("current", ["whoami"], env);
    for (const auth of api.auths.values()) auth.status = "denied";
    // 0.3.0 finds that login denied, starts its own, and rewrites the file
    // the 0.3.0 way (only `tokens` and `pending`).
    const old = await cli("0.3.0", ["whoami"], env);
    assert.equal(old.code, 3);
    assert.notEqual(loginUrl(old), loginUrl(first));

    const current = await cli("current", ["whoami"], env);
    assert.equal(loginUrl(current), loginUrl(old));
    api.approve(loginUrl(old));
    assert.equal((await cli("current", ["whoami"], env)).code, 0);
    assert.equal((await cli("0.3.0", ["whoami"], env)).code, 0);
  });

  it("logs out with either version", async () => {
    const first = await cli("current", ["whoami"], env);
    api.approve(loginUrl(first));
    assert.equal((await cli("current", ["whoami"], env)).code, 0);
    assert.equal((await cli("0.3.0", ["logout"], env)).code, 0);
    await assert.rejects(readFile(join(env.XDG_CONFIG_HOME as string, "fortrip", "credentials.json")));
  });
});
