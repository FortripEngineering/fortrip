import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { deployGuard } from "./docs-deploy-guard.ts";

describe("the docs deploy guard", () => {
  it("lets a stable version through", () => {
    assert.deepEqual(deployGuard("4.3.0"), { ok: true });
  });

  for (const version of ["4.3.0-rc.1", "4.3.0-beta", "4.3.0+x", ""]) {
    it(`refuses ${JSON.stringify(version)}, naming it`, () => {
      const result = deployGuard(version);
      assert.equal(result.ok, false);
      assert.ok(result.message?.includes(`"${version}"`));
      assert.match(result.message ?? "", /stable|X\.Y\.Z/);
    });
  }

  it("run directly, reads the contract's version and exits by it", () => {
    const script = fileURLToPath(new URL("./docs-deploy-guard.ts", import.meta.url));
    const run = spawnSync(process.execPath, ["--import", "tsx", script], { encoding: "utf8" });
    const { version } = JSON.parse(
      readFileSync(new URL("../packages/contract/package.json", import.meta.url), "utf8"),
    ) as { version: string };
    assert.equal(run.status, /^\d+\.\d+\.\d+$/.test(version) ? 0 : 1, run.stderr);
  });
});
