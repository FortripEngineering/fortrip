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
} from "@fortrip/agent-contract";

import { ADAPTIVE_PRICING } from "../lib/prose/guide-copy.ts";
import { pageText } from "./built-page.ts";

/*
 * The pages state some facts in prose. Each comes from the contract export
 * that owns it, through <Fact>; these fail when a page types a value itself.
 * (Ported from fortrip-ai `components/docs/prose-drift.test.ts`: the values
 * the server runs on are pinned by the contract's own tests now.)
 */

const docs = new URL("../content/docs/", import.meta.url).pathname;
const source = (page: string) => readFileSync(join(docs, page), "utf8");

/** Every MDX page, by its path under content/docs. */
const PAGES = readdirSync(docs, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".mdx"));

/** What a reader sees as prose: code (fenced and inline), JSX tags and
 *  <Fact> tags removed. */
function prose(mdx: string): string {
  return mdx
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<[^>]*>/g, " ");
}

/** The contract numbers prose may state, all from <Fact>. Below 10 they are
 *  too common in plain English to tell apart. */
const NUMBERS = new Set(
  [
    ...Object.values(LIMITS),
    ...Object.values(SEARCH_RULES),
    ...Object.values(ORDER_HTTP),
    ...Object.values(RATE_LIMITS).flatMap((r) => [r.limit, r.windowSeconds]),
  ].filter((v): v is number => typeof v === "number" && v >= 10),
);

test("no page types a contract number itself", () => {
  const typed: string[] = [];
  for (const page of PAGES) {
    for (const [match] of prose(source(page)).matchAll(/(?<![\w.$-])\d{1,3}(?:,\d{3})+(?![\w.])|(?<![\w.-])\d+(?![\w.])/g)) {
      if (NUMBERS.has(Number(match.replaceAll(",", "")))) typed.push(`${page}: ${match}`);
    }
  }
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

test("the CLI's FORTRIP_API_URL is a base URL, and FORTRIP_MCP_URL is documented with its pairing rule", () => {
  const cli = source("cli/index.mdx");
  assert.match(cli, /\| `FORTRIP_API_URL` \| The API's base URL/);
  assert.doesNotMatch(cli, /API origin/);
  assert.match(cli, /http:\/\/localhost:3000\/api\/public/);
  assert.match(cli, /\| `FORTRIP_MCP_URL` \|/);
  assert.match(cli, /on the origin of `FORTRIP_API_URL`/);
  assert.match(cli, /`api\.fortrip\.ai` and `mcp\.fortrip\.ai`/);
  const install = source("install.mdx");
  assert.match(install, /FORTRIP_MCP_URL/);
  assert.match(install, /FORTRIP_API_URL/);
});

test("the errors page: an unknown code exits by HTTP status; a wrong method is 405 with Allow", () => {
  const page = source("errors.mdx");
  assert.doesNotMatch(page, /including an error code the CLI doesn't know/);
  assert.match(page, /400 → 2, 401 → 3, 429 → 4/);
  assert.match(page, /`invalid_request` with HTTP 405 and an `Allow` header/);
});
