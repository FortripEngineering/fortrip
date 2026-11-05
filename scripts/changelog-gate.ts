/**
 * Fails when the contract's version has no changelog entry, so a release
 * can't ship without one. An rc (`4.3.0-rc.1`) needs the entry of the version
 * it leads to (`## 4.3.0`): the entry is written at rc time, undated ("Not
 * released yet."). A release needs that entry dated: a `Released YYYY-MM-DD.`
 * line, and no "Not released yet." left in it.
 *
 * Run directly, it checks packages/contract/package.json against
 * packages/docs/content/docs/changelog.mdx and exits 1 on failure.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** A `## <version>` heading; a Fumadocs anchor (`## 4.3.0 [#v4-3-0]`) may
 *  follow the version. */
const VERSION_HEADING = /^## (\d+\.\d+\.\d+)(?: \[#[^\]]+\])?[ \t]*$/;

/** The versions of the `## <version>` headings, in order. */
export function changelogVersions(mdx: string): string[] {
  return mdx.split("\n").flatMap((line) => VERSION_HEADING.exec(line)?.[1] ?? []);
}

/** The lines of `version`'s entry, up to the next `## ` heading. */
function entryLines(mdx: string, version: string): string[] {
  const lines = mdx.split("\n");
  const start = lines.findIndex((line) => VERSION_HEADING.exec(line)?.[1] === version);
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

export function checkChangelog(contractVersion: string, mdx: string): { ok: true } | { ok: false; message: string } {
  const version = contractVersion.replace(/-rc\.\d+$/, "");
  const file = "packages/docs/content/docs/changelog.mdx";
  if (!changelogVersions(mdx).includes(version)) {
    return {
      ok: false,
      message: `The contract is at ${contractVersion}, but ${file} has no "## ${version}" entry. Add one before releasing.`,
    };
  }
  if (version === contractVersion) {
    const lines = entryLines(mdx, version);
    const dated = lines.some((line) => /^Released \d{4}-\d{2}-\d{2}\.$/.test(line.trim()));
    if (!dated || lines.some((line) => line.includes("Not released yet."))) {
      return {
        ok: false,
        message: `The contract is at ${version}, but its entry in ${file} isn't dated. Replace "Not released yet." with "Released YYYY-MM-DD." before releasing.`,
      };
    }
  }
  return { ok: true };
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
