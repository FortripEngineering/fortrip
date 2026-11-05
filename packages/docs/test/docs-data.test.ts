import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACCOUNT_ROUTES,
  COMMANDS,
  HTTP_ROUTES,
  PUBLIC_ORIGINS,
  searchHotelsInput,
  TOOLS,
} from "@fortrip/agent-contract";

import { OPERATIONS } from "../lib/openapi/build.ts";
import { API_BASE_URL, ENDPOINTS } from "../lib/reference/api-docs.ts";
import { CLI_COMMANDS, commandSlug, RAW_BODY_EXAMPLE } from "../lib/reference/cli-commands.ts";
import { MCP_TOOLS } from "../lib/reference/mcp-tools.ts";
import { RESPONSE_DOCS, responseDocFor } from "../lib/reference/response-docs.ts";

test("every contract tool has a docs page that takes its words from the contract", () => {
  assert.deepEqual(
    MCP_TOOLS.map((tool) => tool.name).sort(),
    TOOLS.map((tool) => tool.name).sort(),
  );
  for (const tool of MCP_TOOLS) {
    const spec = TOOLS.find((candidate) => candidate.name === tool.name);
    assert.equal(tool.title, spec?.title);
    assert.equal(tool.summary, spec?.description);
    assert.equal(tool.readOnly, spec?.annotations.readOnlyHint);
    assert.equal(tool.access === "Read-only", tool.readOnly, `${tool.name}: access`);
  }
});

test("a tool page's description is one short sentence: its contract description's first, unless that is too long", () => {
  for (const tool of MCP_TOOLS) {
    assert.ok(tool.snippet.length <= 200, `${tool.name}: ${tool.snippet.length}`);
    assert.match(tool.snippet, /[.!?]$/, tool.name);
    assert.doesNotMatch(tool.snippet, /[.!?]\s/, tool.name);
    const first = /^.*?[.!?](?=\s|$)/s.exec(tool.summary)?.[0] ?? tool.summary;
    if (first.length <= 200) assert.equal(tool.snippet, first, tool.name);
    // The body shows what the description doesn't: all of the contract's text.
    assert.equal(`${tool.summary.startsWith(tool.snippet) ? tool.snippet : ""} ${tool.rest}`.trim(), tool.summary, tool.name);
  }
});

test("an API reference page is described like its MCP tool's page; an account route by the docs", () => {
  for (const op of OPERATIONS) {
    const tool = MCP_TOOLS.find((t) => t.name === op.endpoint.tool);
    if (tool) assert.equal(op.summary, tool.snippet, op.id);
    assert.ok(op.summary.length > 0 && op.summary.length <= 200, `${op.id}: ${op.summary.length}`);
  }
  assert.deepEqual(OPERATIONS.filter((op) => !op.endpoint.tool).map((op) => op.id).sort(), ["auth_config", "me"]);
});

test("every contract command has a docs page with a row for each of its flags", () => {
  assert.deepEqual(
    CLI_COMMANDS.map((command) => command.slug).sort(),
    COMMANDS.map(commandSlug).sort(),
  );
  for (const spec of COMMANDS) {
    const command = CLI_COMMANDS.find((c) => c.slug === commandSlug(spec));
    const rows = command?.flags ?? [];
    for (const flag of spec.flags) {
      const row = rows.find(([label]) =>
        new RegExp(`--${flag.flag}(?![\\w-])`).test(label),
      );
      assert.equal(row?.[1], flag.field, `${spec.name} --${flag.flag}`);
      assert.equal(row?.[2], flag.description, `${spec.name} --${flag.flag}`);
    }
  }
});

test("a command's page slug and invocation come from its group and name", () => {
  const command = (slug: string) =>
    CLI_COMMANDS.find((candidate) => candidate.slug === slug);
  assert.equal(command("hotels-search")?.invocation, "fortrip hotels search");
  assert.equal(command("hotels-get")?.invocation, "fortrip hotels get");
  assert.equal(command("orders-get")?.invocation, "fortrip orders get");
  assert.equal(command("orders-cancel")?.invocation, "fortrip orders cancel");
  assert.equal(command("orders-pay")?.invocation, "fortrip orders pay");
  assert.equal(command("login")?.invocation, "fortrip login");
  // The tool pages' slugs are the tool names, dashed.
  assert.deepEqual(MCP_TOOLS.map((tool) => tool.slug).sort(), [
    "book-hotel",
    "cancel-order",
    "get-hotel",
    "get-hotel-offers",
    "get-order",
    "get-planning-guide",
    "list-orders",
    "pay-order",
    "search-hotels",
  ]);
});

test("a usage line lists the positionals and the flags of required fields", () => {
  const usage = (slug: string) =>
    CLI_COMMANDS.find((command) => command.slug === slug)?.usage;
  assert.equal(usage("hotels-search"), "fortrip hotels search [options]");
  assert.match(
    usage("hotels-offers") ?? "",
    /^fortrip hotels offers --hotel \S+\.\.\. .*\[options\]$/,
  );
  assert.equal(usage("hotels-get"), "fortrip hotels get <hotelId> [options]");
  assert.equal(usage("orders-get"), "fortrip orders get <orderId> [options]");
  assert.equal(usage("guide"), "fortrip guide [topic]");
  assert.equal(usage("logout"), "fortrip logout");
});

test("a command with a tool links to that tool's page", () => {
  const pages = new Set(MCP_TOOLS.map((tool) => tool.slug));
  for (const spec of COMMANDS) {
    const command = CLI_COMMANDS.find((c) => c.slug === commandSlug(spec));
    assert.equal(command?.mcp === undefined, spec.tool === null, spec.name);
    if (command?.mcp) assert.ok(pages.has(command.mcp), spec.name);
  }
});

test("a tool page links to the page of its CLI command", () => {
  const pages = new Set(CLI_COMMANDS.map((command) => command.slug));
  for (const tool of MCP_TOOLS) {
    assert.ok(pages.has(tool.cliSlug), tool.name);
    assert.ok(tool.cli.startsWith("fortrip "), tool.name);
  }
  const cli = (name: string) => MCP_TOOLS.find((t) => t.name === name)?.cli;
  assert.equal(cli("get_hotel_offers"), "fortrip hotels offers");
  assert.equal(cli("list_orders"), "fortrip orders list");
  assert.equal(cli("book_hotel"), "fortrip hotels book");
  assert.equal(cli("get_planning_guide"), "fortrip guide planning");
});

test("a tool or command that answers an object links to its response schema", () => {
  const anchors = new Set(
    RESPONSE_DOCS.map((doc) => `/schemas#${doc.id}`),
  );
  for (const tool of MCP_TOOLS) {
    const doc = responseDocFor(tool.name);
    if (doc) {
      assert.equal(typeof tool.returns, "object", tool.name);
      if (typeof tool.returns === "object") {
        assert.ok(anchors.has(tool.returns.href), tool.name);
        assert.equal(tool.returns.title, doc.title, tool.name);
      }
    } else {
      assert.equal(typeof tool.returns, "string", tool.name);
    }
  }
  for (const command of CLI_COMMANDS) {
    assert.ok(command.output.trim(), command.slug);
    assert.doesNotMatch(command.output, /being updated/i, command.slug);
    if (command.schema) {
      assert.ok(anchors.has(command.schema.href), command.slug);
    }
  }
  const schema = (slug: string) =>
    CLI_COMMANDS.find((command) => command.slug === slug)?.schema?.href;
  assert.equal(schema("hotels-search"), "/schemas#search-result");
  assert.equal(schema("orders-list"), "/schemas#order-list");
  assert.equal(schema("whoami"), "/schemas#account");
  assert.equal(schema("guide"), undefined);
});

test("the raw-body example is a valid search request", () => {
  const parsed = searchHotelsInput.safeParse(RAW_BODY_EXAMPLE);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
});

test("the API reference lists every operation at the contract's host and routes", () => {
  assert.equal(API_BASE_URL, `${PUBLIC_ORIGINS.api}/v1`);
  const routes = [...Object.values(HTTP_ROUTES), ...Object.values(ACCOUNT_ROUTES)];
  assert.deepEqual(
    ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`).sort(),
    routes.map((route) => `${route.method} ${route.path}`).sort(),
  );
  for (const endpoint of ENDPOINTS) {
    if (endpoint.tool === null) continue;
    const route = HTTP_ROUTES[endpoint.tool];
    assert.equal(`${endpoint.method} ${endpoint.path}`, `${route.method} ${route.path}`);
  }
  assert.deepEqual(
    ENDPOINTS.flatMap((endpoint) => (endpoint.tool ? [endpoint.tool] : [])).sort(),
    TOOLS.filter((tool) => tool.input)
      .map((tool) => tool.name)
      .sort(),
  );
});
