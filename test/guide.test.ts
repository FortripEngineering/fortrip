import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import { readGuide } from "../src/guide.ts";

const run = promisify(execFile);

describe("skill", () => {
  it("prints AGENT_GUIDE.md pinned to this version", async () => {
    const { version } = JSON.parse(await readFile("package.json", "utf8"));
    const guide = await readGuide();
    assert.match(guide, /^# Fortrip hotels\n/);
    assert.ok(guide.includes(`npx -y fortrip@${version} <command>`));
    assert.ok(guide.includes(`npx -y fortrip@${version} skill planning`));
    assert.doesNotMatch(guide, /fortrip@latest/);

    const { stdout } = await run(process.execPath, [
      "--import",
      "tsx",
      "src/cli.ts",
      "skill",
    ]);
    assert.equal(stdout, guide);
  });

  it("prints the planning guide", async () => {
    const guide = await readGuide("planning");
    assert.match(guide, /^# Planning a hotel stay\n/);
    assert.doesNotMatch(guide, /fortrip@latest/);

    const { stdout } = await run(process.execPath, [
      "--import",
      "tsx",
      "src/cli.ts",
      "skill",
      "planning",
    ]);
    assert.equal(stdout, guide);
  });

  it("rejects an unknown guide with exit 2", async () => {
    await assert.rejects(
      run(process.execPath, ["--import", "tsx", "src/cli.ts", "skill", "nope"]),
      (error: { code?: number }) => error.code === 2,
    );
  });

  it("--version reports package.json's version", async () => {
    const { version } = JSON.parse(await readFile("package.json", "utf8"));
    const { stdout } = await run(process.execPath, [
      "--import",
      "tsx",
      "src/cli.ts",
      "--version",
    ]);
    assert.equal(stdout, `${version}\n`);
  });

  it("SKILL.md loads the guide from the latest CLI", async () => {
    const skill = await readFile("skills/fortrip-hotels/SKILL.md", "utf8");
    assert.match(skill, /^---\nname: fortrip-hotels\n/);
    assert.match(skill, /npx -y fortrip@latest skill/);
  });
});
