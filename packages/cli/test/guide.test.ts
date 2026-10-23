import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import { type GuideTopic, renderGuide } from "@fortrip/agent-contract";

import { readGuide } from "../src/guide.ts";
import { VERSION } from "../src/version.ts";

const run = promisify(execFile);
const cli = (...args: string[]) =>
  run(process.execPath, ["--import", "tsx", "src/cli.ts", ...args]);

/** What `fortrip guide` prints: the contract's guide for the CLI, pinned to
 *  the running version. */
const expected = (topic: GuideTopic) =>
  renderGuide("cli", topic).replaceAll("fortrip@latest", `fortrip@${VERSION}`);

describe("guide", () => {
  it("prints the contract's main guide pinned to this version", async () => {
    const guide = expected("main");
    // The contract's wording is the contract's tests' business; these only
    // check that the substitution had something to replace.
    assert.ok(guide.includes(`npx -y fortrip@${VERSION}`));
    assert.doesNotMatch(guide, /fortrip@latest/);
    assert.equal(readGuide("main"), guide);
    assert.equal((await cli("guide")).stdout, guide);
  });

  it("prints the contract's planning guide pinned to this version", async () => {
    const guide = expected("planning");
    assert.ok(guide.includes(`npx -y fortrip@${VERSION}`));
    assert.doesNotMatch(guide, /fortrip@latest/);
    assert.equal(readGuide("planning"), guide);
    assert.equal((await cli("guide", "planning")).stdout, guide);
  });

  it("the package ships no Markdown guides to read", async () => {
    const { files } = JSON.parse(await readFile("package.json", "utf8"));
    assert.deepEqual(files, ["dist", "README.md", "NOTICE"]);
  });

  it("no guide or help text names the supplier", async () => {
    const texts = [expected("main"), expected("planning")];
    for (const args of [["--help"], ["hotels", "--help"], ["hotels", "rates", "--help"], ["hotels", "book", "--help"]]) {
      texts.push((await cli(...args)).stdout);
    }
    // Assembled, so that this file doesn't name the supplier either.
    const supplier = new RegExp(["hui" + "zhi", "汇" + "智"].join("|"), "i");
    for (const text of texts) assert.doesNotMatch(text, supplier);
  });

  it("rejects an unknown topic with exit 2 and the usage", async () => {
    for (const args of [["nope"], ["main"], ["planning", "extra"]]) {
      await assert.rejects(
        cli("guide", ...args),
        (error: { code?: number; stdout?: string; stderr?: string }) => {
          assert.equal(error.code, 2, args.join(" "));
          assert.equal(error.stdout, "", args.join(" "));
          assert.match(JSON.parse(error.stderr ?? "").error, /fortrip guide \[planning\]/);
          return true;
        },
      );
    }
  });

  it("--version reports package.json's version", async () => {
    const { version } = JSON.parse(await readFile("package.json", "utf8"));
    assert.equal((await cli("--version")).stdout, `${version}\n`);
  });
});
