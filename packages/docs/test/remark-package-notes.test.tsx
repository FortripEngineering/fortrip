import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { evaluate } from "@mdx-js/mdx";
import { remarkStructure } from "fumadocs-core/mdx-plugins/remark-structure";
import { createElement } from "react";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

import { remarkPackageNotes } from "../lib/remark-package-notes.ts";
import { pageMarkdown, pageText } from "./built-page.ts";

async function compile(source: string) {
  const { default: Content, structuredData } = await evaluate(source, {
    ...runtime,
    remarkPlugins: [remarkPackageNotes, [remarkStructure, { exportAs: "structuredData" }]],
  });
  const search = (structuredData as { contents: { content: string }[] }).contents.map((c) => c.content);
  return { html: renderToStaticMarkup(createElement(Content)), search };
}

const ENTRY = `## 4.3.1

Not released yet.

### Changed

- Caller-visible.

### Package

- \`SOME_EXPORT\` is new.

More package text.

## 4.3.0

### Package

- Only package notes.

## 4.2.0

- Kept.
`;

describe("remarkPackageNotes", () => {
  it("drops each ### Package section up to the next heading, and keeps the rest", async () => {
    const { html, search } = await compile(ENTRY);
    assert.doesNotMatch(html, /Package|SOME_EXPORT|package text|package notes/);
    assert.match(html, /<h3>Changed<\/h3>/);
    assert.match(html, /Caller-visible/);
    assert.match(html, /<h2>4\.3\.0<\/h2>\s*<h2>4\.2\.0<\/h2>/);
    assert.match(html, /Kept/);
    assert.ok(!search.some((text) => /SOME_EXPORT|package/i.test(text)), search.join(" | "));
  });

  it("keeps a heading that only starts with Package", async () => {
    const { html } = await compile("### Packages and more\n\nText.\n");
    assert.match(html, /Packages and more/);
  });
});

describe("the changelog page", () => {
  const source = readFileSync(new URL("../content/docs/changelog.mdx", import.meta.url), "utf8");

  it("keeps the package notes in its source, and shows none on the page or in its Markdown", () => {
    assert.match(source, /^### Package$/m);
    assert.doesNotMatch(pageText("/changelog"), /\bPackage\b|renderToolResult|PAY_NEXT_STEP|strictErrorEnvelope|SEARCH_RULES/);
    assert.doesNotMatch(pageMarkdown("/changelog"), /### Package|renderToolResult|PAY_NEXT_STEP|strictErrorEnvelope|SEARCH_RULES/);
  });

  it("states no rename hints for old command names and no server version history", () => {
    assert.doesNotMatch(source, /rename hints|straight to 4\.0\.0/);
  });

  it("doesn't link to itself", () => {
    assert.doesNotMatch(pageMarkdown("/changelog"), /\]\(\/changelog\)/);
  });
});
