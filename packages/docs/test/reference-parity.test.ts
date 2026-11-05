// Reads the output of `next build`, which the package's test script runs first.
// A tool or command page and its `.md` are written by two renderers
// (components/reference.tsx and lib/markdown/pages.ts); this keeps them saying the same.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLI_COMMANDS } from "../lib/reference/cli-commands.ts";
import { MCP_TOOLS } from "../lib/reference/mcp-tools.ts";
import { pageHtml, pageMarkdown, pageText, withoutFences } from "./built-page.ts";

const routes = [...MCP_TOOLS.map((tool) => `/mcp/${tool.slug}`), ...CLI_COMMANDS.map((command) => `/cli/${command.slug}`)];

/** The text of the `<h2>`s in the page's article. */
function articleH2s(route: string): string[] {
  const html = pageHtml(route);
  const start = html.indexOf('<article id="nd-page"');
  const article = html.slice(start, html.indexOf("</article>", start));
  assert.ok(start >= 0 && article.length > 0, `${route}: no article`);
  return [...article.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((m) =>
    (m[1] as string)
      .replace(/<button\b[\s\S]*?<\/button>/g, "")
      .replace(/<[^>]+>/g, "")
      .replaceAll("&amp;", "&")
      .trim(),
  );
}

/** A Markdown line as the page shows it: no code ticks, links as their text, no bold. */
function shown(line: string): string {
  return line
    .replace(/^#+ /, "")
    .replace(/^> /, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll("`", "")
    .replaceAll("**", "")
    .replace(/\\([\\`*<|])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/ ([.,;:)])/g, "$1")
    .replace(/\( /g, "(")
    .trim();
}

describe("tool and command pages say what their Markdown says", () => {
  it("covers every tool and command", () => {
    assert.equal(routes.length, MCP_TOOLS.length + CLI_COMMANDS.length);
    assert.ok(routes.length > 10);
  });

  it("has the same sections", () => {
    for (const route of routes) {
      const headings = [...withoutFences(pageMarkdown(route)).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
      assert.ok(headings.length > 0, route);
      assert.deepEqual(headings, articleH2s(route), route);
    }
  });

  it("shows every prose line of the Markdown", () => {
    const missing: string[] = [];
    for (const route of routes) {
      const text = pageText(route);
      for (const line of withoutFences(pageMarkdown(route)).split("\n")) {
        if (!line.trim() || /^\s*([-*+]|\d+\.) /.test(line) || line.startsWith("|")) continue;
        const prose = shown(line);
        if (!text.includes(prose)) missing.push(`${route}: ${prose}`);
      }
    }
    assert.deepEqual(missing, []);
  });
});
