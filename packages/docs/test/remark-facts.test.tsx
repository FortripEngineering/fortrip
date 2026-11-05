import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluate } from "@mdx-js/mdx";
import { remarkStructure } from "fumadocs-core/mdx-plugins/remark-structure";
import { createElement } from "react";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

import { remarkFacts } from "../lib/remark-facts.ts";

/**
 * Compiles MDX as the site does (the plugin, then Fumadocs' search structure)
 * and renders it, with no `Fact` component to fall back on.
 */
async function compile(source: string) {
  const { default: Content, structuredData } = await evaluate(source, {
    ...runtime,
    remarkPlugins: [remarkFacts, [remarkStructure, { exportAs: "structuredData" }]],
  });
  const search = (structuredData as { contents: { content: string }[] }).contents.map((c) => c.content);
  return { html: renderToStaticMarkup(createElement(Content)), search };
}

async function render(source: string): Promise<string> {
  return (await compile(source)).html;
}

describe("remarkFacts", () => {
  it("replaces an inline <Fact> with the contract's value", async () => {
    assert.equal(
      await render('Up to <Fact path="LIMITS.radiusMetersMax" /> metres.'),
      "<p>Up to 80,000 metres.</p>",
    );
  });

  it("replaces a <Fact> on its own line with a paragraph of the value", async () => {
    assert.equal(await render('<Fact path="MCP_SERVER_URL" />'), "<p>https://mcp.fortrip.ai/</p>");
  });

  it("puts the value, not the tag, in the search index", async () => {
    const { search } = await compile(
      'Connect to <Fact path="MCP_SERVER_URL" /> for up to <Fact path="LIMITS.rooms" /> rooms.\n\n<Fact path="LIMITS.radiusMetersMax" />',
    );
    assert.deepEqual(search, ["Connect to https://mcp.fortrip.ai/ for up to 8 rooms.", "80,000"]);
  });

  it("fails compilation on an unknown path", async () => {
    await assert.rejects(render('<Fact path="LIMITS.nope" />'), /Unknown fact: LIMITS\.nope/);
  });

  it("fails compilation on a path that isn't a string literal", async () => {
    await assert.rejects(render('<Fact path={"LIMITS.rooms"} />'), /string literal/);
    await assert.rejects(render("<Fact />"), /string literal/);
  });
});
