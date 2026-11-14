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
import { RESPONSE_DOCS, responseDocFor, schemaTitle } from "../lib/reference/response-docs.ts";

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

test("a tool page is described by what the tool does for a person, in one or two short plain sentences", () => {
  for (const tool of MCP_TOOLS) {
    // The page description is plain text (meta, header, llms.txt), and the
    // model's description is shown once, under its label, not repeated here.
    assert.ok(tool.human.length <= 200, `${tool.name}: ${tool.human.length}`);
    assert.doesNotMatch(tool.human, /[`[\]*]/, tool.name);
    assert.ok(!tool.summary.startsWith(tool.human.split(/(?<=[.!?])\s/)[0] ?? ""), tool.name);
    const sentences = tool.human.split(/(?<=[.!?])\s+/);
    assert.ok(sentences.length >= 1 && sentences.length <= 2, `${tool.name}: ${sentences.length} sentences`);
    assert.match(tool.human, /[.!?]$/, tool.name);
    assert.notEqual(tool.human, tool.summary, tool.name);
    // No limit typed by hand: the description the model reads states those.
    assert.doesNotMatch(tool.human, /\d/, tool.name);
  }
});

test("an API reference page is described like its MCP tool's page; an account route by the docs", () => {
  for (const op of OPERATIONS) {
    const tool = MCP_TOOLS.find((t) => t.name === op.endpoint.tool);
    if (tool) assert.equal(op.summary, tool.human, op.id);
    assert.ok(op.summary.length > 0 && op.summary.length <= 200, `${op.id}: ${op.summary.length}`);
  }
  assert.deepEqual(OPERATIONS.filter((op) => !op.endpoint.tool).map((op) => op.id).sort(), ["auth_config", "me"]);
});

test("an operation has one title: its tool's, on the API page, in openapi.json and on its CLI command's page", () => {
  for (const endpoint of ENDPOINTS) {
    const tool = TOOLS.find((t) => t.name === endpoint.tool);
    const command = CLI_COMMANDS.find((c) => c.slug === endpoint.cliSlug);
    const title = tool?.title ?? endpoint.title;
    assert.equal(endpoint.title, title, endpoint.path);
    assert.equal(OPERATIONS.find((op) => op.endpoint === endpoint)?.endpoint.title, title, endpoint.path);
    // `fortrip login` reads the sign-in settings to sign in: another operation.
    if (endpoint.cliSlug !== "login") assert.equal(command?.title, title, endpoint.cliSlug);
  }
  assert.deepEqual(
    ENDPOINTS.filter((endpoint) => !endpoint.tool).map((endpoint) => endpoint.title),
    ["Account", "OAuth sign-in settings"],
  );
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
    "cancel-order",
    "create-order",
    "get-hotel",
    "get-hotel-offers",
    "get-order",
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
  // --max-penalty cancels a paid order, --close closes an unpaid one; without either it changes nothing.
  assert.equal(usage("orders-cancel"), "fortrip orders cancel <orderId> [options]");
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
  assert.equal(cli("create_order"), "fortrip orders create");
});

test("a tool or command that answers an object links to its response schema", () => {
  const anchors = new Set(
    RESPONSE_DOCS.map((doc) => `/schemas#${doc.id}`),
  );
  for (const tool of MCP_TOOLS) {
    const doc = responseDocFor(tool.name);
    assert.ok(doc, tool.name);
    assert.ok(anchors.has(tool.returns.href), tool.name);
    assert.equal(tool.returns.title, schemaTitle(doc), tool.name);
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
  // Cancel and pay answer the order itself, and link to it.
  assert.equal(schema("orders-cancel"), "/schemas#order");
  assert.equal(schema("orders-pay"), "/schemas#order");
  for (const name of ["cancel_order", "pay_order"]) {
    assert.deepEqual(MCP_TOOLS.find((t) => t.name === name)?.returns, { title: "Order", href: "/schemas#order" }, name);
  }
  assert.equal(schema("whoami"), "/schemas#account");
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
