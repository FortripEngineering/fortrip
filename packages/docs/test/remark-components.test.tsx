import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluate } from "@mdx-js/mdx";
import { FILTERABLE_AMENITIES } from "@fortrip/agent-contract";
import { remarkHeading } from "fumadocs-core/mdx-plugins/remark-heading";
import { remarkLLMs } from "fumadocs-core/mdx-plugins/remark-llms";
import { remarkStructure } from "fumadocs-core/mdx-plugins/remark-structure";
import { createElement, type ReactNode } from "react";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

import { fact } from "../components/fact.tsx";
import { MCP_REGISTRY } from "../lib/prose/clients.ts";
import { ENDPOINTS } from "../lib/reference/api-docs.ts";
import { remarkComponents } from "../lib/remark-components.ts";
import { remarkFacts } from "../lib/remark-facts.ts";

const Box = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
/** The site's code block (Fumadocs' CodeBlock), which only Markdown code reaches. */
const CodeBlock = ({ children }: { children?: ReactNode }) => createElement("figure", null, children);

/**
 * Compiles MDX as the site does (heading ids, facts, components, then Fumadocs' search
 * structure and Markdown), and renders it with stand-ins for the components
 * a page keeps.
 */
async function compile(source: string) {
  const { default: Content, structuredData, _markdown } = await evaluate(source, {
    ...runtime,
    remarkPlugins: [remarkHeading, remarkFacts, remarkComponents, [remarkStructure, { exportAs: "structuredData" }], remarkLLMs],
  });
  const search = (structuredData as { contents: { content: string; heading?: string }[] }).contents;
  const html = renderToStaticMarkup(createElement(Content, { components: { Cards: Box, Card: Box, pre: CodeBlock } }));
  return { html, search, markdown: _markdown as string };
}

describe("remarkComponents", () => {
  it("expands a table component into a table the page, search and Markdown share", async () => {
    const { html, search, markdown } = await compile("## Endpoints [#endpoints]\n\n<EndpointTable />\n\nAfter.");
    for (const endpoint of ENDPOINTS) {
      const route = `${endpoint.method} ${endpoint.path}`;
      assert.ok(html.includes(`<code>${route}</code>`), route);
      assert.ok(markdown.includes(`\`${route}\``), route);
      assert.ok(
        search.some((c) => c.content.startsWith("|") && c.content.includes(route) && c.heading === "endpoints"),
        route,
      );
    }
    assert.match(html, /<table>/);
    assert.ok(!markdown.includes("<EndpointTable"));
    assert.ok(markdown.trimEnd().endsWith("After."));
  });

  it("expands an inline component inside its paragraph", async () => {
    const { html, search, markdown } = await compile("Codes: <FilterableAmenities />.");
    const codes = FILTERABLE_AMENITIES.map((code) => `\`${code}\``).join(", ");
    assert.equal(markdown.trim(), `Codes: ${codes}.`);
    assert.deepEqual(
      search.map((c) => c.content),
      [`Codes: ${codes}.`],
    );
    assert.ok(html.startsWith(`<p>Codes: <code>${FILTERABLE_AMENITIES[0]}</code>, `));
  });

  it("writes cards as a list of links, with their facts, and keeps them on the page", async () => {
    const { html, markdown } = await compile(
      '<Cards>\n  <Card title="Remote" href="/install#remote">\n    At <Fact path="MCP_SERVER_URL" />.\n  </Card>\n</Cards>',
    );
    assert.equal(markdown.trim(), `- [Remote](/install#remote): At ${fact("MCP_SERVER_URL")}.`);
    assert.match(html, /^<div><div>/);
  });

  it("indexes a link as its text and writes it as a Markdown link", async () => {
    const { search, markdown } = await compile("<RemoteMcpTable />");
    const listed = search.find((c) => c.content.includes("MCP Registry"));
    assert.ok(listed, JSON.stringify(search));
    assert.ok(!listed.content.includes("]("), listed.content);
    assert.ok(markdown.includes(`[MCP Registry](${MCP_REGISTRY.url})`));
  });

  it("writes <code> and <pre> as Markdown code", async () => {
    const { markdown } = await compile(
      'Call <code><Fact path="ROUTES.pay_order" /></code>.\n\n<pre><code><Fact path="MCP_SERVER_URL" /></code></pre>',
    );
    assert.equal(markdown.trim(), `Call \`${fact("ROUTES.pay_order")}\`.\n\n\`\`\`\n${fact("MCP_SERVER_URL")}\n\`\`\``);
  });

  it("renders a <pre> as the site's code block, so it scrolls and copies", async () => {
    const { html } = await compile('<pre><code><Fact path="MCP_SERVER_URL" /></code></pre>');
    assert.equal(html, `<figure><code>${fact("MCP_SERVER_URL")}\n</code></figure>`);
  });

  it("fails compilation on a component with no Markdown form", async () => {
    await assert.rejects(compile("<Mystery />"), /<Mystery> has no Markdown form/);
    await assert.rejects(compile('<Card title="A" href="/a">Alone</Card>'), /<Card> has no Markdown form/);
  });
});
