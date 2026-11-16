import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

/** What the packages, the skills and the plugins publish: every file under
 *  them that git tracks, or would (`pnpm validate` checks the whole tree,
 *  but needs the network; this runs with the tests). */
const PUBLISHED = /^(packages\/[^/]+\/src|skills|plugins)\//;

describe("no supplier names", () => {
  it("in the packages' sources, the skills or the plugins", { skip: NO_LIST }, () => {
    const files = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: repo, encoding: "utf8" },
    )
      .split("\0")
      .filter((file) => PUBLISHED.test(file) && existsSync(path.join(repo, file)));
    assert.ok(files.length > 30, `${files.length} files`);
    assert.deepEqual(
      files.filter((file) => (SUPPLIER as RegExp).test(readFileSync(path.join(repo, file), "utf8"))),
      [],
    );
  });
});
