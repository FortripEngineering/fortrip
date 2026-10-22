import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { registryEntryProblems } from "./registry-entry.mjs";

const NAME = "io.github.FortripEngineering/fortrip";

const server = (overrides: Record<string, unknown> = {}) => ({
  name: NAME,
  version: "1.1.0",
  packages: [{ registryType: "npm", identifier: "fortrip", version: "1.0.0" }],
  ...overrides,
});
const cli = (overrides: Record<string, unknown> = {}) => ({
  name: "fortrip",
  version: "1.0.0",
  mcpName: NAME,
  ...overrides,
});

describe("the MCP Registry entry against packages/cli", () => {
  it("passes when the listed version and the mcpName are the CLI's", () => {
    assert.deepEqual(registryEntryProblems(server(), cli()), []);
  });

  it("fails for a CLI without an mcpName (the MCP Registry requires it)", () => {
    const problems = registryEntryProblems(server(), cli({ mcpName: undefined }));
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /mcpName is undefined/);
  });

  it("fails when the listed package version is not the CLI's", () => {
    const problems = registryEntryProblems(server(), cli({ version: "1.0.1" }));
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /fortrip@1\.0\.0.*1\.0\.1/);
  });

  it("fails when the CLI's mcpName is not the entry's name", () => {
    const problems = registryEntryProblems(server(), cli({ mcpName: "io.github.Someone/else" }));
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /mcpName.*io\.github\.Someone\/else/);
  });

  it("reports both problems when both are wrong", () => {
    assert.equal(
      registryEntryProblems(server(), cli({ version: "2.0.0", mcpName: "x/y" })).length,
      2,
    );
  });

  it("fails when the entry lists no npm package of that name", () => {
    for (const packages of [
      undefined,
      [],
      [{ registryType: "pypi", identifier: "fortrip", version: "1.0.0" }],
      [{ registryType: "npm", identifier: "other", version: "1.0.0" }],
    ]) {
      const problems = registryEntryProblems(server({ packages }), cli());
      assert.deepEqual(problems, ["packages[] has no npm entry for fortrip"]);
    }
  });

  it("holds for the files in this repository", () => {
    const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    assert.deepEqual(
      registryEntryProblems(read("plugins/registry/server.json"), read("packages/cli/package.json")),
      [],
    );
  });
});
