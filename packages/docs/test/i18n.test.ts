// Reads the output of `next build`, which the package's test script runs first.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it } from "node:test";

import { DOCS_ORIGIN, REPOSITORY_URL } from "@fortrip/agent-contract";

import { FUMADOCS_ZH, i18n, localize, localizeHref, UI } from "../lib/i18n.ts";
import { mdxRoute, pageHtml, pageMarkdown, pageRoutes, pageText } from "./built-page.ts";

/** A route on the docs origin, as Next writes it in a link: the root has no
 *  trailing slash. */
const abs = (route: string) => `${DOCS_ORIGIN}${route === "/" ? "" : route}`;

const docs = new URL("../content/docs/", import.meta.url).pathname;
const translated = readdirSync(docs, { recursive: true, encoding: "utf8" })
  .filter((f) => /\.zh\.mdx$/.test(f))
  .map(mdxRoute);
const english = pageRoutes();
const untranslated = english.map((route) => localize("zh", route)).filter((route) => !translated.includes(route));

describe("localized links", () => {
  it("localizes a page and keeps its anchor, but not a file, another site or an anchor alone", () => {
    assert.equal(localizeHref("zh", "/payments#flow"), "/zh/payments#flow");
    assert.equal(localizeHref("zh", "/"), "/zh");
    assert.equal(localizeHref("zh", "/cli/mcp"), "/zh/cli/mcp");
    assert.equal(localizeHref("zh", "/openapi.json"), "/openapi.json");
    assert.equal(localizeHref("zh", "https://fortrip.ai"), "https://fortrip.ai");
    assert.equal(localizeHref("zh", "#flow"), "#flow");
    assert.equal(localizeHref("en", "/payments"), "/payments");
  });

  it("translates every string Fumadocs' UI has", () => {
    const keys = Object.keys(FUMADOCS_ZH);
    assert.ok(keys.length > 50 && keys.includes("On this page(table of contents)"));
    assert.ok(Object.values(FUMADOCS_ZH).every((value) => value.length > 0));
  });

  it("has every word of the site in every language", () => {
    for (const lang of i18n.languages) assert.deepEqual(Object.keys(UI[lang]).sort(), Object.keys(UI.en).sort(), lang);
  });
});

describe("built Chinese site", () => {
  it("builds every page under /zh, translated or not", () => {
    assert.ok(translated.length > 0);
    assert.deepEqual(pageRoutes("zh").sort(), english.map((route) => localize("zh", route)).sort());
  });

  it("serves a translation in Chinese: its language, its words, its links to Chinese pages", () => {
    for (const route of translated) {
      const html = pageHtml(route);
      assert.match(html, /<html lang="zh-CN"/, route);
      assert.ok(html.includes(`<link rel="canonical" href="${abs(route)}"/>`), route);
      assert.ok(!pageText(route).includes(UI.zh.untranslated), route);
      for (const [, href] of html.slice(html.indexOf('<article id="nd-page"')).matchAll(/<a\s[^>]*?href="(\/[^"#]*)/g)) {
        if (href && !/\.\w+$/.test(href)) assert.ok(href === "/zh" || href.startsWith("/zh/"), `${route} → ${href}`);
      }
    }
    const quickstart = pageText("/zh/quickstart");
    for (const words of ["快速开始", "本页目录", "复制 Markdown", "服务条款"]) assert.ok(quickstart.includes(words), words);
  });

  it("serves a page with no translation in English, says so, and names the English page canonical", () => {
    assert.ok(untranslated.length > 0);
    for (const route of untranslated) {
      const english = route.replace(/^\/zh(?=\/|$)/, "") || "/";
      assert.ok(pageText(route).includes(UI.zh.untranslated), route);
      assert.ok(pageHtml(route).includes(`<link rel="canonical" href="${abs(english)}"/>`), route);
    }
  });

  it("links each translation and its English page to each other", () => {
    for (const route of translated) {
      const english = route.replace(/^\/zh(?=\/|$)/, "") || "/";
      for (const html of [pageHtml(route), pageHtml(english)]) {
        assert.ok(html.includes(`hrefLang="zh-CN" href="${abs(route)}"`), route);
        assert.ok(html.includes(`hrefLang="en" href="${abs(english)}"`), route);
      }
    }
  });

  it("marks the page being read in the sidebar, in English as in Chinese", () => {
    for (const route of ["/quickstart", "/zh/quickstart", "/reference/me", "/zh/reference/me"]) {
      assert.match(pageHtml(route), new RegExp(`data-active="true"[^>]*href="${route}"`), route);
    }
  });

  it("serves each translation's Markdown, in Chinese, linking to the Chinese pages", () => {
    for (const route of translated) {
      const markdown = pageMarkdown(route);
      assert.match(markdown.split("\n")[0] ?? "", /^# .*\p{Script=Han}/u, route);
      for (const [, link] of markdown.matchAll(/\]\((https:\/\/docs\.fortrip\.ai\/[^)#]*\.md)/g)) {
        assert.ok(link?.startsWith(`${DOCS_ORIGIN}/zh/`), `${route} → ${link}`);
      }
    }
  });

  it("puts GitHub, the language and the theme above the table of contents, not in the sidebar", () => {
    for (const route of ["/quickstart", "/zh/quickstart"]) {
      const html = pageHtml(route);
      const toc = html.slice(html.indexOf('id="nd-toc"'));
      const sidebar = html.slice(html.indexOf('id="nd-sidebar"'), html.indexOf('id="nd-page"'));
      assert.ok(toc.indexOf('aria-label="Choose a language"') !== -1 || toc.indexOf('aria-label="选择语言"') !== -1, route);
      assert.ok(!/aria-label="(Choose a language|选择语言)"/.test(sidebar), route);
      assert.ok(toc.includes(`href="${REPOSITORY_URL}"`) && toc.includes('aria-label="GitHub"'), `${route}: GitHub`);
    }
  });
});
