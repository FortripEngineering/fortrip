import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { publishedEntry, registryEntryProblems } from "./registry-entry.mjs";

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

  it("fails when a changed entry's version is not greater than the published one", () => {
    const published = { name: NAME, version: "1.2.0", packages: [] };
    for (const version of ["1.2.0", "1.1.9", "0.9.0"]) {
      const problems = registryEntryProblems(server({ version }), cli(), published);
      assert.equal(problems.length, 1, version);
      assert.match(problems[0] ?? "", new RegExp(`${version.replaceAll(".", "\\.")}.*not greater than 1\\.2\\.0`));
    }
  });

  it("passes a changed entry with a greater version, compared as numbers", () => {
    for (const version of ["1.3.0", "1.10.0", "2.0.0"]) {
      const published = { name: NAME, version: version === "1.10.0" ? "1.9.0" : "1.2.0" };
      assert.deepEqual(registryEntryProblems(server({ version }), cli(), published), []);
    }
  });

  it("does not ask an entry that is the published one to raise its version", () => {
    assert.deepEqual(registryEntryProblems(server(), cli(), server()), []);
  });

  it("holds for the files in this repository", () => {
    const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    assert.deepEqual(
      registryEntryProblems(read("plugins/registry/server.json"), read("packages/cli/package.json")),
      [],
    );
  });
});

describe("the entry on origin/main", () => {
  const unreadable = () => {
    throw new Error("fatal: invalid object name 'origin/main'");
  };

  it("is parsed when git can read it, in CI or not", () => {
    for (const ci of [false, true]) {
      assert.deepEqual(publishedEntry(() => JSON.stringify(server()), ci), { published: server() });
    }
  });

  it("is skipped, with a message, when git can't read it outside CI", () => {
    const result = publishedEntry(unreadable, false);
    assert.equal(result.problem, undefined);
    assert.match(result.skipped ?? "", /registry version check: origin\/main.*not readable/);
  });

  it("fails when git can't read it in CI, so the check can't be skipped silently", () => {
    const result = publishedEntry(unreadable, true);
    assert.equal(result.skipped, undefined);
    assert.match(result.problem ?? "", /not readable.*CI has to fetch main/);
  });
});
