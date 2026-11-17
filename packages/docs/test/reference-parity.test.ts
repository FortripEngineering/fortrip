// Reads the output of `next build`, which the package's test script runs first.
// A command page, the MCP and CLI sections of an operation's page, and their
// `.md` are written by two renderers (components/reference.tsx and
// lib/markdown/pages.ts); this keeps them saying the same.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLI_COMMANDS } from "../lib/reference/cli-commands.ts";
import { MCP_TOOLS } from "../lib/reference/mcp-tools.ts";
import { pageHtml, pageMarkdown, pageText, withoutFences } from "./built-page.ts";

/** The commands with a page of their own. */
const routes = CLI_COMMANDS.filter((command) => !command.tool).map((command) => command.href);
/** The operations' pages: the HTTP part is Fumadocs OpenAPI's, the sections after it ours. */
const operations = MCP_TOOLS.map((tool) => `/api/reference/${tool.name}`);
const SURFACES = ["MCP tool", "CLI command"];

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

/** The prose lines of `markdown` that `text` doesn't show. */
function missingProse(route: string, markdown: string, text: string): string[] {
  const missing: string[] = [];
  for (const line of withoutFences(markdown).split("\n")) {
    if (!line.trim() || /^\s*([-*+]|\d+\.) /.test(line) || line.startsWith("|")) continue;
    const prose = shown(line);
    if (!text.includes(prose)) missing.push(`${route}: ${prose}`);
  }
  return missing;
}

describe("command pages and operation sections say what their Markdown says", () => {
  it("covers every tool and command", () => {
    assert.equal(routes.length + operations.length, CLI_COMMANDS.length);
    assert.equal(operations.length, MCP_TOOLS.length);
    assert.ok(routes.length > 2 && operations.length > 5);
  });

  it("ends an operation's page with its MCP tool and its CLI command, on the page and in its Markdown", () => {
    const missing: string[] = [];
    for (const route of operations) {
      const markdown = pageMarkdown(route);
      const headings = [...withoutFences(markdown).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
      assert.deepEqual(headings.slice(-2), SURFACES, route);
      assert.deepEqual(articleH2s(route).slice(-2), SURFACES, route);
      missing.push(...missingProse(route, markdown.slice(markdown.indexOf(`## ${SURFACES[0]}`)), pageText(route)));
    }
    assert.deepEqual(missing, []);
  });

  it("has the same sections", () => {
    for (const route of routes) {
      const headings = [...withoutFences(pageMarkdown(route)).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
      assert.ok(headings.length > 0, route);
      assert.deepEqual(headings, articleH2s(route), route);
    }
  });

  it("shows every prose line of the Markdown", () => {
    assert.deepEqual(
      routes.flatMap((route) => missingProse(route, pageMarkdown(route), pageText(route))),
      [],
    );
  });
});
