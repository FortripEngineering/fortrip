import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { changelogVersions, checkChangelog } from "./changelog-gate.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("the changelog against the contract's version", () => {
  it("reads the version headings, with or without an anchor, and nothing else", () => {
    const mdx = "Intro 4.9.0\n\n## 4.3.0\n\nText\n\n### 4.2.9\n\n## 4.2.0 [#v4-2-0]\n\n## Notes\n";
    assert.deepEqual(changelogVersions(mdx), ["4.3.0", "4.2.0"]);
  });

  it("passes when the version has an entry", () => {
    assert.deepEqual(checkChangelog("4.3.0", "## 4.3.0\n\n- Something new.\n"), { ok: true });
  });

  it("passes an rc on the entry of the version it leads to", () => {
    assert.deepEqual(checkChangelog("4.3.0-rc.1", "## 4.3.0\n"), { ok: true });
  });

  it("fails a version without an entry, and names it", () => {
    const result = checkChangelog("4.4.0", "## 4.3.0\n");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /4\.4\.0/);
  });

  it("passes the contract's current version against the real changelog", () => {
    const { version } = JSON.parse(read("packages/contract/package.json")) as { version: string };
    assert.deepEqual(checkChangelog(version, read("packages/docs/content/docs/changelog.mdx")), { ok: true });
  });
});
