import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import { renderGuide } from "@fortrip/agent-contract";

const run = promisify(execFile);
const cli = (...args: string[]) =>
  run(process.execPath, ["--import", "tsx", "src/cli.ts", ...args]);

describe("guide", () => {
  it("the package ships no Markdown guides to read", async () => {
    const { files } = JSON.parse(await readFile("package.json", "utf8"));
    assert.deepEqual(files, ["dist", "README.md", "NOTICE", "THIRD-PARTY-NOTICES"]);
  });

  it("no guide or help text names the supplier", async () => {
    const texts = [renderGuide("cli", "main"), renderGuide("cli", "planning")];
    for (const args of [["--help"], ["hotels", "--help"], ["hotels", "offers", "--help"], ["orders", "--help"], ["orders", "create", "--help"]]) {
      texts.push((await cli(...args)).stdout);
    }
    // Assembled, so that this file doesn't name the supplier either.
    const supplier = new RegExp(["hui" + "zhi", "汇" + "智"].join("|"), "i");
    for (const text of texts) assert.doesNotMatch(text, supplier);
  });

  it("`fortrip guide` is an unknown command", async () => {
    await assert.rejects(cli("guide"), (error: { code?: number; stderr?: string }) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr ?? "", /^Error: Unknown command/);
      return true;
    });
  });

  it("--version reports package.json's version", async () => {
    const { version } = JSON.parse(await readFile("package.json", "utf8"));
    assert.equal((await cli("--version")).stdout, `${version}\n`);
  });
});
