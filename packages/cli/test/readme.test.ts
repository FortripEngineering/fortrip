import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { COMMAND_GROUPS, COMMANDS, commandInvocation } from "@fortrip/agent-contract";

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
});
