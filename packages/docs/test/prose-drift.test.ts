import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  LIMITS,
  ME_SCOPES,
  ORDER_HTTP,
  RATE_LIMITS,
  renderGuide,
  SEARCH_RULES,
  SUPPLIER_OUTCOME_STATUS,
} from "@fortrip/agent-contract";

import { ENVIRONMENT } from "../../cli/src/environment.ts";
import { PRE_RELEASE_POLICY, PRE_RELEASE_POLICY_ON_CHANGELOG } from "../lib/prose/compatibility.ts";
import { ADAPTIVE_PRICING } from "../lib/prose/guide-copy.ts";
import { ENVIRONMENT_ROWS } from "../lib/reference/environment.ts";
import { pageHtml, pageText } from "./built-page.ts";

/*
 * The pages state some facts in prose. Each comes from the contract export
 * that owns it, through <Fact>; these fail when a page types a value itself.
 * (The values the server runs on are pinned by the contract's own tests.)
 */

const docs = new URL("../content/docs/", import.meta.url).pathname;
const source = (page: string) => readFileSync(join(docs, page), "utf8");

/** Every MDX page, by its path under content/docs. The changelog is left
 *  out: its entries state the values each release had, and rendering the
 *  current value through <Fact> would rewrite that history. */
const PAGES = readdirSync(docs, { recursive: true, encoding: "utf8" }).filter(
  (f) => f.endsWith(".mdx") && f !== "changelog.mdx",
);

/** What a reader sees as prose: code (fenced and inline), JSX tags and
 *  <Fact> tags removed. */
function prose(mdx: string): string {
  return mdx
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<[^>]*>/g, " ");
}

/** The contract numbers prose may state, all from <Fact> or the export.
 *  Below 10 they are too common in plain English to tell apart. */
const NUMBERS = new Set(
  [
    ...Object.values(LIMITS),
    ...Object.values(SEARCH_RULES),
    ...Object.values(ORDER_HTTP),
    ...Object.values(RATE_LIMITS).flatMap((r) => [r.limit, r.windowSeconds]),
    ...Object.values(SUPPLIER_OUTCOME_STATUS),
  ].filter((v): v is number => typeof v === "number" && v >= 10),
);

/** The TypeScript files that hold prose, under lib/. */
const lib = new URL("../lib/", import.meta.url).pathname;
const PROSE_TS = [
  ...readdirSync(join(lib, "prose")).map((f) => `prose/${f}`),
  "reference/error-docs.ts",
  "reference/exit-codes.ts",
  // The copy of expanded components, generated pages' Markdown and llms.txt.
  "markdown/components.ts",
  "markdown/pages.ts",
  "markdown/widgets.ts",
  "llms.ts",
  "site.ts",
];

/** What a TypeScript file says: comments and interpolations removed, so a
 *  value interpolated from the contract never counts as typed. */
function tsProse(ts: string): string {
  return ts
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\$\{[^}]*\}/g, " ");
}

/**
 * Typed numbers that state a fact no public export owns (reported to the
 * owner), or equal a contract value by coincidence. Each phrase must still
 * be in its file, so a stale entry fails too.
 */
const UNOWNED: Array<[file: string, phrase: string]> = [];

/** The contract numbers `text` (of `file`) types itself. */
function typedNumbers(file: string, text: string): string[] {
  let rest = text;
  for (const [owner, phrase] of UNOWNED) {
    if (owner !== file) continue;
    assert.ok(rest.includes(phrase), `${file}: "${phrase}" is gone; drop its UNOWNED entry`);
    rest = rest.replaceAll(phrase, " ");
  }
  const typed: string[] = [];
  for (const [match] of rest.matchAll(/(?<![\w.$-])\d{1,3}(?:,\d{3})+(?![\w.])|(?<![\w.-])\d+(?![\w.])/g)) {
    if (NUMBERS.has(Number(match.replaceAll(",", "")))) typed.push(`${file}: ${match}`);
  }
  return typed;
}

test("no page or prose module types a contract number itself", () => {
  assert.ok(PROSE_TS.length >= 4, PROSE_TS.join(", "));
  const typed = [
    ...PAGES.flatMap((page) => typedNumbers(page, prose(source(page)))),
    ...PROSE_TS.flatMap((file) => typedNumbers(file, tsProse(readFileSync(join(lib, file), "utf8")))),
  ];
  assert.deepEqual(typed, []);
});

test("the search page states every name rule from SEARCH_RULES", () => {
  const page = source("search.mdx");
  for (const key of Object.keys(SEARCH_RULES)) {
    assert.ok(page.includes(`<Fact path="SEARCH_RULES.${key}" />`), key);
  }
  assert.doesNotMatch(prose(page), /50,000|\b5 km\b|100 times|up to 3 places/);
});

test("the API page states the order statuses, the replay header and the /me scopes from the contract", () => {
  const page = source("api/index.mdx");
  for (const key of Object.keys(ORDER_HTTP)) {
    assert.ok(page.includes(`<Fact path="ORDER_HTTP.${key}" />`), key);
  }
  for (const key of Object.keys(ME_SCOPES)) {
    assert.ok(page.includes(`<Fact path="ME_SCOPES.${key}" />`), key);
  }
  assert.doesNotMatch(prose(page), /\b20[01]\b|Idempotent-Replayed/);
  const text = pageText("/api");
  assert.ok(text.includes(`answers ${ORDER_HTTP.createdStatus} with an order`));
  assert.ok(text.includes(`${ORDER_HTTP.replayedHeader}: true`));
  assert.ok(text.includes(`the ${ME_SCOPES.email} scope`));
});

test("the local-currency sentence is the guide's, on both pages that say USD", () => {
  assert.ok(renderGuide("mcp", "main").includes(ADAPTIVE_PRICING));
  assert.match(ADAPTIVE_PRICING, /local currency at Stripe's rate\.$/);
  for (const [page, route] of [
    ["index.mdx", "/"],
    ["api/index.mdx", "/api"],
  ] as const) {
    assert.ok(source(page).includes('<Fact path="GUIDE_SENTENCES.adaptivePricing" />'), page);
    assert.ok(pageText(route).includes(ADAPTIVE_PRICING), route);
  }
});

test("the pre-release policy has one source, rendered on the API page and the changelog", () => {
  const plain = (policy: string) => policy.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replaceAll("`", "");
  assert.match(plain(PRE_RELEASE_POLICY), /^Fortrip's agent API is pre-release\. Until general availability/);
  assert.ok(source("api/index.mdx").includes("<PreReleasePolicy />"));
  assert.ok(pageText("/api").includes(plain(PRE_RELEASE_POLICY)));
  assert.match(pageHtml("/api"), /href="\/changelog">changelog<\/a>/);
  // The changelog states it without a link to itself.
  assert.notEqual(PRE_RELEASE_POLICY_ON_CHANGELOG, PRE_RELEASE_POLICY);
  assert.ok(source("changelog.mdx").includes('<PreReleasePolicy page="changelog" />'));
  assert.ok(pageText("/changelog").includes(plain(PRE_RELEASE_POLICY_ON_CHANGELOG)));
  assert.doesNotMatch(pageHtml("/changelog"), /href="\/changelog"[^>]*>changelog<\/a>/);
  for (const page of [...PAGES, "changelog.mdx"]) {
    assert.doesNotMatch(source(page), /Until general availability/, page);
  }
});

test("the CLI's environment table lists what a reader sets, and leaves out the variables only Fortrip's development uses", () => {
  const internal = ENVIRONMENT.filter((variable) => variable.internal).map((variable) => variable.name);
  assert.deepEqual(internal, ["FORTRIP_API_URL", "FORTRIP_MCP_URL"]);
  assert.deepEqual(
    ENVIRONMENT_ROWS.map((row) => row.name),
    ENVIRONMENT.filter((variable) => !variable.internal).map((variable) => variable.name),
  );
  assert.ok(source("cli/index.mdx").includes("<EnvironmentTable />"));
  const cli = pageText("/cli");
  for (const row of ENVIRONMENT_ROWS) assert.ok(cli.includes(row.name), row.name);
  for (const page of ["/cli", "/install"]) {
    for (const name of internal) assert.ok(!pageText(page).includes(name), `${page}: ${name}`);
    assert.doesNotMatch(pageText(page), /localhost|credentials\.json/, page);
  }
});

test("no page calls a remote agent environment a sandbox", () => {
  for (const page of PAGES) assert.doesNotMatch(source(page), /\bsandbox/i, page);
  assert.doesNotMatch(ENVIRONMENT_ROWS.map((row) => row.meaning).join(" "), /\bsandbox/i);
  assert.match(pageText("/cli"), /a remote agent environment or a CI run/);
});

test("the errors page: an unknown code exits by HTTP status; a wrong method is 405 with Allow", () => {
  const page = source("errors.mdx");
  assert.doesNotMatch(page, /including an error code the CLI doesn't know/);
  assert.ok(page.includes("<ExitCodes />"));
  assert.match(pageText("/errors"), /An error code the CLI doesn't know exits by its HTTP status: 400 → 2, 401 → 3, 429 → 4, any other status 1\./);
  assert.match(page, /`invalid_request` with HTTP 405 and an `Allow` header/);
});
