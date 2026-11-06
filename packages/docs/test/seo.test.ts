// Reads the output of `next build`, which the package's test script runs first.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  destination,
  CURRENCIES,
  DOCS_ORIGIN,
  FILTERABLE_AMENITIES,
  GLOBAL_FLAGS,
  LIMITS,
  MCP_SERVER_URL,
  ORDER_STATUSES,
  PAY_INPUT_WAYS,
  PAY_WAYS,
  PAYMENT_STATUSES,
  TOOLS,
} from "@fortrip/agent-contract";
import { ENABLED_REGIONS } from "@fortrip/agent-contract/regions";

import { fact } from "../components/fact.tsx";
import { OPERATIONS } from "../lib/openapi/build.ts";
import { MODEL_READS } from "../lib/markdown/pages.ts";
import { CLIENT_IDS, CLIENT_SETUP, MCP_REGISTRY } from "../lib/prose/clients.ts";
import { PRE_RELEASE_POLICY } from "../lib/prose/compatibility.ts";
import { MCP_CONTENT } from "../lib/prose/mcp-content.ts";
import { ORDER_STATUS_DOCS, PAYMENT_STATUS_DOCS } from "../lib/prose/order-statuses.ts";
import { PAY_WAY_DOCS } from "../lib/prose/pay-ways.ts";
import { ENDPOINTS } from "../lib/reference/api-docs.ts";
import { CLI_COMMANDS, RAW_BODY_EXAMPLE } from "../lib/reference/cli-commands.ts";
import { ERROR_ROWS } from "../lib/reference/error-docs.ts";
import { TOOL_INPUTS } from "../lib/reference/input-docs.ts";
import { limitRows, rateLimitRows } from "../lib/reference/limits.ts";
import { MCP_TOOLS } from "../lib/reference/mcp-tools.ts";
import { RESPONSE_DOCS, responseDoc, responseDocFor } from "../lib/reference/response-docs.ts";
import { inputRows } from "../lib/reference/schema-rows.ts";
import { pageHtml, pageMarkdown, pageRoutes, routeBody, withoutCode, withoutFences } from "./built-page.ts";

const routes = pageRoutes();
const absolute = (route: string) => new URL(route, DOCS_ORIGIN).href;
/** A URL without its trailing slash: Next writes the root as the bare origin. */
const bare = (url: string | undefined) => url?.replace(/\/$/, "");
const markdownUrl = (route: string) => `${DOCS_ORIGIN}${route === "/" ? "/index" : route}.md`;
const examples = new URL("../examples/", import.meta.url).pathname;
const docs = new URL("../content/docs/", import.meta.url).pathname;

/** An attribute's text, as React escapes it. */
const unescape = (text: string) =>
  text
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

/** "`a`, `b` and `c`" (or `last`), as the pages write a list of names. */
const codeList = (names: string[], last = "and") =>
  names.map((name) => `\`${name}\``).reduce((list, name, i) => `${list}${i === names.length - 1 ? ` ${last} ` : ", "}${name}`);

/** `assert.ok(text.includes(part))` for each part, naming the misses. */
function includesAll(text: string, parts: readonly string[], where: string) {
  assert.deepEqual(
    parts.filter((part) => !text.includes(part)),
    [],
    `${where} is missing these`,
  );
}

describe("llms.txt", () => {
  const text = routeBody("/llms.txt");

  it("opens with a title and a one-paragraph summary", () => {
    assert.match(text, /^# \S.*\n\n> \S[^\n]*\n/);
  });

  it("links every page's Markdown on the docs origin, and the OpenAPI document", () => {
    assert.ok(routes.length > 20, routes.join(", "));
    includesAll(text, [...routes.map((route) => `(${markdownUrl(route)})`), `(${DOCS_ORIGIN}/openapi.json)`], "llms.txt");
    // Nothing relative is left.
    assert.doesNotMatch(text, /\]\(\//);
  });

  it("groups the pages like the sidebar", () => {
    const meta = JSON.parse(readFileSync(new URL("../content/docs/meta.json", import.meta.url), "utf8")) as {
      pages: string[];
    };
    const sections = meta.pages.flatMap((entry) => /^---(.+)---$/.exec(entry)?.[1] ?? []);
    assert.ok(sections.length > 0);
    includesAll(text, sections.map((name) => `\n## ${name}\n`), "llms.txt");
  });
});

describe("Markdown pages", () => {
  it("every page has one, titled, with no JSX left outside code", () => {
    const bad: string[] = [];
    for (const route of routes) {
      const markdown = pageMarkdown(route);
      if (!markdown.startsWith("# ")) bad.push(`${route}: no title`);
      const tag = /<[A-Z][^>]*>?/.exec(withoutCode(markdown));
      if (tag) bad.push(`${route}: ${tag[0]}`);
    }
    assert.deepEqual(bad, []);
  });

  it("an MDX page's Markdown has no MDX expression left outside code", () => {
    // Braces in an MDX page are expressions; the generated pages quote
    // contract text, which may hold braces as text.
    const mdx = readdirSync(docs, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".mdx"));
    assert.ok(mdx.length > 10);
    const bad: string[] = [];
    for (const file of mdx) {
      const route = `/${file.replace(/(^|\/)index\.mdx$|\.mdx$/, "")}`.replace(/(.)\/$/, "$1");
      const brace = /.{0,40}[{}].{0,40}/.exec(withoutCode(pageMarkdown(route)));
      if (brace) bad.push(`${route}: ${brace[0]}`);
    }
    assert.deepEqual(bad, []);
  });

  it("llms-full.txt holds every page's Markdown in the order llms.txt lists them, and no JSX", () => {
    const full = routeBody("/llms-full.txt");
    const listed = [...routeBody("/llms.txt").matchAll(/\]\(([^)]+)\.md\)/g)].map((m) =>
      (m[1] as string).slice(DOCS_ORIGIN.length).replace(/^\/index$/, "/"),
    );
    assert.deepEqual(new Set(listed), new Set(routes));
    assert.equal(listed[0], "/");
    // /regions keeps its prose and links its Markdown for the list.
    const regionsList = `The list: [Enabled regions](${DOCS_ORIGIN}/regions.md).`;
    const pages = listed.map((route) => {
      const markdown = pageMarkdown(route);
      if (route !== "/regions") return markdown;
      const start = markdown.indexOf("regions in ");
      const at = markdown.lastIndexOf("\n\n", start) + 2;
      return `${markdown.slice(0, at)}${regionsList}\n`;
    });
    assert.equal(full, pages.join("\n\n"));
    assert.doesNotMatch(withoutCode(full), /<[A-Z]/);
  });

  it("leaves the region list out of llms-full.txt, and lists /regions in llms.txt by its URL only", () => {
    const full = routeBody("/llms-full.txt");
    const regions = pageMarkdown("/regions");
    for (const region of ENABLED_REGIONS.slice(0, 20)) {
      assert.ok(regions.includes(`\`${region.placeId}\``), region.placeId);
      assert.ok(!full.includes(region.placeId), region.placeId);
    }
    assert.ok(full.includes("# Enabled regions"));
    const line = routeBody("/llms.txt").split("\n").find((l) => l.includes(`(${DOCS_ORIGIN}/regions.md)`));
    assert.match(line ?? "", /^- \[Enabled regions\]\(https:\/\/[^)]+\/regions\.md\)$/);
  });

  it("has no heading anchors and no relative links outside code", () => {
    const bad: string[] = [];
    for (const route of routes) {
      const text = withoutCode(pageMarkdown(route));
      const anchor = /^#{1,6} .*\[#[^\]]*\][ \t]*$/m.exec(text);
      if (anchor) bad.push(`${route}: ${anchor[0]}`);
      const relative = /\]\((?!https?:\/\/|mailto:)[^)]*\)/.exec(text);
      if (relative) bad.push(`${route}: ${relative[0]}`);
    }
    assert.deepEqual(bad, []);
    // llms-full.txt is these pages joined, so it has neither either.
    assert.doesNotMatch(withoutCode(routeBody("/llms-full.txt")), /\[#[\w-]+\]$|\]\(\/|\]\(#/m);
  });

  it("links a page on the docs origin to its Markdown, keeping a #section", () => {
    assert.ok(pageMarkdown("/").includes(`](${DOCS_ORIGIN}/install.md#remote-mcp)`));
    assert.ok(pageMarkdown("/api").includes(`(${DOCS_ORIGIN}/changelog.md)`));
    // A link to a section of the same page names the page.
    assert.ok(pageMarkdown("/install").includes(`](${DOCS_ORIGIN}/install.md#local-mcp)`));
  });

  it("writes generated tables unpadded", () => {
    const padded: string[] = [];
    for (const route of routes) {
      for (const line of withoutFences(pageMarkdown(route)).split("\n")) {
        if (line.startsWith("|") && / {3}/.test(line)) padded.push(`${route}: ${line.slice(0, 60)}`);
      }
    }
    assert.deepEqual(padded, []);
  });

  it("/payments.md: facts resolved; the ways to pay and both status tables", () => {
    const markdown = pageMarkdown("/payments");
    assert.ok(!markdown.includes("<Fact"));
    assert.ok(markdown.includes(fact("ROUTES.get_hotel_offers")));
    for (const way of PAY_WAYS) {
      includesAll(markdown, [PAY_WAY_DOCS[way].title, PAY_WAY_DOCS[way].when, PAY_WAY_DOCS[way].charge], way);
    }
    includesAll(markdown, [...ORDER_STATUSES, ...PAYMENT_STATUSES].map((status) => `| \`${status}\``), "status tables");
    includesAll(markdown, ORDER_STATUSES.map((status) => ORDER_STATUS_DOCS[status]), "order statuses");
    includesAll(markdown, PAYMENT_STATUSES.map((status) => PAYMENT_STATUS_DOCS[status]), "payment statuses");
  });

  it("/api.md: every endpoint, the pay inputs and the pre-release policy", () => {
    const markdown = pageMarkdown("/api");
    includesAll(markdown, ENDPOINTS.map((e) => `\`${e.method} ${e.path}\``), "endpoint table");
    assert.ok(markdown.includes(`exactly one of ${codeList(Object.keys(PAY_INPUT_WAYS), "or")}, for the way it pays.`), "pay inputs");
    assert.ok(markdown.includes(`[changelog](${DOCS_ORIGIN}/changelog.md)`));
    assert.ok(markdown.includes("Pre-release: breaking changes ship as a new major version"));
    assert.ok(pageMarkdown("/changelog").includes(PRE_RELEASE_POLICY.split(". ")[0]!));
  });

  it("/install.md: every client's setup and the remote server", () => {
    const markdown = pageMarkdown("/install");
    for (const id of CLIENT_IDS) {
      const client = CLIENT_SETUP[id];
      includesAll(markdown, [client.name, ...client.steps, ...(client.code ? [client.code.text] : [])], id);
    }
    includesAll(markdown, [`\`${MCP_SERVER_URL}\``, `\`${MCP_REGISTRY.name}\``], "remote server");
  });

  it("/mcp.md, /cli.md: the tool and command lists, content blocks, flags and the raw body", () => {
    const mcp = pageMarkdown("/mcp");
    includesAll(mcp, MCP_TOOLS.map((tool) => `[\`${tool.name}\`](${DOCS_ORIGIN}/mcp/${tool.slug}.md)`), "tool list");
    // The tools whose content is more than the compact text, by the block they add.
    for (const [block, phrase] of [
      ["presentation_hint", "the presentation hint"],
      ["wechat_code", "WeChat Pay code first"],
      ["guide", "planning guide as Markdown"],
    ] as const) {
      const tools = MCP_TOOLS.filter((tool) => MCP_CONTENT[tool.name].includes(block)).map((tool) => tool.name);
      assert.ok(tools.length > 0, block);
      const line = mcp.split("\n").find((l) => l.includes(phrase)) ?? "";
      includesAll(line, tools.map((tool) => `\`${tool}\``), block);
    }
    const nextStep = TOOLS.filter((tool) => responseDocFor(tool.name)?.mcpNextStep).map((tool) => tool.name);
    assert.ok(nextStep.length > 0);
    assert.ok(mcp.includes(`An answer of ${codeList(nextStep)} that holds`), "nextStep tools");
    const cli = pageMarkdown("/cli");
    includesAll(cli, CLI_COMMANDS.map((c) => `[\`${c.invocation}\`](${DOCS_ORIGIN}/cli/${c.slug}.md)`), "command list");
    includesAll(cli, GLOBAL_FLAGS.map((flag) => `--${flag.flag}`), "global flags");
    assert.ok(cli.includes(JSON.stringify(RAW_BODY_EXAMPLE)));
  });

  it("/errors.md: every error code, rate limit scope and limit", () => {
    const markdown = pageMarkdown("/errors");
    includesAll(markdown, ERROR_ROWS.map((row) => `| \`${row.code}\``), "error codes");
    includesAll(markdown, rateLimitRows().map((row) => `\`${row.scope}\``), "rate limits");
    includesAll(markdown, limitRows(LIMITS).map(([name]) => name), "limits");
  });

  it("/regions.md, /search.md: regions, destination kinds and amenities", () => {
    includesAll(pageMarkdown("/regions"), ENABLED_REGIONS.map((r) => `\`${r.placeId}\``), "regions");
    const search = pageMarkdown("/search");
    // Each kind with what it is for; every field is on the reference page.
    includesAll(search, destination.options.map((o) => `| \`${o.shape.kind.value}\` | ${o.shape.kind.description}`), "destination kinds");
    assert.ok(search.includes(`(${DOCS_ORIGIN}/api/reference/search_hotels.md#request-body)`), "destination fields");
    includesAll(search, FILTERABLE_AMENITIES.map((code) => `\`${code}\``), "amenities");
  });

  it("/schemas.md: every response object and its fields", () => {
    const markdown = pageMarkdown("/schemas");
    for (const doc of RESPONSE_DOCS) {
      if (doc.sameAs) {
        // One line pointing at the object it is, not its fields again.
        includesAll(markdown, [doc.title, `The answer is the [${responseDoc(doc.sameAs).title}](${DOCS_ORIGIN}/schemas.md#${doc.sameAs}).`], doc.id);
      } else if (doc.listOf) {
        includesAll(markdown, [doc.title, `\`data\` ([${responseDoc(doc.listOf).title}](${DOCS_ORIGIN}/schemas.md#${doc.listOf})[])`, "`nextCursor`"], doc.id);
      } else {
        includesAll(markdown, [doc.title, ...doc.rows.map((row) => `\`${row.path}\``)], doc.id);
      }
    }
  });

  it("/api-quickstart.md: each example in fenced code, in every language", () => {
    const markdown = pageMarkdown("/api-quickstart");
    for (const [dir, ext] of [
      ["curl", "sh"],
      ["ts", "ts"],
      ["py", "py"],
    ] as const) {
      const name = "search";
      const code = readFileSync(join(examples, dir, `${name}.${ext}`), "utf8").trimEnd();
      assert.ok(markdown.includes(`\n${code}\n\`\`\``), `${dir}/${name}.${ext}`);
    }
  });

  it("/index.md: the ways to pay and the ways to connect; /api.md: the currencies", () => {
    const markdown = pageMarkdown("/");
    includesAll(markdown, PAY_WAYS.map((way) => PAY_WAY_DOCS[way].short), "pay ways");
    assert.ok(markdown.includes(`](${DOCS_ORIGIN}/install.md#remote-mcp)`));
    includesAll(pageMarkdown("/api"), CURRENCIES.filter((c) => c !== "USD"), "currencies");
  });

  it("a tool page has its input fields; a command page its usage", () => {
    for (const tool of MCP_TOOLS) {
      if (tool.name === "get_planning_guide") continue;
      const rows = inputRows(TOOL_INPUTS[tool.name]);
      includesAll(pageMarkdown(`/mcp/${tool.slug}`), [`# ${tool.title}`, ...rows.map((r) => `\`${r.path}\``)], tool.slug);
    }
    for (const command of CLI_COMMANDS) {
      includesAll(pageMarkdown(`/cli/${command.slug}`), [`# ${command.title}`, command.usage], command.slug);
    }
  });

  it("an API reference page has its method and path, its short description, the tool description under its label, and says where each field goes", () => {
    for (const op of OPERATIONS) {
      const markdown = pageMarkdown(`/api/reference/${op.id}`);
      assert.ok(markdown.includes(`\`${op.route.method} ${op.route.path}\``), op.id);
      assert.equal(markdown.split("\n")[2], `> ${op.summary}`, op.id);
      const tool = MCP_TOOLS.find((t) => t.name === op.endpoint.tool);
      if (tool) {
        // The description the model reads, verbatim, quoted under its label; it opens with the summary.
        assert.ok(markdown.includes(`**${MODEL_READS}**`), `${op.id}: no label`);
        assert.ok(markdown.replace(/^> ?/gm, "").includes(tool.summary), `${op.id}: no full description`);
        // Outside the quoted description, the summary is in the header only.
        const unquoted = markdown.split("\n").filter((line, i) => i === 2 || !line.startsWith(">")).join("\n");
        assert.equal(unquoted.split(op.summary).length, 2, `${op.id}: description repeated`);
      } else {
        assert.equal(markdown.split(op.summary).length, 2, `${op.id}: description repeated`);
        assert.ok(!markdown.includes(MODEL_READS), op.id);
        assert.doesNotMatch(markdown, /\/mcp\//, op.id);
      }
      assert.doesNotMatch(markdown, /\. the JSON body/, op.id);
    }
    assert.match(pageMarkdown("/api/reference/book_hotel"), /The JSON body holds every field\./);
    assert.match(pageMarkdown("/api/reference/pay_order"), /Path: `orderId`; the JSON body holds the rest\./);
  });
});

describe("sitemap and robots", () => {
  it("the sitemap lists every page, on the docs origin", () => {
    const xml = routeBody("/sitemap.xml");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.deepEqual(new Set(locs), new Set(routes.map(absolute)));
    includesAll(xml, [...MCP_TOOLS.map((t) => `/mcp/${t.slug}<`), ...CLI_COMMANDS.map((c) => `/cli/${c.slug}<`)], "sitemap");
  });

  it("robots allows everything and points to the sitemap", () => {
    const robots = routeBody("/robots.txt");
    assert.match(robots, /^User-Agent: \*$/m);
    assert.match(robots, /^Allow: \/$/m);
    assert.ok(robots.includes(`Sitemap: ${DOCS_ORIGIN}/sitemap.xml`));
  });
});

describe("page metadata", () => {
  it("every page has a short description: at most 200 characters, in the meta and Open Graph tags", () => {
    const long: string[] = [];
    for (const route of routes) {
      const html = pageHtml(route);
      const meta = /<meta name="description" content="([^"]*)"/.exec(html)?.[1];
      const og = /<meta property="og:description" content="([^"]*)"/.exec(html)?.[1];
      if (!meta) long.push(`${route}: no description`);
      else if (unescape(meta).length > 200) long.push(`${route}: ${unescape(meta).length}`);
      if (og !== meta) long.push(`${route}: og:description differs`);
    }
    assert.deepEqual(long, []);
  });

  it("llms.txt summarises each page in at most 200 characters", () => {
    const lines = routeBody("/llms.txt").split("\n").filter((line) => /^\s*- \[/.test(line));
    assert.ok(lines.length >= routes.length);
    for (const line of lines) {
      const summary = /\]\([^)]+\)(?:: (.*))?$/.exec(line)?.[1] ?? "";
      assert.ok(summary.length <= 200, line.slice(0, 80));
    }
  });

  it("every page has a canonical URL on the docs origin and Open Graph tags", () => {
    const bad: string[] = [];
    for (const route of routes) {
      const html = pageHtml(route);
      const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
      if (bare(canonical) !== bare(absolute(route))) bad.push(`${route}: canonical ${canonical}`);
      for (const property of ["og:title", "og:type"]) {
        if (!html.includes(`property="${property}"`)) bad.push(`${route}: no ${property}`);
      }
      const ogUrl = /<meta property="og:url" content="([^"]+)"/.exec(html)?.[1];
      if (bare(ogUrl) !== bare(absolute(route))) bad.push(`${route}: og:url ${ogUrl}`);
    }
    assert.deepEqual(bad, []);
  });
});
