// Reads the output of `next build`, which the package's test script runs first.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const app = new URL("../.next/server/app/", import.meta.url).pathname;
const publicDir = new URL("../public/", import.meta.url).pathname;

/**
 * Pages linked before they are written (the narrative pages of plan Task 8).
 * A test below fails once one of them is built, so the entry goes with it.
 */
const PENDING = new Set(["/quickstart", "/install", "/api", "/search"]);

/** Every built page by its route: `index.html` is `/`, `mcp/x.html` is `/mcp/x`. */
const pages = new Map(
  readdirSync(app, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".html") && !/(^|\/)_/.test(file))
    .map((file) => {
      const route = `/${file.replace(/\.html$/, "")}`.replace(/^\/index$/, "/");
      return [route, readFileSync(join(app, file), "utf8")] as const;
    }),
);

const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const decode = (text: string) => text.replaceAll("&amp;", "&");

describe("internal links", () => {
  it("found the built pages", () => {
    assert.ok(pages.has("/") && pages.size > 20, [...pages.keys()].join(", "));
  });

  it("every internal link goes to a built page, and to an element there when it has a #hash", () => {
    const broken: string[] = [];
    for (const [route, html] of pages) {
      for (const [, raw] of html.matchAll(/<a\s[^>]*?href="([^"]*)"/g)) {
        const href = decode(raw ?? "");
        if (!href.startsWith("/") && !href.startsWith("#")) continue; // external, mailto:
        if (href.startsWith("//")) continue;
        const url = new URL(href, `https://docs.test${route}`);
        const path = url.pathname.replace(/(.)\/$/, "$1");
        if (PENDING.has(path)) continue;
        const target = pages.get(path);
        if (!target) {
          if (!existsSync(join(publicDir, path))) broken.push(`${route} → ${href}`);
          continue;
        }
        const hash = decodeURIComponent(url.hash.slice(1));
        if (hash && !ids(target).has(hash)) broken.push(`${route} → ${href} (no #${hash})`);
      }
    }
    assert.deepEqual(broken, []);
  });

  it("lists as pending only pages that aren't built yet", () => {
    assert.deepEqual(
      [...PENDING].filter((path) => pages.has(path)),
      [],
      "remove these from PENDING",
    );
  });
});
