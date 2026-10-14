import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import { readGuide } from "../src/guide.ts";

const run = promisify(execFile);

describe("skill", () => {
  it("prints AGENT_GUIDE.md as-is", async () => {
    const guide = await readGuide();
    assert.match(guide, /^# Fortrip hotels\n/);
    assert.match(guide, /npx -y fortrip@latest <command>/);

    const { stdout } = await run(process.execPath, [
      "--import",
      "tsx",
      "src/cli.ts",
      "skill",
    ]);
    assert.equal(stdout, guide);
  });

  it("SKILL.md loads the guide from the latest CLI", async () => {
    const skill = await readFile("skills/fortrip-hotels/SKILL.md", "utf8");
    assert.match(skill, /^---\nname: fortrip-hotels\n/);
    assert.match(skill, /npx -y fortrip@latest skill/);
  });
});
