import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { COMMANDS, GLOBAL_FLAGS } from "@fortrip/agent-contract";

/*
 * The pages and the docs data write CLI invocations by hand (`npx fortrip
 * hotels search ...`). Nothing renders those from the contract, so a command
 * the contract renames would live on in the text. This reads that text and
 * fails on a `fortrip <word>` that names no command in `COMMANDS`, or a flag
 * the command doesn't take.
 */

const ROOT = new URL("../", import.meta.url).pathname;
const SCANNED = ["content", "lib", "components"];

/** `fortrip`, `npx fortrip`, `npx -y fortrip@latest`, then one or two words.
 *  Not `fortrip.ai`, `fortrip-cli`, `/fortrip` or `@fortrip/...`. */
const INVOCATION = /(?<![\w./@-])fortrip(?:@[\w.-]+)?[ ]+([a-z][a-z-]*)(?:[ ]+([a-z][a-z-]*))?/g;

/** Words that follow the product name in a sentence ("Run fortrip commands
 *  from a terminal") and are not a command. */
const PROSE = new Set(["commands"]);

const topLevel = new Set<string>(COMMANDS.filter((c) => c.group === null).map((c) => c.name));
const grouped = new Map<string, Set<string>>();
for (const { group, name } of COMMANDS) {
  if (group !== null) grouped.set(group, (grouped.get(group) ?? new Set()).add(name));
}

/** The invocations in `source` that the contract has no command for. A
 *  command typed after a group (`hotels`) must be one of that group's; what
 *  follows a top-level command is an argument. */
function unknownInvocations(source: string): string[] {
  const unknown: string[] = [];
  for (const [text, first = "", second] of source.matchAll(INVOCATION)) {
    if (PROSE.has(first) || topLevel.has(first)) continue;
    const names = grouped.get(first);
    if (names && (second === undefined || names.has(second))) continue;
    unknown.push(text.trim());
  }
  return unknown;
}

/** The flags a command takes, by `fortrip <group> <name>` or `fortrip <name>`;
 *  the CLI's own flags for every command and group. */
function flagsOf(first: string, second: string | undefined): Set<string> {
  const flags = new Set(GLOBAL_FLAGS.map((flag) => flag.flag));
  const spec = topLevel.has(first)
    ? COMMANDS.find((c) => c.group === null && c.name === first)
    : COMMANDS.find((c) => c.group === first && c.name === second);
  for (const flag of [...(spec?.flags ?? []), ...(spec?.options ?? [])]) flags.add(flag.flag);
  return flags;
}

/** `--flags` typed after a known invocation, up to the end of its line or the
 *  first quote, brace or tag that closes the example, that the command doesn't take. */
function unknownFlags(source: string): string[] {
  const unknown: string[] = [];
  for (const line of source.split("\n")) {
    for (const match of line.matchAll(INVOCATION)) {
      const [text, first = "", second] = match;
      if (PROSE.has(first)) continue;
      const rest = line.slice((match.index ?? 0) + text.length).split(/[`"'<{}|]/)[0] ?? "";
      const flags = flagsOf(first, topLevel.has(first) ? undefined : second);
      for (const [, flag = ""] of rest.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) {
        if (!flags.has(flag)) unknown.push(`${text.trim()} --${flag}`);
      }
    }
  }
  return unknown;
}

test("the flag check accepts a command's own flags and rejects the 2.0 ones", () => {
  assert.deepEqual(
    unknownFlags(
      [
        "npx fortrip hotels search --place-name Kyoto --country JP --check-in 2026-12-01 --currency CNY",
        "fortrip hotels offers --hotel htl_1 --room 2:6,9 --json",
        "fortrip login --no-browser",
        "fortrip orders pay ord_1 --method stripe_alipay_wechat_pay --total 125.00",
        "fortrip hotels --help",
      ].join("\n"),
    ),
    [],
  );
  assert.deepEqual(
    unknownFlags(
      ["fortrip hotels search --query Kyoto --display-currency CNY", "fortrip hotels offers --adults 2"].join("\n"),
    ),
    ["fortrip hotels search --query", "fortrip hotels search --display-currency", "fortrip hotels offers --adults"],
  );
});

test("the check accepts the contract's commands and rejects the 1.0 and 2.0 names", () => {
  assert.deepEqual(
    unknownInvocations(
      [
        "npx fortrip hotels search --query Kyoto",
        "npx -y fortrip@latest hotels offers --hotel htl_1",
        "`fortrip hotels get <hotelId>`",
        "fortrip hotels --help",
        "<code>fortrip login</code> and <code>fortrip guide planning</code>",
        "Run fortrip commands from a terminal",
        "FortripEngineering/fortrip --skill fortrip-cli, fortrip.ai, Fortrip search",
      ].join("\n"),
    ),
    [],
  );
  assert.deepEqual(
    unknownInvocations(
      [
        "fortrip search --query Kyoto",
        "npx fortrip rates",
        "<code>fortrip hotel 123</code>",
        "npx -y fortrip@2.0.0 book --hotel 1",
        "fortrip hotels hotel",
        "npx fortrip hotels rates --hotel 1",
        "fortrip flights search",
      ].join("\n"),
    ),
    [
      "fortrip search",
      "fortrip rates",
      "fortrip hotel",
      "fortrip@2.0.0 book",
      "fortrip hotels hotel",
      "fortrip hotels rates",
      "fortrip flights search",
    ],
  );
});

test("the pages and docs data name only commands and flags the contract has", () => {
  let found = 0;
  const unknown: string[] = [];
  for (const root of SCANNED) {
    const files = readdirSync(join(ROOT, root), { recursive: true, encoding: "utf8" }).filter((file) =>
      /\.(?:tsx?|mdx)$/.test(file),
    );
    assert.ok(files.length > 0, `${root} has no source files to scan`);
    for (const file of files) {
      if (file.endsWith("changelog.mdx")) continue; // history: it names flags that no longer exist
      const source = readFileSync(join(ROOT, root, file), "utf8");
      found += [...source.matchAll(INVOCATION)].length;
      for (const invocation of [...unknownInvocations(source), ...unknownFlags(source)]) {
        unknown.push(`${root}/${file}: ${invocation}`);
      }
    }
  }
  assert.ok(found > 0, "no CLI invocation found: is the scan reading the pages?");
  assert.deepEqual(unknown, []);
});
