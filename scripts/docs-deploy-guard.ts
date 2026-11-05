/**
 * Refuses to deploy docs.fortrip.ai unless the tree being deployed describes
 * the contract that is live. Production docs follow the live server, so the
 * deployed commit must have:
 *
 * - a stable contract version (`X.Y.Z`): a release candidate describes an API
 *   that isn't live yet;
 * - `packages/contract/src` exactly as at that version's `v<version>` tag: a
 *   contract that moved on after the release (new exports, changed values)
 *   isn't the one the server runs. The checkout needs the tags;
 * - no changelog entry still "Not released yet.": the docs would announce a
 *   release that hasn't happened.
 *
 * A docs-only fix is tagged from a branch cut from the live `v*` tag, which
 * meets all three.
 *
 * Run directly, it checks this repository and exits 1 on refusal.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = "packages/contract/src";
const CHANGELOG = "packages/docs/content/docs/changelog.mdx";

export interface DeployState {
  /** The contract's version, from packages/contract/package.json. */
  version: string;
  /** The changelog's MDX. */
  changelog: string;
  /** Whether packages/contract/src is as at `tag`; `null` when there is no such tag. */
  srcUnchangedSince: (tag: string) => boolean | null;
}

export function deployGuard(state: DeployState): { ok: true } | { ok: false; message: string } {
  const reasons: string[] = [];
  if (!/^\d+\.\d+\.\d+$/.test(state.version)) {
    reasons.push(
      `The contract is at "${state.version}", which isn't a stable X.Y.Z. Production docs follow the live server, so deploy from a commit whose contract is stable (for a fix while main carries an rc, a branch cut from the live v* tag).`,
    );
  } else {
    const tag = `v${state.version}`;
    const unchanged = state.srcUnchangedSince(tag);
    if (unchanged === null) {
      reasons.push(`There is no tag ${tag} in this checkout to compare ${SRC} with. Fetch the tags (checkout with fetch-depth: 0).`);
    } else if (!unchanged) {
      reasons.push(
        `${SRC} changed since ${tag}, so this tree's contract isn't the released one. Deploy from a branch cut from the live v* tag.`,
      );
    }
  }
  if (state.changelog.split("\n").some((line) => line.trim() === "Not released yet.")) {
    reasons.push(`${CHANGELOG} has an entry marked "Not released yet.", so this tree describes an unreleased contract.`);
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, message: reasons.join("\n") };
}

/** Whether `packages/contract/src` at HEAD of the repository at `root` is the
 *  tree it was at `tag`; `null` when the tag isn't there. */
export function contractSrcUnchangedSince(tag: string, root: string): boolean | null {
  const tree = (rev: string) => {
    const run = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${rev}:${SRC}`], { cwd: root, encoding: "utf8" });
    return run.status === 0 ? run.stdout.trim() : null;
  };
  const tagged = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], { cwd: root });
  if (tagged.status !== 0) return null;
  const before = tree(`refs/tags/${tag}`);
  return before !== null && before === tree("HEAD");
}

/** The guard's verdict on the repository at `root`. */
export function checkTree(root: string): ReturnType<typeof deployGuard> {
  const { version } = JSON.parse(readFileSync(join(root, "packages/contract/package.json"), "utf8")) as {
    version: string;
  };
  return deployGuard({
    version,
    changelog: readFileSync(join(root, CHANGELOG), "utf8"),
    srcUnchangedSince: (tag) => contractSrcUnchangedSince(tag, root),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkTree(fileURLToPath(new URL("..", import.meta.url)));
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
}
