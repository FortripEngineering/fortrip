// Reads the output of `next build`, which the package's test script runs first.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  COMMANDS,
  commandInvocation,
  ERROR_CODES,
  GLOBAL_FLAGS,
  LIMITS,
  RATE_LIMITS,
  TOOLS,
} from "@fortrip/agent-contract";
import { ENABLED_REGIONS } from "@fortrip/agent-contract/regions";

import { limitRows } from "../lib/reference/limits.ts";
import { REFERENCE_PAGES } from "../lib/reference/pages.tsx";
import { RESPONSE_DOCS } from "../lib/reference/response-docs.ts";

const app = new URL("../.next/server/app/", import.meta.url).pathname;

/** A built page's HTML, React's `<!-- -->` text separators removed. */
const html = (route: string) =>
  readFileSync(join(app, `${route === "/" ? "index" : route.slice(1)}.html`), "utf8").replaceAll(
    "<!-- -->",
    "",
  );

/** HTML-escaped as React writes text and attributes. */
const escaped = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");

// Slugs as the contract names them: tools dashed, commands by group and name.
const toolRoutes = TOOLS.map((tool) => ({
  tool,
  route: `/mcp/${tool.name.replaceAll("_", "-")}`,
}));
const commandRoutes = COMMANDS.map((spec) => ({
  spec,
  route: `/cli/${spec.group === null ? spec.name : `${spec.group}-${spec.name}`}`,
}));

describe("reference pages", () => {
  it("builds one page per contract tool, titled and described by the contract", () => {
    const built = readdirSync(join(app, "mcp")).filter((f) => f.endsWith(".html"));
    assert.equal(built.length, TOOLS.length);
    for (const { tool, route } of toolRoutes) {
      const page = html(route);
      assert.ok(page.includes(`<h1`) && page.includes(escaped(tool.title)), route);
      assert.ok(page.includes(tool.name), route);
    }
  });

  it("builds one page per contract command, with its invocation and every flag", () => {
    const built = readdirSync(join(app, "cli")).filter((f) => f.endsWith(".html"));
    assert.equal(built.length, COMMANDS.length);
    for (const { spec, route } of commandRoutes) {
      const page = html(route);
      assert.ok(page.includes(escaped(commandInvocation(spec))), route);
      for (const flag of spec.flags) assert.ok(page.includes(`--${flag.flag}`), `${route} --${flag.flag}`);
    }
  });

  it("lists every tool and command page in the sidebar", () => {
    // Collapsed folders render no links, so read each folder's sidebar from a page inside it.
    const index = html("/");
    assert.ok(index.includes('href="/mcp"') && index.includes('href="/cli"'));
    const inMcp = html(toolRoutes[0]?.route ?? "");
    for (const { route } of toolRoutes) assert.ok(inMcp.includes(`href="${route}"`), route);
    const inCli = html(commandRoutes[0]?.route ?? "");
    for (const { route } of commandRoutes) assert.ok(inCli.includes(`href="${route}"`), route);
  });

  it("gives every tool and command page a search entry", () => {
    const routes = REFERENCE_PAGES.map((page) => `/${page.path.replace(/\.mdx$/, "")}`).sort();
    assert.deepEqual(routes, [...toolRoutes, ...commandRoutes].map(({ route }) => route).sort());
    for (const page of REFERENCE_PAGES) {
      const { contents } = page.data.structuredData;
      assert.ok(contents.length > 1, page.path);
      assert.ok(
        contents.some((c) => c.content.includes(page.data.description)),
        `${page.path}: search finds its description`,
      );
    }
  });

  it("lists every tool and command on the overviews", () => {
    const mcp = html("/mcp");
    for (const { tool, route } of toolRoutes) assert.ok(mcp.includes(`href="${route}"`), tool.name);
    const cli = html("/cli");
    for (const { route } of commandRoutes) assert.ok(cli.includes(`href="${route}"`), route);
    for (const option of GLOBAL_FLAGS) assert.ok(cli.includes(`--${option.flag}`), option.flag);
  });

  it("documents every response schema, error code, limit and rate limit", () => {
    const schemas = html("/schemas");
    for (const doc of RESPONSE_DOCS) assert.ok(schemas.includes(`id="${doc.id}"`), doc.id);
    const errors = html("/errors");
    for (const code of Object.keys(ERROR_CODES)) assert.ok(errors.includes(`id="code-${code}"`), code);
    for (const [label, value] of limitRows(LIMITS)) {
      assert.ok(errors.includes(escaped(label)) && errors.includes(escaped(value)), label);
    }
    for (const scope of Object.keys(RATE_LIMITS)) assert.ok(errors.includes(scope), scope);
  });

  it("lists every enabled region with its place id", () => {
    const regions = html("/regions");
    for (const region of ENABLED_REGIONS) assert.ok(regions.includes(region.placeId), region.placeId);
    assert.ok(regions.includes(`${ENABLED_REGIONS.length} regions`));
  });
});
