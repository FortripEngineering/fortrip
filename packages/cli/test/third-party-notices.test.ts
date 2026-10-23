import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { build } from "tsup";

import config from "../tsup.config.ts";

const NODE_MODULES = "node_modules/";

/**
 * The packages the bundler inlines into `dist/`, each with the directory it
 * was read from: what esbuild's metafile lists as inputs from a
 * `node_modules` directory, building with the package's own tsup config.
 * The CLI's source and the contract's (Fortrip's own) aren't among them.
 */
async function bundledPackages(): Promise<Map<string, string>> {
  const outDir = await mkdtemp(join(tmpdir(), "fortrip-bundle-"));
  try {
    await build({ ...config, outDir, metafile: true, silent: true, config: false });
    const { inputs } = JSON.parse(await readFile(join(outDir, "metafile-esm.json"), "utf8"));
    const packages = new Map<string, string>();
    for (const input of Object.keys(inputs)) {
      const at = input.lastIndexOf(NODE_MODULES);
      if (at < 0) continue;
      const [scope = "", name = ""] = input.slice(at + NODE_MODULES.length).split("/");
      const packageName = scope.startsWith("@") ? `${scope}/${name}` : scope;
      packages.set(packageName, resolve(input.slice(0, at + NODE_MODULES.length), packageName));
    }
    return packages;
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

/** THIRD-PARTY-NOTICES' entries: package name -> version, license, text. */
function entriesOf(notices: string): Map<string, { version: string; license: string; text: string }> {
  const entries = new Map<string, { version: string; license: string; text: string }>();
  for (const block of notices.split(/^={80}$/m).slice(1)) {
    const match = block.match(/^\n(\S+) (\S+) \((.+)\)\n-{80}\n([\s\S]*)$/);
    assert.ok(match, `an entry that doesn't parse: ${block.slice(0, 80)}`);
    const [, name = "", version = "", license = "", text = ""] = match;
    entries.set(name, { version, license, text: text.trim() });
  }
  return entries;
}

describe("THIRD-PARTY-NOTICES", () => {
  it("lists every package bundled into dist/ with its version, license and LICENSE file", async () => {
    const entries = entriesOf(await readFile("THIRD-PARTY-NOTICES", "utf8"));
    const bundled = await bundledPackages();

    // zod at least: a bundle without third-party code would make this vacuous.
    assert.ok(bundled.has("zod"), [...bundled.keys()].join(", "));
    assert.deepEqual([...entries.keys()].sort(), [...bundled.keys()].sort());
    for (const [name, dir] of bundled) {
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      const licenseFile = (await readdir(dir)).find((file) => /^licen[cs]e(\.|$)/i.test(file));
      assert.ok(licenseFile, `${name} has no LICENSE file`);
      assert.deepEqual(entries.get(name), {
        version: pkg.version,
        license: pkg.license,
        text: (await readFile(join(dir, licenseFile), "utf8")).trim(),
      });
    }
  });

  it("ships with the package", async () => {
    const { files } = JSON.parse(await readFile("package.json", "utf8"));
    assert.ok(files.includes("THIRD-PARTY-NOTICES"));
  });
});
