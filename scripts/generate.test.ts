import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const CLAUDE_SKILL = "plugins/claude/skills/fortrip/SKILL.md";
const CLAUDE_PLANNING = "plugins/claude/skills/fortrip/references/planning.md";
const CLI_SKILL = "skills/fortrip-cli/SKILL.md";
const CLI_PLANNING = "skills/fortrip-cli/references/planning.md";
const GUIDE_DATA = "packages/contract/src/guide-data.generated.ts";
const GENERATED = [
  CLAUDE_SKILL,
  CLAUDE_PLANNING,
  CLI_SKILL,
  CLI_PLANNING,
  GUIDE_DATA,
];

/** The supplier's name, assembled so this file doesn't carry it. */
const SUPPLIER = new RegExp(["hui" + "zhi", "汇" + "智"].join("|"), "i");

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Runs `scripts/generate.ts` against `root`, a directory standing in for
 *  the repository. */
function generate(root: string, ...args: string[]) {
  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/generate.ts", "--root", root, ...args],
    { cwd: repo, encoding: "utf8" },
  );
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

/** A root holding a fresh render of every generated file. */
function rendered() {
  const root = mkdtempSync(path.join(tmpdir(), "fortrip-generate-"));
  roots.push(root);
  const run = generate(root);
  assert.equal(run.status, 0, run.output);
  return root;
}

const read = (root: string, file: string) =>
  readFileSync(path.join(root, file), "utf8");

/*
 * The CLI skill tells an agent which CLI to run. While the package is a prerelease, npm's
 * `latest` is still the release before it, which does not speak this contract: the skill then
 * names the exact version. Once released, it names `latest` again.
 */
describe("the CLI version a skill runs", () => {
  /** A fresh render for a CLI of `version`. */
  function renderedFor(version: string) {
    const root = mkdtempSync(path.join(tmpdir(), "fortrip-generate-"));
    roots.push(root);
    const run = generate(root, "--cli-version", version);
    assert.equal(run.status, 0, run.output);
    return root;
  }

  it("a prerelease: the exact version, wherever the skill names the package", () => {
    for (const version of ["6.0.0-rc.0", "6.1.0-beta.2"]) {
      const root = renderedFor(version);
      const cli = read(root, CLI_SKILL);
      assert.ok(cli.includes(`Run every command as \`npx -y fortrip@${version} <command>\``), version);
      for (const file of [CLI_SKILL, CLI_PLANNING]) assert.doesNotMatch(read(root, file), /fortrip@latest/, `${version} ${file}`);
    }
  });

  it("a release: latest", () => {
    for (const version of ["6.0.0", "6.0.1", "7.2.0"]) {
      const root = renderedFor(version);
      const cli = read(root, CLI_SKILL);
      assert.ok(cli.includes("Run every command as `npx -y fortrip@latest <command>`"), version);
      assert.doesNotMatch(cli, /fortrip@\d/, version);
    }
  });

  it("without the option, the version is the CLI package's own, and the committed skill follows it", () => {
    const { version } = JSON.parse(readFileSync(path.join(repo, "packages/cli/package.json"), "utf8")) as { version: string };
    const tag = version.includes("-") ? version : "latest";
    assert.ok(read(rendered(), CLI_SKILL).includes(`npx -y fortrip@${tag} <command>`), version);
    assert.ok(read(repo, CLI_SKILL).includes(`npx -y fortrip@${tag} <command>`), version);
  });

  it("the Claude skill names no package either way", () => {
    for (const version of ["6.0.0-rc.0", "6.0.0"]) {
      assert.doesNotMatch(read(renderedFor(version), CLAUDE_SKILL), /fortrip@/, version);
    }
  });
});

describe("pnpm generate", () => {
  it("writes the skills, their planning guides and the guide data", () => {
    const root = rendered();
    for (const file of GENERATED) {
      assert.ok(read(root, file).length > 0, file);
    }
    assert.match(read(root, CLAUDE_SKILL), /^---\nname: fortrip\ndescription: .+\n---\n\n# /);
    assert.match(read(root, CLI_SKILL), /^---\nname: fortrip-cli\ndescription: .+\n---\n\n# /);
    assert.match(read(root, CLAUDE_PLANNING), /^# Planning a hotel stay\n/);
    assert.match(read(root, CLI_PLANNING), /^# Planning a hotel stay\n/);
  });

  it("renders each skill for its own surface", () => {
    const root = rendered();
    const claude = read(root, CLAUDE_SKILL);
    assert.match(claude, /`fortrip:search_hotels`/);
    assert.match(claude, /\]\(references\/planning\.md\)/);
    assert.doesNotMatch(claude, /\bnpx\b|fortrip@latest|get_planning_guide/);
    const cli = read(root, CLI_SKILL);
    assert.match(cli, /npx -y fortrip@\S+ <command>/);
    assert.match(cli, /`fortrip hotels search`/);
    // R18: static, nothing for the agent to fetch before it can start.
    assert.doesNotMatch(cli, /fortrip@latest skill/);
  });

  it("points no generated skill file to a runtime guide", () => {
    const root = rendered();
    for (const file of [CLAUDE_SKILL, CLI_SKILL, CLAUDE_PLANNING, CLI_PLANNING]) {
      assert.doesNotMatch(read(root, file), /fortrip guide|get_planning_guide/, file);
    }
    assert.match(read(root, CLI_SKILL), /\]\(references\/planning\.md\)/);
  });

  // The front matter is written in generate.ts, not rendered from the contract.
  it("names in each skill's description only tools the contract has", async () => {
    const { TOOLS } = await import("../packages/contract/src/index.ts");
    const tools = new Set<string>(TOOLS.map((tool) => tool.name));
    const root = rendered();
    for (const file of [CLAUDE_SKILL, CLI_SKILL]) {
      const description = read(root, file).match(/^description: (.+)$/m)?.[1] ?? "";
      const named = [...description.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)].map(([name]) => name);
      assert.ok(named.length >= 3, `${file}: ${named}`);
      for (const name of named) assert.ok(tools.has(name), `${file}: ${name}`);
    }
  });

  it("never names the supplier", () => {
    const root = rendered();
    for (const file of GENERATED) assert.doesNotMatch(read(root, file), SUPPLIER, file);
  });

  it("--check passes on a fresh render", () => {
    const root = rendered();
    const run = generate(root, "--check");
    assert.equal(run.status, 0, run.output);
  });

  it("--check passes on the committed files", () => {
    const run = generate(repo, "--check");
    assert.equal(run.status, 0, run.output);
  });

  it("--check fails when a skill differs, and prints the diff", () => {
    const root = rendered();
    const file = path.join(root, CLI_SKILL);
    const edited = read(root, CLI_SKILL).replace(
      "# Fortrip hotel stays",
      "# Fortrip hotel stays, edited by hand",
    );
    writeFileSync(file, edited);

    const run = generate(root, "--check");
    assert.equal(run.status, 1, run.output);
    assert.match(run.output, new RegExp(`^--- a/${CLI_SKILL}$`, "m"));
    assert.match(run.output, new RegExp(`^\\+\\+\\+ b/${CLI_SKILL}$`, "m"));
    assert.match(run.output, /^-# Fortrip hotel stays, edited by hand$/m);
    assert.match(run.output, /^\+# Fortrip hotel stays$/m);
    assert.match(run.output, /pnpm generate/);
    // The files that were fine are not mentioned, and --check fixes nothing.
    assert.doesNotMatch(run.output, new RegExp(`--- a/${CLAUDE_SKILL}`));
    assert.equal(read(root, CLI_SKILL), edited);
  });

  it("--check fails when the contract's embedded guide differs", () => {
    const root = rendered();
    const file = path.join(root, GUIDE_DATA);
    writeFileSync(
      file,
      read(root, GUIDE_DATA).replace("Planning a hotel stay", "Planning a trip"),
    );

    const run = generate(root, "--check");
    assert.equal(run.status, 1, run.output);
    assert.match(run.output, new RegExp(`^--- a/${GUIDE_DATA}$`, "m"));
  });

  it("--check fails when a generated file is missing", () => {
    const root = rendered();
    rmSync(path.join(root, CLAUDE_PLANNING));

    const run = generate(root, "--check");
    assert.equal(run.status, 1, run.output);
    assert.match(run.output, new RegExp(`^\\+\\+\\+ b/${CLAUDE_PLANNING}$`, "m"));
  });

  it("running it again repairs what --check reported", () => {
    const root = rendered();
    writeFileSync(path.join(root, CLAUDE_SKILL), "stale\n");
    assert.equal(generate(root, "--check").status, 1);

    assert.equal(generate(root).status, 0);
    assert.equal(generate(root, "--check").status, 0);
  });

  it("--only guide-data writes only the guide data", () => {
    const root = mkdtempSync(path.join(tmpdir(), "fortrip-generate-"));
    roots.push(root);
    const run = generate(root, "--only", "guide-data");
    assert.equal(run.status, 0, run.output);
    assert.ok(read(root, GUIDE_DATA).length > 0);
    for (const file of GENERATED.filter((file) => file !== GUIDE_DATA)) {
      assert.equal(existsSync(path.join(root, file)), false, file);
    }
  });

  it("--check --only guide-data ignores the skills, not the guide data", () => {
    const root = rendered();
    writeFileSync(path.join(root, CLI_SKILL), "stale\n");
    assert.equal(generate(root, "--check", "--only", "guide-data").status, 0);

    writeFileSync(path.join(root, GUIDE_DATA), "stale\n");
    const run = generate(root, "--check", "--only", "guide-data");
    assert.equal(run.status, 1, run.output);
    assert.match(run.output, new RegExp(`^--- a/${GUIDE_DATA}$`, "m"));
    assert.doesNotMatch(run.output, new RegExp(`--- a/${CLI_SKILL}`));
  });

  it("rejects an --only target it doesn't know", () => {
    for (const args of [["--only", "skills"], ["--only"]]) {
      const run = generate(repo, "--check", ...args);
      assert.equal(run.status, 2, run.output);
      assert.match(run.output, /--only/);
    }
  });

  it("rejects an option it doesn't know", () => {
    const run = generate(repo, "--chek");
    assert.equal(run.status, 2, run.output);
    assert.match(run.output, /--chek/);
  });
});
