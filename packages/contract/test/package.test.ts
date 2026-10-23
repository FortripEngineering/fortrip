import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { build } from "tsup";

import config from "../tsup.config.ts";

describe("the published package", () => {
  it("ships NOTICE", async () => {
    const { files } = JSON.parse(await readFile("package.json", "utf8"));
    assert.deepEqual(files, ["dist", "NOTICE"]);
  });

  // zod is a peer dependency, so the bundle imports it; a package bundled
  // into dist/ would need its license shipped too.
  it("bundles no other package's code", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "fortrip-contract-bundle-"));
    try {
      await build({ ...config, dts: false, outDir, metafile: true, silent: true, config: false });
      const { inputs } = JSON.parse(await readFile(join(outDir, "metafile-esm.json"), "utf8"));
      assert.deepEqual(
        Object.keys(inputs).filter((input) => input.includes("node_modules/")),
        [],
      );
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
