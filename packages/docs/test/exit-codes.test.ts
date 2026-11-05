import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { EXIT, EXIT_BY_CODE, EXIT_BY_STATUS } from "../../cli/src/exit-codes.ts";
import { fact } from "../components/fact.tsx";
import { EXIT_ROWS } from "../lib/reference/exit-codes.ts";
import { pageText } from "./built-page.ts";

const page = (path: string) => readFileSync(new URL(`../content/docs/${path}`, import.meta.url), "utf8");
const meaningOf = (exit: number) => EXIT_ROWS.find((row) => row.code === exit)?.meaning ?? "";

test("one row per CLI exit code, in the CLI's order", () => {
  assert.deepEqual(
    EXIT_ROWS.map((row) => row.code),
    Object.values(EXIT),
  );
  for (const row of EXIT_ROWS) assert.ok(row.meaning.length > 5, String(row.code));
});

test("each error code the CLI maps is named in its exit code's row", () => {
  for (const [code, exit] of Object.entries(EXIT_BY_CODE)) {
    assert.ok(meaningOf(exit ?? EXIT.error).includes(`\`${code}\``), code);
  }
});

test("the fallback by HTTP status is the CLI's own mapping", () => {
  const rule = [
    ...Object.entries(EXIT_BY_STATUS).map(([status, exit]) => `${status} → ${exit}`),
    `any other status ${EXIT.error}`,
  ].join(", ");
  assert.ok(meaningOf(EXIT.error).includes(`exits by its HTTP status: ${rule}.`), meaningOf(EXIT.error));
});

test("the errors page renders the table; the pages that name an exit code read it from the CLI", () => {
  const errors = page("errors.mdx");
  assert.ok(errors.includes("<ExitCodes />"));
  assert.doesNotMatch(errors, /\| `\d` \|/);
  assert.ok(page("install.mdx").includes('[code <Fact path="CLI_EXIT.unauthenticated" />](/errors#exit-codes)'));
  assert.ok(page("cli/index.mdx").includes('`fortrip mcp` exits <Fact path="CLI_EXIT.usage" />'));
  assert.equal(fact("CLI_EXIT.unauthenticated"), String(EXIT.unauthenticated));
  const text = pageText("/errors");
  for (const row of EXIT_ROWS) assert.ok(text.includes(`${row.code} ${row.meaning.split("`")[0]}`), String(row.code));
  assert.ok(text.includes(`${Object.entries(EXIT_BY_STATUS).map(([s, e]) => `${s} → ${e}`).join(", ")}`));
  assert.ok(pageText("/install").includes(`exits with code ${EXIT.unauthenticated}`));
  assert.ok(pageText("/cli").includes(`fortrip mcp exits ${EXIT.usage}`));
});
