// Reads the output of `next build`, which the package's test script runs first.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  DISPLAY_CURRENCIES,
  DOCS_ORIGIN,
  FILTERABLE_AMENITIES,
  GLOBAL_FLAGS,
  LIMITS,
  MCP_SERVER_URL,
  ORDER_STATUSES,
  PAY_INPUT_WAYS,
  PAY_WAYS,
  PAYMENT_STATUSES,
} from "@fortrip/agent-contract";
import { ENABLED_REGIONS } from "@fortrip/agent-contract/regions";

import { fact } from "../components/fact.tsx";
import { OPERATIONS } from "../lib/openapi/build.ts";
import { CLIENT_IDS, CLIENT_SETUP, MCP_REGISTRY } from "../lib/prose/clients.ts";
import { PRE_RELEASE_POLICY } from "../lib/prose/compatibility.ts";
import { contentSentence } from "../lib/prose/mcp-content.ts";
import { ORDER_STATUS_DOCS } from "../lib/prose/order-statuses.ts";
import { PAY_WAY_DOCS } from "../lib/prose/pay-ways.ts";
import { ENDPOINTS } from "../lib/reference/api-docs.ts";
import { CLI_COMMANDS, RAW_BODY_EXAMPLE } from "../lib/reference/cli-commands.ts";
import { ERROR_ROWS } from "../lib/reference/error-docs.ts";
import { TOOL_INPUTS } from "../lib/reference/input-docs.ts";
import { limitRows, rateLimitRows } from "../lib/reference/limits.ts";
import { MCP_TOOLS } from "../lib/reference/mcp-tools.ts";
import { RESPONSE_DOCS } from "../lib/reference/response-docs.ts";
import { inputRows } from "../lib/reference/schema-rows.ts";
import { pageHtml, pageMarkdown, pageRoutes, routeBody, withoutCode } from "./built-page.ts";

const routes = pageRoutes();
const absolute = (route: string) => new URL(route, DOCS_ORIGIN).href;
/** A URL without its trailing slash: Next writes the root as the bare origin. */
const bare = (url: string | undefined) => url?.replace(/\/$/, "");
const markdownUrl = (route: string) => `${DOCS_ORIGIN}${route === "/" ? "/index" : route}.md`;
const examples = new URL("../examples/", import.meta.url).pathname;
const docs = new URL("../content/docs/", import.meta.url).pathname;

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

  it("llms-full.txt holds every page's Markdown, and no JSX", () => {
    const full = routeBody("/llms-full.txt");
    includesAll(full, routes.map(pageMarkdown), "llms-full.txt");
    assert.doesNotMatch(withoutCode(full), /<[A-Z]/);
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
  });

  it("/api.md: every endpoint, the pay inputs and the pre-release policy", () => {
    const markdown = pageMarkdown("/api");
    includesAll(markdown, ENDPOINTS.map((e) => `\`${e.method} ${e.path}\``), "endpoint table");
    includesAll(markdown, Object.keys(PAY_INPUT_WAYS).map((input) => `\`${input}\``), "pay inputs");
    assert.ok(markdown.includes("[changelog](/changelog)"));
    assert.ok(markdown.includes(PRE_RELEASE_POLICY.split(". ")[0]!));
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
    includesAll(mcp, MCP_TOOLS.map((tool) => `[\`${tool.name}\`](/mcp/${tool.slug})`), "tool list");
    includesAll(mcp, MCP_TOOLS.map((tool) => contentSentence(tool.name)), "content table");
    const cli = pageMarkdown("/cli");
    includesAll(cli, CLI_COMMANDS.map((c) => `[\`${c.invocation}\`](/cli/${c.slug})`), "command list");
    includesAll(cli, GLOBAL_FLAGS.map((flag) => `--${flag.flag}`), "global flags");
    assert.ok(cli.includes(JSON.stringify(RAW_BODY_EXAMPLE)));
  });

  it("/errors.md: every error code, rate limit scope and limit", () => {
    const markdown = pageMarkdown("/errors");
    includesAll(markdown, ERROR_ROWS.map((row) => `| \`${row.code}\``), "error codes");
    includesAll(markdown, rateLimitRows().map((row) => `\`${row.scope}\``), "rate limits");
    includesAll(markdown, limitRows(LIMITS).map(([name]) => name), "limits");
  });

  it("/regions.md, /search.md: regions, destination fields and amenities", () => {
    includesAll(pageMarkdown("/regions"), ENABLED_REGIONS.map((r) => `\`${r.placeId}\``), "regions");
    const search = pageMarkdown("/search");
    const destination = inputRows(TOOL_INPUTS.search_hotels).filter((row) => /^destination\b/.test(row.path));
    assert.ok(destination.length > 0);
    includesAll(search, destination.map((row) => `\`${row.path}\``), "destination fields");
    includesAll(search, FILTERABLE_AMENITIES.map((code) => `\`${code}\``), "amenities");
  });

  it("/schemas.md: every response object and its fields", () => {
    const markdown = pageMarkdown("/schemas");
    for (const doc of RESPONSE_DOCS) {
      includesAll(markdown, [doc.title, ...doc.rows.map((row) => `\`${row.path}\``)], doc.id);
    }
  });

  it("/examples.md: each example in fenced code, in every language", () => {
    const markdown = pageMarkdown("/examples");
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

  it("/index.md: the ways to pay, the display currencies and the ways to connect", () => {
    const markdown = pageMarkdown("/");
    includesAll(markdown, PAY_WAYS.map((way) => `**${PAY_WAY_DOCS[way].title}**`), "pay ways");
    includesAll(markdown, DISPLAY_CURRENCIES.filter((c) => c !== "USD"), "display currencies");
    assert.ok(markdown.includes("](/install#remote-mcp)"));
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

  it("an API reference page has its method and path", () => {
    for (const op of OPERATIONS) {
      assert.ok(
        pageMarkdown(`/api/reference/${op.id}`).includes(`\`${op.route.method} ${op.route.path}\``),
        op.id,
      );
    }
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
