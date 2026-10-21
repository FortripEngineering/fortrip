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
    assert.match(guide, /^# Fortrip\n/);
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

  it("the main guide states the booking contract", async () => {
    // Line breaks fall anywhere in Markdown prose.
    const guide = (await readGuide()).replace(/\s+/g, " ");
    for (const phrase of [
      // Errors by reason.
      "`already_booked`",
      "`price_or_terms_changed`",
      "`rate_unavailable`",
      "`supplier_unavailable`",
      "`refused`",
      // Meal codes and quantity.
      "RO room only, BB breakfast, HB breakfast + dinner, FB breakfast + lunch + dinner, BL lunch, BD dinner, HBBL breakfast + lunch, HBLD lunch + dinner, AI all inclusive",
      "`boardCount`",
      // Occupancy and consent.
      "**per room**",
      "`--rooms 2 --adults 2`",
      "give `paymentUrl` exactly as returned",
      "`stay`",
      "Never ask for, accept or pass on payment card details",
      "`--nationality` isn't sent with the booking",
      "safe to rerun with identical flags",
      "`nationality`) is rejected",
      // Errors and sign-in edge cases.
      "`maxMatches`",
      "`requestedNights`",
      "any other 409 is `rate_unavailable`",
      'Exit 3 with `tokenSource: "FORTRIP_TOKEN"`',
      "unused for 90 days",
      // Sign-in and support.
      "Never ask the user to paste a token",
      "info@fortrip.ai",
    ]) {
      assert.ok(guide.includes(phrase), phrase);
    }
  });

  it("the planning guide asks for confirmation of the terms book returned", async () => {
    const guide = (await readGuide("planning")).replace(/\s+/g, " ");
    assert.ok(guide.includes("confirms the terms that `book` returned"));
    assert.ok(guide.includes("`--adults` and `--child-age` are per room"));
  });

  it("no guide or help text names the supplier", async () => {
    const texts = [await readGuide(), await readGuide("planning")];
    for (const args of [["--help"], ["rates", "--help"], ["book", "--help"]]) {
      texts.push((await run(process.execPath, ["--import", "tsx", "src/cli.ts", ...args])).stdout);
    }
    for (const text of texts) assert.doesNotMatch(text, /huizhi/i);
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
});
