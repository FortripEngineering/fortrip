/**
 * Refuses to deploy docs.fortrip.ai while the contract is a prerelease.
 * Production docs follow the contract that is live in production, and a
 * release candidate on the branch being deployed is not that: the docs would
 * describe an API that isn't live yet. A docs-only fix while `main` carries an
 * rc is tagged from a branch cut from the live `v*` tag, whose contract is a
 * stable X.Y.Z.
 *
 * Run directly, it checks packages/contract/package.json and exits 1 on
 * refusal.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function deployGuard(contractVersion: string): { ok: boolean; message?: string } {
  if (/^\d+\.\d+\.\d+$/.test(contractVersion)) return { ok: true };
  return {
    ok: false,
    message: `The contract is at "${contractVersion}", which isn't a stable X.Y.Z. Production docs follow the live server, so deploy from a commit whose contract is stable (for a fix while main carries an rc, a branch cut from the live v* tag).`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version } = JSON.parse(
    readFileSync(new URL("../packages/contract/package.json", import.meta.url), "utf8"),
  ) as { version: string };
  const result = deployGuard(version);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
}
