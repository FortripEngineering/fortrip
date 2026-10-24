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

  it("documents every environment variable the help lists, and the URLs the CLI defaults to", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const variables = [...overallHelp().matchAll(/^ {2}(FORTRIP_[A-Z_]+) /gm)].map((m) => m[1] as string);
    assert.deepEqual(variables.sort(), [
      "FORTRIP_API_URL",
      "FORTRIP_DISPLAY_CURRENCY",
      "FORTRIP_MCP_URL",
      "FORTRIP_TOKEN",
    ]);
    for (const name of variables) {
      assert.match(readme, new RegExp(`^\\| \`${name}\` \\|`, "m"), name);
    }
    assert.ok(readme.includes(`\`${PUBLIC_ORIGINS.api}\``), "the default API URL");
    assert.ok(readme.includes(`\`${PUBLIC_ORIGINS.mcp}${MCP_PATH}\``), "the MCP server URL");
  });

  it("lists exit codes 0 to 4", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const section = readme.match(/^## Output and exit codes\n([\s\S]*?)(?=^## )/m)?.[1] ?? "";
    const codes = [...section.matchAll(/^\| (\d) \|/gm)].map((m) => m[1]);
    assert.deepEqual(codes, ["0", "1", "2", "3", "4"]);
  });

  it("says nothing the 2.x CLI said and 3.0 no longer does", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    // The Upgrading section is where 2.x names are shown, by name only.
    const outsideUpgrade = readme.replace(/^## Upgrading from 2\.x\n[\s\S]*?(?=^## )/m, "");
    for (const stale of ["--query", "FORTRIP_CURRENCY", "/api/mcp", "/api/agent", "hotels rates"]) {
      assert.ok(!outsideUpgrade.includes(stale), stale);
    }
    assert.match(readme, /^## Upgrading from 2\.x$/m);
  });
});
