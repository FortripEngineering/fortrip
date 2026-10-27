import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The supplier's name, assembled so this file doesn't carry it. */
const SUPPLIER = new RegExp(["hui" + "zhi", "汇" + "智"].join("|"), "i");

/** What the packages, the skills and the plugins publish: every file under
 *  them that git tracks, or would (`pnpm validate` checks the whole tree,
 *  but needs the network; this runs with the tests). */
const PUBLISHED = /^(packages\/[^/]+\/src|skills|plugins)\//;

describe("no supplier names", () => {
  it("in the packages' sources, the skills or the plugins", () => {
    const files = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: repo, encoding: "utf8" },
    )
      .split("\0")
      .filter((file) => PUBLISHED.test(file) && existsSync(path.join(repo, file)));
    assert.ok(files.length > 30, `${files.length} files`);
    assert.deepEqual(
      files.filter((file) => SUPPLIER.test(readFileSync(path.join(repo, file), "utf8"))),
      [],
    );
  });
});
