// Reads the output of `next build`, which the package's test script runs first.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { TOOLS } from "@fortrip/agent-contract";

import { fact } from "../components/fact.tsx";
import { MCP_TOOLS } from "../lib/reference/mcp-tools.ts";
import { pageHtml, pageRoutes, pageText } from "./built-page.ts";

const server = new URL("../.next/server/", import.meta.url).pathname;

describe("built site", () => {
  it("states the contract's values on the index page", () => {
    // React separates adjacent text with <!-- -->; the reader sees one run of text.
    const html = readFileSync(join(server, "app/index.html"), "utf8").replaceAll("<!-- -->", "");
    assert.ok(html.includes(`any MCP client with OAuth at ${fact("MCP_SERVER_URL")}.`));
    assert.ok(html.includes(`live offers for up to ${fact("LIMITS.offersHotels")} hotels`));
    assert.ok(html.includes(`up to ${fact("LIMITS.rooms")} rooms`));
  });

  it("leaves no <Fact> tag in any output, search data included", () => {
    const files = readdirSync(server, { recursive: true, encoding: "utf8" }).filter(
      // `app/openapi.json` is a route's folder.
      (f) => /\.(js|html|rsc|json|body)$/.test(f) && statSync(join(server, f)).isFile(),
    );
    assert.ok(files.length > 0);
    const leaks = files.filter((f) => readFileSync(join(server, f), "utf8").includes("<Fact"));
    assert.deepEqual(leaks, []);
  });

  it("renders every code block in an article as the site's code block: scrolling, padded, with a copy button", () => {
    const routes = pageRoutes();
    assert.ok(routes.length > 20);
    const bad: string[] = [];
    for (const route of routes) {
      const html = pageHtml(route);
      const start = html.indexOf('<article id="nd-page"');
      const article = html.slice(start, html.indexOf("</article>", start));
      assert.ok(start >= 0 && article.length > 0, `${route}: no article`);
      for (const pre of article.matchAll(/<pre\b[\s\S]*?<\/pre>/g)) {
        // Inside a Fumadocs CodeBlock: an open <figure class="… shiki …">.
        const figure = article.lastIndexOf("<figure", pre.index);
        const open = figure >= 0 && !article.slice(figure, pre.index).includes("</figure>");
        const classes = /^<figure\b[^>]*\bclass="([^"]*)"/.exec(article.slice(figure))?.[1] ?? "";
        if (!open || !classes.split(" ").includes("shiki")) bad.push(`${route}: not in a code block figure`);
        // Highlighted: <code> holding <span class="line">s, which carry the padding.
        if (!/<code\b[^>]*>[\s\S]*<span class="line"/.test(pre[0])) {
          bad.push(`${route}: no <code> with lines: ${pre[0].replace(/<[^>]+>/g, "").slice(0, 40)}`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  it("top-aligns table cells, site-wide", () => {
    const css = readdirSync(join(server, "../static"), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".css"))
      .map((f) => readFileSync(join(server, "../static", f), "utf8"))
      .join("\n");
    assert.ok(css.length > 0);
    assert.match(css, /:where\(table\) :is\(td,\s*th\)\{vertical-align:top\}/);
  });

  it("shows the previous and next pages by direction and title only, never their description", () => {
    const routes = pageRoutes();
    const cards: string[] = [];
    for (const route of routes) {
      const html = pageHtml(route).replaceAll("<!-- -->", "");
      for (const card of html.matchAll(/<a\b[^>]*class="flex flex-col gap-2 rounded-lg border[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
        const muted = /<p class="text-fd-muted-foreground">([\s\S]*?)<\/p>/.exec(card[1] as string)?.[1];
        if (muted !== "Previous Page" && muted !== "Next Page") cards.push(`${route}: ${muted}`);
      }
    }
    assert.deepEqual(cards, []);
    // On /quickstart, the next card is Installation's: its title, not its description.
    const quickstart = pageHtml("/quickstart");
    const next = /<a\b[^>]*class="flex flex-col gap-2 rounded-lg border[^"]*text-end"[^>]*href="\/install">([\s\S]*?)<\/a>/.exec(quickstart)?.[1] ?? "";
    const install = readFileSync(join(server, "app/install.html"), "utf8");
    const title = /<h1[^>]*>([^<]+)<\/h1>/.exec(install)?.[1] ?? "";
    const description = /<meta name="description" content="([^"]+)"/.exec(install)?.[1] ?? "";
    assert.ok(title && description);
    assert.ok(next.includes(`<p>${title}</p>`), next);
    assert.ok(next.includes("Next Page"));
    assert.ok(!next.includes(description));
  });

  it("an API reference page shows the short summary, then the tool description the model reads under its label", () => {
    const tool = MCP_TOOLS.find((t) => t.name === "book_hotel");
    const full = TOOLS.find((t) => t.name === "book_hotel")?.description;
    assert.ok(tool && full && full !== tool.snippet);
    const text = pageText("/api/reference/book_hotel");
    assert.ok(text.includes(tool.snippet));
    assert.ok(text.includes("What the model reads (tool description)"));
    // Past the summary, the contract's text is shown too, as the model reads it.
    const rest = full.slice(tool.snippet.length).trim();
    assert.ok(rest.length > 0);
    assert.ok(text.includes(rest.slice(0, 60).replaceAll("`", "")), "the full description is not shown");
    assert.doesNotMatch(pageHtml("/api/reference/book_hotel"), /full rules agents follow/);
  });
});
