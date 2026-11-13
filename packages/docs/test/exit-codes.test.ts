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
  assert.equal(fact("CLI_EXIT.unauthenticated"), String(EXIT.unauthenticated));
  const text = pageText("/errors");
  for (const row of EXIT_ROWS) assert.ok(text.includes(`${row.code} ${row.meaning.split("`")[0]}`), String(row.code));
  assert.ok(text.includes(`${Object.entries(EXIT_BY_STATUS).map(([s, e]) => `${s} → ${e}`).join(", ")}`));
  assert.ok(pageText("/install").includes(`exits with code ${EXIT.unauthenticated}`));
});

// What each row promises is what the CLI prints: text mode says when to retry in words, and
// only --json carries the field by its name.
test("the rate-limited row describes text mode and --json each as it is", () => {
  const row = meaningOf(EXIT.rateLimited);
  assert.match(row, /`Retryable: retry after 7 s\.` as text, `retryAfterSeconds` in the error with `--json`/);
  assert.doesNotMatch(row, /stderr includes `retryAfterSeconds`/);
});

test("the invalid-arguments row says how a local refusal names an issue, and that orders cancel with no mode is one", () => {
  const row = meaningOf(EXIT.usage);
  assert.match(row, /each issue names the flag it was typed as \(`--total is required`\), or its JSON Pointer when the value came from `--body`/);
  assert.match(row, /`orders cancel` without `--max-penalty` or `--close` is one of these\./);
  // The command's own page says what happens instead, and when a flag does not fit the order.
  const cancel = pageText("/cli/orders-cancel");
  assert.match(cancel, /Give exactly one of --max-penalty and --close\. With neither, the command is refused with exit 2: nothing is read and nothing is sent\./);
  assert.match(cancel, /is not sent: the command answers as the service does, order_not_cancellable with the order's Cancel line, and exits 1\./);
});
