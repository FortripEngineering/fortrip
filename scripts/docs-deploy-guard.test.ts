import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { checkTree, contractSrcUnchangedSince, deployGuard } from "./docs-deploy-guard.ts";

const DATED = "## 4.2.0\n\nReleased 2026-11-04.\n";
const UNDATED = "## 4.3.0\n\nNot released yet.\n\n## 4.2.0\n\nReleased 2026-11-04.\n";
const unchanged = () => true;

describe("the docs deploy guard", () => {
  it("lets a stable version through when its src matches its tag and the changelog is dated", () => {
    const seen: string[] = [];
    const result = deployGuard({
      version: "4.3.0",
      changelog: DATED,
      srcUnchangedSince: (tag) => (seen.push(tag), true),
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(seen, ["v4.3.0"]);
  });

  for (const version of ["4.3.0-rc.1", "4.3.0-beta", "4.3.0+x", ""]) {
    it(`refuses ${JSON.stringify(version)}, naming it`, () => {
      const result = deployGuard({ version, changelog: DATED, srcUnchangedSince: unchanged });
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.message.includes(`"${version}"`));
      assert.match(!result.ok ? result.message : "", /stable|X\.Y\.Z/);
    });
  }

  it("refuses a contract whose src changed since its version's tag", () => {
    const result = deployGuard({ version: "4.2.0", changelog: DATED, srcUnchangedSince: () => false });
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : "", /packages\/contract\/src changed since v4\.2\.0/);
  });

  it("refuses when the version's tag isn't in the checkout", () => {
    const result = deployGuard({ version: "4.2.0", changelog: DATED, srcUnchangedSince: () => null });
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : "", /no tag v4\.2\.0/);
  });

  it("refuses a changelog with an entry not released yet", () => {
    const result = deployGuard({ version: "4.2.0", changelog: UNDATED, srcUnchangedSince: unchanged });
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : "", /"Not released yet\."/);
  });

  it("names every reason it refuses for", () => {
    const result = deployGuard({ version: "4.2.0", changelog: UNDATED, srcUnchangedSince: () => false });
    assert.equal(result.ok, false);
    const message = !result.ok ? result.message : "";
    assert.match(message, /changed since v4\.2\.0/);
    assert.match(message, /Not released yet/);
  });
});

/** A throwaway repository shaped like this one: contract version, src and changelog. */
function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "docs-deploy-guard-"));
  const git = (...args: string[]) => {
    const run = spawnSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
  };
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write("packages/contract/package.json", JSON.stringify({ version: "4.2.0" }));
  write("packages/contract/src/limits.ts", "export const A = 1;\n");
  write("packages/docs/content/docs/changelog.mdx", DATED);
  git("init", "--quiet");
  git("add", ".");
  git("commit", "--quiet", "-m", "release");
  git("tag", "v4.2.0");
  return { root, git, write };
}

describe("the guard on a repository", () => {
  const roots: string[] = [];
  after(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });
  const repo = () => {
    const made = fixtureRepo();
    roots.push(made.root);
    return made;
  };

  it("passes at the release tag", () => {
    const { root } = repo();
    assert.equal(contractSrcUnchangedSince("v4.2.0", root), true);
    assert.deepEqual(checkTree(root), { ok: true });
  });

  it("passes a docs-only change after the tag", () => {
    const { root, git, write } = repo();
    write("packages/docs/content/docs/index.mdx", "A docs fix.\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "docs fix");
    assert.deepEqual(checkTree(root), { ok: true });
  });

  it("refuses main after the release moved on: src changed, and an entry not released yet", () => {
    const { root, git, write } = repo();
    write("packages/contract/src/limits.ts", "export const A = 2;\n");
    write("packages/docs/content/docs/changelog.mdx", UNDATED);
    git("add", ".");
    git("commit", "--quiet", "-m", "next release's work");
    assert.equal(contractSrcUnchangedSince("v4.2.0", root), false);
    const result = checkTree(root);
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : "", /changed since v4\.2\.0/);
    assert.match(!result.ok ? result.message : "", /Not released yet/);
  });

  it("refuses a new file in src", () => {
    const { root, git, write } = repo();
    write("packages/contract/src/routes.ts", "export const B = 1;\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "new export");
    assert.equal(contractSrcUnchangedSince("v4.2.0", root), false);
  });

  it("refuses when the tag isn't there (a checkout without tags)", () => {
    const { root, git } = repo();
    git("tag", "-d", "v4.2.0");
    assert.equal(contractSrcUnchangedSince("v4.2.0", root), null);
    assert.match(String((checkTree(root) as { message?: string }).message), /no tag v4\.2\.0/);
  });
});

describe("the guard run directly", () => {
  it("checks this checkout and exits by the verdict, printing each reason", () => {
    const script = fileURLToPath(new URL("./docs-deploy-guard.ts", import.meta.url));
    const run = spawnSync(process.execPath, ["--import", "tsx", script], { encoding: "utf8" });
    const verdict = checkTree(fileURLToPath(new URL("..", import.meta.url)));
    assert.equal(run.status, verdict.ok ? 0 : 1, run.stderr);
    if (!verdict.ok) assert.equal(run.stderr.trim(), verdict.message);
  });
});
