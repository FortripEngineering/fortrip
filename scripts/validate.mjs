// Checks the listings that Claude Code's validator doesn't cover: the OpenAI
// plugin package and the MCP Registry entry against the schemas their
// `$schema` names, OpenAI's submission limits, the MCP URL every listing
// points at, the skills' front matter, and repo-wide content rules.
// Run with `pnpm validate` after `pnpm build` (it reads the built contract);
// CI also runs `pnpm generate --check` and `claude plugin validate --strict`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { publishedEntry, registryEntryProblems } from "./registry-entry.mjs";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (file) => fs.readFileSync(path.join(repo, file), "utf8");
const load = (file) => JSON.parse(read(file));

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) return;
  failures++;
  console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

const MCP_URL = "https://mcp.fortrip.ai/";
// The hosted MCP server's tools, for the OpenAI review test cases: the
// contract's, from its build.
let TOOLS = new Set();
try {
  const contract = await import(new URL("../packages/contract/dist/index.js", import.meta.url).href);
  TOOLS = new Set(contract.TOOLS.map((tool) => tool.name));
} catch (error) {
  check("packages/contract is built (run `pnpm build`)", false, String(error.message ?? error));
}

// Schemas: each file against the schema its `$schema` names.
for (const file of ["plugins/openai/plugin.json", "plugins/openai/mcp.json", "plugins/registry/server.json"]) {
  const data = load(file);
  let schema;
  try {
    const response = await fetch(data.$schema, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      check(`${file}: fetch ${data.$schema}`, false, `HTTP ${response.status}`);
      continue;
    }
    schema = await response.json();
  } catch (error) {
    check(`${file}: fetch ${data.$schema}`, false, String(error));
    continue;
  }
  const ajv = schema.$schema?.includes("2020-12")
    ? new Ajv2020({ allErrors: true, strict: false })
    : new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  check(`${file} matches ${data.$schema}`, validate(data), JSON.stringify(validate.errors));
}

// Every listing points at the same hosted MCP server.
const server = load("plugins/registry/server.json");
check("registry name", server.name === "io.github.FortripEngineering/fortrip", server.name);
check("registry remote", server.remotes?.some((r) => r.url === MCP_URL), JSON.stringify(server.remotes));
// The entry lists the package that is released, so a release has to move it.
// The version it must beat is the one on origin/main, when git can say.
const { published, skipped, problem } = publishedEntry(
  () =>
    execFileSync("git", ["show", "origin/main:plugins/registry/server.json"], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  process.env.CI === "true",
);
if (skipped) console.log(`SKIP ${skipped}`);
check("registry version check ran", !problem, problem);
const registryProblems = registryEntryProblems(server, load("packages/cli/package.json"), published);
check("registry entry matches packages/cli", registryProblems.length === 0, registryProblems.join("; "));
check("plugins/claude/.mcp.json url", load("plugins/claude/.mcp.json").mcpServers?.fortrip?.url === MCP_URL);
// `claude plugin validate` doesn't follow a marketplace entry's source.
for (const entry of load(".claude-plugin/marketplace.json").plugins) {
  const manifest = path.join(entry.source, ".claude-plugin/plugin.json");
  check(`marketplace ${entry.name}: ${manifest} exists`, fs.existsSync(path.join(repo, manifest)));
  if (fs.existsSync(path.join(repo, manifest))) {
    check(`marketplace ${entry.name}: name matches ${manifest}`, load(manifest).name === entry.name);
  }
}
check("plugins/openai/mcp.json url", load("plugins/openai/mcp.json").mcpServers?.fortrip?.url === MCP_URL);

// OpenAI submission limits. "Supported text" has no control characters
// (a line break only where allowed), no U+2028/U+2029 and no invisible
// formatting characters.
const BAD_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f\u2028-\u2029\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/;
function text(label, value, max, multiline = false) {
  const ok =
    typeof value === "string" &&
    value.trim() !== "" &&
    [...value].length <= max &&
    !BAD_CHARS.test(value) &&
    (multiline || !value.includes("\n"));
  check(`${label}: ${multiline ? "" : "one line, "}1–${max} characters of supported text`, ok, JSON.stringify(value)?.slice(0, 80));
}

const plugin = load("plugins/openai/plugin.json");
const openai = plugin.extensions["com.openai"];
const ui = openai.interface;
text("name", plugin.name, 64);
check("name pattern", /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(plugin.name), plugin.name);
check("version is semver", /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(plugin.version), plugin.version);
text("description", plugin.description, 1024, true);
text("interface.displayName", ui.displayName, 30);
text("interface.shortDescription", ui.shortDescription, 30);
text("interface.longDescription", ui.longDescription, 4000, true);
text("interface.developerName", ui.developerName, 80);
check("at most 20 capabilities", ui.capabilities.length <= 20, `${ui.capabilities.length}`);
ui.capabilities.forEach((c, n) => text(`capabilities[${n}]`, c, 120));
check("at most 3 default prompts", ui.defaultPrompt.length <= 3, `${ui.defaultPrompt.length}`);
ui.defaultPrompt.forEach((prompt, n) => {
  text(`defaultPrompt[${n}]`, prompt, 128);
  check(`defaultPrompt[${n}] has no @mention`, !/@\w/.test(prompt), prompt);
});
const normalize = (s) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
check("default prompts are distinct", new Set(ui.defaultPrompt.map(normalize)).size === ui.defaultPrompt.length);
for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
  check(`interface.${key} is https`, /^https:\/\/[^\s/@]+(\/\S*)?$/.test(ui[key]) && ui[key].length <= 1024, ui[key]);
}
check("brandColor is #RRGGBB", /^#[0-9A-Fa-f]{6}$/.test(ui.brandColor), ui.brandColor);
for (const key of ["composerIcon", "logo"]) {
  check(`interface.${key} exists`, ui[key].startsWith("./") && fs.existsSync(path.join(repo, "plugins/openai", ui[key])), ui[key]);
}

const cases = openai.review.test_cases;
check("exactly 5 positive test cases", cases.positive.length === 5, `${cases.positive.length}`);
check("exactly 3 negative test cases", cases.negative.length === 3, `${cases.negative.length}`);
const CASE_KEYS = new Set(["description", "prompt", "tools_triggered", "expected_behavior", "file_attachment_urls", "expected_output_url"]);
const filled = (c, keys) => keys.every((k) => typeof c[k] === "string" && c[k].trim()) && Object.keys(c).every((k) => CASE_KEYS.has(k));
cases.positive.forEach((c, n) => {
  check(`positive[${n}] fields`, filled(c, ["description", "prompt", "tools_triggered", "expected_behavior"]));
  text(`positive[${n}].description`, c.description, 4000, true);
  // "a, b (c optional)" lists tools; each must be one the server has.
  const tools = c.tools_triggered.replace(/\(([a-z_]+) optional\)/g, ", $1").split(",").map((t) => t.trim()).filter(Boolean);
  check(`positive[${n}].tools_triggered are real tools`, tools.every((t) => TOOLS.has(t)), c.tools_triggered);
});
cases.negative.forEach((c, n) => check(`negative[${n}] fields`, filled(c, ["description", "prompt", "expected_behavior"])));
check("review has no test_credentials or reviewer_instructions", !("test_credentials" in openai.review) && !("reviewer_instructions" in openai.review));
check("publication.release_notes present", typeof openai.publication.release_notes === "string" && openai.publication.release_notes.trim() !== "");
for (const [locale, t] of Object.entries(openai.publication.translations)) {
  text(`translations.${locale}.subtitle`, t.subtitle, 30);
  text(`translations.${locale}.description`, t.description, 4000, true);
}

// Skills: front matter, size and relative links.
for (const skill of ["plugins/claude/skills/fortrip/SKILL.md", "skills/fortrip-cli/SKILL.md"]) {
  const source = read(skill);
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  check(`${skill} has front matter`, match);
  if (!match) continue;
  const fields = Object.fromEntries(
    match[1].split("\n").map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()]),
  );
  check(`${skill} name matches its folder`, fields.name === path.basename(path.dirname(skill)), fields.name);
  check(`${skill} name is lowercase-hyphen, no reserved words`, /^[a-z0-9-]{1,64}$/.test(fields.name) && !/claude|anthropic/.test(fields.name), fields.name);
  check(`${skill} description is 1–1024 characters, no XML tags`, fields.description && fields.description.length <= 1024 && !/<[^>]+>/.test(fields.description));
  const body = source.slice(match[0].length);
  check(`${skill} body is under 500 lines`, body.split("\n").length < 500, `${body.split("\n").length}`);
  for (const [, link] of body.matchAll(/\]\(([^)#:]+)\)/g)) {
    check(`${skill} link ${link} exists`, fs.existsSync(path.join(repo, path.dirname(skill), link)));
  }
}

// Repo-wide content rules.
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
    if ([".git", "node_modules", "scripts"].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(md|json|ya?ml)$/.test(entry.name) && entry.name !== "package-lock.json") files.push(file);
  }
})("");
// The hotel supplier is never named in anything the repository publishes:
// every tracked file (and any new one git doesn't ignore), whatever its type.
// The pattern is built from fragments so that this file doesn't name it either.
const SUPPLIER = new RegExp(["hui" + "zhi", "汇" + "智"].join("|"), "i");
const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: repo, encoding: "utf8" })
  .split("\0")
  .filter((f) => f && fs.existsSync(path.join(repo, f)));
const supplier = listed.filter((f) => SUPPLIER.test(read(f)));
check("no file names the hotel supplier", supplier.length === 0, supplier.join(", "));
// Anthropic Software Directory Policy §2F: the Claude plugin must not have
// Claude fetch instructions at run time (the CLI prints its own guide).
const fetching = files.filter((f) => f.startsWith(`plugins${path.sep}claude${path.sep}`) && /\bnpx\b|fortrip@latest|get_planning_guide/.test(read(f)));
check("plugins/claude/ never runs npx, fortrip@latest or get_planning_guide", fetching.length === 0, fetching.join(", "));
const readmeWords = read("plugins/claude/README.md").replace(/```[\s\S]*?```/g, "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
check("plugins/claude/README.md has at least 40 words outside code blocks", readmeWords >= 40, `${readmeWords}`);

console.log(failures ? `\n${failures} check(s) failed` : "All listing checks passed.");
process.exit(failures ? 1 : 0);
