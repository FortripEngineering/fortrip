// Reads the output of `next build`, which the package's test script runs first.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { DOCS_ORIGIN, REPOSITORY_URL } from "@fortrip/agent-contract";

import { pageHtml, pageMarkdown, pageRoutes } from "./built-page.ts";

const repository = new URL("../../../", import.meta.url).pathname;
const docs = new URL("../content/docs/", import.meta.url).pathname;

/** The routes of the written pages: `cli/index.mdx` is `/cli`. */
const written = readdirSync(docs, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".mdx"))
  .map((file) => `/${file.replace(/(^|\/)index\.mdx$|\.mdx$/, "")}`.replace(/(.)\/$/, "$1"));

/** What a page hands its Open menu, from the page's React payload: the menu's
 *  links are rendered when a reader opens it. */
function menuProps(route: string) {
  const payload = pageHtml(route).replaceAll('\\"', '"');
  const props = /\{"markdownUrl":"([^"]*)","githubUrl":"([^"]*)","pageUrl":"([^"]*)"\}/.exec(payload);
  assert.ok(props, `${route}: no Open menu`);
  const [, markdownUrl, githubUrl, pageUrl] = props;
  return { markdownUrl, githubUrl: githubUrl === "$undefined" ? undefined : githubUrl, pageUrl };
}

describe("page actions", () => {
  const routes = pageRoutes();

  it("every page has the Copy Markdown button and the Open menu between its description and its body", () => {
    assert.ok(routes.length > 20);
    const bad: string[] = [];
    for (const route of routes) {
      const html = pageHtml(route);
      const start = html.indexOf('<article id="nd-page"');
      const article = html.slice(start, html.indexOf("</article>", start));
      const actions = /<\/h1><p\b[^>]*>[\s\S]*?<\/p><div\b[^>]*>(<button\b[\s\S]*?<\/button>)(<button\b[\s\S]*?<\/button>)<\/div>/.exec(article);
      if (!actions?.[1]?.endsWith(">Copy Markdown</button>")) bad.push(`${route}: no Copy Markdown button`);
      if (!actions?.[2]?.includes('aria-haspopup="dialog"') || !/>Open<svg\b/.test(actions[2])) bad.push(`${route}: no Open menu`);
    }
    assert.deepEqual(bad, []);
  });

  it("copies and opens the page's own Markdown, and asks an assistant to read it on the docs origin", () => {
    for (const route of routes) {
      const { markdownUrl, pageUrl } = menuProps(route);
      const path = `${route === "/" ? "/index" : route}.md`;
      assert.equal(markdownUrl, path);
      assert.equal(pageUrl, `${DOCS_ORIGIN}${path}`);
      // The copy button fetches the same path, which is built.
      assert.ok(pageHtml(route).includes(`{\\"markdownUrl\\":\\"${path}\\"}`), `${route}: the copy button`);
      assert.ok(pageMarkdown(route).startsWith("# "), `${route}: no Markdown`);
    }
  });

  it("links a written page's source file in the repository; a generated page has no GitHub link", () => {
    assert.ok(written.length > 10);
    const linked = routes.filter((route) => menuProps(route).githubUrl !== undefined);
    assert.deepEqual(new Set(linked), new Set(written));
    const prefix = `${REPOSITORY_URL}/blob/main/`;
    for (const route of linked) {
      const url = menuProps(route).githubUrl ?? "";
      assert.ok(url.startsWith(`${prefix}packages/docs/content/docs/`), url);
      assert.ok(existsSync(join(repository, url.slice(prefix.length))), `${route}: ${url} is not a file`);
    }
  });
});
