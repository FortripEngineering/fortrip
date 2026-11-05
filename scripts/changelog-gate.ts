/**
 * Fails when the contract's version has no changelog entry, so a release
 * can't ship without one. An rc (`4.3.0-rc.1`) needs the entry of the version
 * it leads to (`## 4.3.0`): the entry is written at rc time.
 *
 * Run directly, it checks packages/contract/package.json against
 * packages/docs/content/docs/changelog.mdx and exits 1 on failure.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The versions of the `## <version>` headings, in order. A Fumadocs anchor
 *  (`## 4.3.0 [#v4-3-0]`) may follow the version. */
export function changelogVersions(mdx: string): string[] {
  return [...mdx.matchAll(/^## (\d+\.\d+\.\d+)(?: \[#[^\]]+\])?[ \t]*$/gm)].map((match) => match[1] as string);
}

export function checkChangelog(contractVersion: string, mdx: string): { ok: true } | { ok: false; message: string } {
  const version = contractVersion.replace(/-rc\.\d+$/, "");
  if (changelogVersions(mdx).includes(version)) return { ok: true };
  return {
    ok: false,
    message: `The contract is at ${contractVersion}, but packages/docs/content/docs/changelog.mdx has no "## ${version}" entry. Add one before releasing.`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const { version } = JSON.parse(read("packages/contract/package.json")) as { version: string };
  const result = checkChangelog(version, read("packages/docs/content/docs/changelog.mdx"));
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
}
