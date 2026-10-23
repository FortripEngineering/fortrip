import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { COMMANDS } from "@fortrip/agent-contract";

/** The rows of the README's "Commands" table: command name -> description. */
async function commandTable(): Promise<Map<string, string>> {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const section = readme.match(/^## Commands\n([\s\S]*?)(?=^## )/m)?.[1] ?? "";
  const rows = new Map<string, string>();
  for (const line of section.split("\n")) {
    // `hotel <hotelId>` | What it does
    const cells = line.match(/^\|\s*`([a-z]+)[^`]*`\s*\|\s*(.*?)\s*\|$/);
    if (cells) rows.set(cells[1] as string, cells[2] as string);
  }
  return rows;
}

describe("README", () => {
  it("lists every command of the contract with its summary", async () => {
    const table = await commandTable();
    for (const spec of COMMANDS) {
      assert.equal(table.get(spec.name), spec.summary, `command ${spec.name}`);
    }
  });

  it("lists no command the contract doesn't have", async () => {
    const names = new Set<string>(COMMANDS.map((spec) => spec.name));
    for (const name of (await commandTable()).keys()) {
      assert.ok(names.has(name), `${name} is not a command`);
    }
  });
});
