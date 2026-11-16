import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import { renderGuide } from "@fortrip/agent-contract";

const run = promisify(execFile);
const cli = (...args: string[]) =>
  run(process.execPath, ["--import", "tsx", "src/cli.ts", ...args]);

/** The supplier's names, from the environment (a CI secret) so that this
 *  repository carries none. Unset, as on a fork or a laptop, there is nothing
 *  to look for and the check is skipped. */
const SUPPLIER_NAMES = (process.env.SUPPLIER_DENYLIST ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const SUPPLIER =
  SUPPLIER_NAMES.length > 0
    ? new RegExp(SUPPLIER_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i")
    : null;
const NO_LIST = SUPPLIER ? false : "SUPPLIER_DENYLIST is not set";

describe("guide", () => {
  it("the package ships no Markdown guides to read", async () => {
    const { files } = JSON.parse(await readFile("package.json", "utf8"));
    assert.deepEqual(files, ["dist", "README.md", "NOTICE", "THIRD-PARTY-NOTICES"]);
  });

  it("no guide or help text names the supplier", { skip: NO_LIST }, async () => {
    const texts = [renderGuide("cli", "main"), renderGuide("cli", "planning")];
    for (const args of [["--help"], ["hotels", "--help"], ["hotels", "offers", "--help"], ["orders", "--help"], ["orders", "create", "--help"]]) {
      texts.push((await cli(...args)).stdout);
    }
    // Not doesNotMatch: its failure prints the pattern and the text.
    texts.forEach((text, index) => assert.ok(!(SUPPLIER as RegExp).test(text), `text ${index} names the supplier`));
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
