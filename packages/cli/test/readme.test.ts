import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  COMMAND_GROUPS,
  COMMANDS,
  commandInvocation,
  MCP_PATH,
  PUBLIC_ORIGINS,
} from "@fortrip/agent-contract";

import { DEFAULT_API_URL, DEFAULT_MCP_URL } from "../src/credentials.ts";
import { EXIT } from "../src/exit-codes.ts";
import { overallHelp } from "../src/help.ts";

/** A command as typed after `fortrip`: `hotels search`, `login`. */
const typed = (spec: (typeof COMMANDS)[number]) =>
  commandInvocation(spec).replace(/^fortrip /, "");

/** The rows of the README's "Commands" table: command as typed -> description. */
async function commandTable(): Promise<Map<string, string>> {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const section = readme.match(/^## Commands\n([\s\S]*?)(?=^## )/m)?.[1] ?? "";
  const rows = new Map<string, string>();
  for (const line of section.split("\n")) {
    // `hotels get <hotelId>` | What it does
    const cells = line.match(/^\|\s*`([a-z]+(?: [a-z]+)*)[^`]*`\s*\|\s*(.*?)\s*\|$/);
    if (cells) rows.set(cells[1] as string, cells[2] as string);
  }
  return rows;
}

describe("README", () => {
  // A dated example goes stale, and a stay in the past is refused: dates are placeholders.
  it("gives no example with a calendar date", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    assert.doesNotMatch(readme, /--check-(?:in|out) \d/);
    assert.match(readme, /--check-in YYYY-MM-DD --check-out YYYY-MM-DD/);
  });

  it("lists every command of the contract, as typed, with its summary", async () => {
    const table = await commandTable();
    for (const spec of COMMANDS) {
      assert.equal(table.get(typed(spec)), spec.summary, `command ${typed(spec)}`);
    }
  });

  it("lists no command the contract doesn't have", async () => {
    const names = new Set<string>(COMMANDS.map(typed));
    for (const name of (await commandTable()).keys()) {
      assert.ok(names.has(name), `${name} is not a command`);
    }
  });

  it("names only commands the CLI has, with their group", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const invocations = new Set(COMMANDS.map(commandInvocation));
    const groups = new Set<string>(COMMAND_GROUPS.map((group) => group.name));
    let named = 0;
    for (const [, first, second] of readme.matchAll(/(?:^|`|npx -y )fortrip ([a-z]+)(?: ([a-z]+))?/gm)) {
      // A group alone (`fortrip hotels --help`) is its help.
      if (groups.has(first as string) && second === undefined) continue;
      const invocation = groups.has(first as string)
        ? `fortrip ${first} ${second}`
        : `fortrip ${first}`;
      assert.ok(invocations.has(invocation), invocation);
      named++;
    }
    assert.ok(named > 5, `${named} commands named`);
  });

  it("states no access token lifetime: Fortrip's token response does (expires_in)", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    assert.doesNotMatch(readme, /\b24 hours?\b|\ba day\b/i);
    assert.match(readme, /Access tokens are short-lived/);
  });

  it("documents every environment variable the help lists, and the URLs the CLI defaults to", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const variables = [...overallHelp().matchAll(/^ {2}(FORTRIP_[A-Z_]+) /gm)].map((m) => m[1] as string);
    assert.deepEqual(variables.sort(), [
      "FORTRIP_API_URL",
      "FORTRIP_CURRENCY",
      "FORTRIP_MCP_URL",
      "FORTRIP_TOKEN",
    ]);
    for (const name of variables) {
      assert.match(readme, new RegExp(`^\\| \`${name}\` \\|`, "m"), name);
    }
    // The help states the defaults the CLI uses.
    const help = overallHelp();
    assert.ok(help.includes(`(default ${DEFAULT_API_URL})`), "the help's default API URL");
    assert.ok(help.includes(`(default ${DEFAULT_MCP_URL})`), "the help's default MCP URL");
    const row = (name: string) => readme.match(new RegExp(`^\\| \`${name}\` \\|(.*)$`, "m"))?.[1] ?? "";
    assert.ok(row("FORTRIP_API_URL").includes(`\`${PUBLIC_ORIGINS.api}\``), "the default API URL");
    assert.ok(
      row("FORTRIP_MCP_URL").includes(`(default \`${PUBLIC_ORIGINS.mcp}${MCP_PATH}\`)`),
      "the default MCP server URL",
    );
  });

  it("lists every exit code, 0 to 5, each with its meaning", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const section = readme.match(/^## Output and exit codes\n([\s\S]*?)(?=^## )/m)?.[1] ?? "";
    const rows = [...section.matchAll(/^\| (\d) \| (.*) \|$/gm)].map((m) => [m[1], m[2]]);
    assert.deepEqual(rows.map(([code]) => Number(code)), Object.values(EXIT));
    const meaning = new Map(rows as [string, string][]);
    assert.match(meaning.get("0") as string, /^Success$/);
    assert.match(meaning.get("1") as string, /^Any other error.*destination_ambiguous.*offer_changed.*retryable/);
    assert.match(meaning.get("2") as string, /^Invalid arguments.*invalid_request/);
    assert.match(meaning.get("3") as string, /^Not signed in.*loginUrl/);
    assert.match(meaning.get("4") as string, /^Rate limited.*retryAfterSeconds/);
    assert.match(meaning.get("5") as string, /^This version of the CLI is too old.*client_outdated.*Update it/);
  });

  it("says a signed-out MCP tool call gets a tool error, not -32001", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const section = readme.match(/^## MCP server\n([\s\S]*?)(?=^## )/m)?.[1] ?? "";
    const paragraph = section.match(/^You can add the bridge[\s\S]*?(?=\n\n)/m)?.[0] ?? "";
    assert.match(paragraph, /tool error[^.]*isError: true[^.]*unauthenticated[^.]*whose text says/);
    assert.match(paragraph, /npx -y fortrip login/);
    assert.match(paragraph, /no restart/);
    // -32001 is only what a request other than a tool call gets.
    const [, afterToolCall = ""] = paragraph.split(/any other request/);
    assert.match(afterToolCall, /-32001/);
    assert.doesNotMatch(paragraph.replace(/any other request[\s\S]*/, ""), /-32001/);
  });

  it("says a tool's result is one block of text, an error's too, and names no removed shape", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const section = readme.match(/^## MCP server\n([\s\S]*?)(?=^## )/m)?.[1] ?? "";
    assert.match(section, /A tool's result is one block of text/);
    assert.match(section, /_meta\["ai\.fortrip\/error"\]/);
    assert.match(section, /tool error `client_outdated`/);
    assert.doesNotMatch(readme, /structuredContent|book_hotel|hotels book|--method|--first-name|--last-name|\bQR\b|Alipay|WeChat/i);
  });
});
