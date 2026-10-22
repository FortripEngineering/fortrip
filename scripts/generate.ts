/*
 * Renders the files that come from the agent contract (`packages/contract`):
 *
 * - the two skills, `plugins/claude/skills/fortrip` and `skills/fortrip-cli`,
 *   each a `SKILL.md` (the front matter below plus the contract's main guide
 *   for that surface) and a `references/planning.md` (its planning guide);
 * - the contract's `src/guide-data.generated.ts`, the guide fragments inlined
 *   by `packages/contract/scripts/embed-guide.ts`.
 *
 *     pnpm generate                write them
 *     pnpm generate --check        exit 1 with a unified diff when any of
 *                                  them differs from a fresh render (CI)
 *     --root <dir>                 read and write <dir> instead of the
 *                                  repository (the tests use it)
 *
 * The contract is imported from its source, so this needs no build first.
 * To change a skill's wording, edit `packages/contract/guide/*.md`; to change
 * its front matter, edit `SKILLS` here. Never edit a generated file.
 */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { embeddedGuide } from "../packages/contract/scripts/embed-guide.ts";
import type { GuideSurface } from "../packages/contract/src/index.ts";

const GUIDE_DATA = "packages/contract/src/guide-data.generated.ts";

const SKILLS: readonly {
  dir: string;
  surface: GuideSurface;
  name: string;
  description: string;
}[] = [
  {
    dir: "plugins/claude/skills/fortrip",
    surface: "claude-skill",
    name: "fortrip",
    description:
      "Finds, compares, prices and books hotel stays with Fortrip's MCP tools (search_hotels, get_hotel, get_rates, create_booking), from hotel search to a booking payment link. Use when those tools are available and the user wants to find, compare, price or book a hotel stay, including flexible dates, budgets, split stays or several destinations. Not for flights, activities, changing or cancelling an existing booking, or coding work.",
  },
  {
    dir: "skills/fortrip-cli",
    surface: "cli",
    name: "fortrip-cli",
    description:
      "Searches hotels, compares live room rates and creates a hotel booking with a payment link through the Fortrip command-line tool (npx fortrip). Use when the user wants to find, compare, price or book a hotel stay through Fortrip, you can run shell commands, and Fortrip's MCP tools (search_hotels, get_rates, create_booking) aren't available. Not for flights, activities or changing an existing booking.",
  },
];

let check = false;
let root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
for (let n = 0; n < args.length; n++) {
  const arg = args[n];
  if (arg === "--check") {
    check = true;
  } else if (arg === "--root" && args[n + 1] !== undefined) {
    root = path.resolve(args[++n] as string);
  } else {
    console.error(
      `Unknown option ${arg}\nUsage: generate.ts [--check] [--root <dir>]`,
    );
    process.exit(2);
  }
}

const stale: string[] = [];

/** Writes `text` to `file` (relative to the root), or with `--check` prints
 *  how the file on disk differs from it. */
async function update(file: string, text: string): Promise<void> {
  const target = path.join(root, file);
  const current = await readFile(target, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (current === text) return;
  if (check) {
    stale.push(file);
    console.log(await unifiedDiff(file, current ?? "", text));
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
  console.log(`Wrote ${file}`);
}

/** A unified diff, from git, so it doesn't depend on the `diff` on PATH. */
async function unifiedDiff(file: string, before: string, after: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "fortrip-generate-"));
  try {
    for (const [side, text] of [["a", before], ["b", after]] as const) {
      await mkdir(path.dirname(path.join(dir, side, file)), { recursive: true });
      await writeFile(path.join(dir, side, file), text);
    }
    const run = spawnSync(
      "git",
      [
        "diff",
        "--no-index",
        "--no-color",
        "--no-ext-diff",
        "--src-prefix=",
        "--dst-prefix=",
        `a/${file}`,
        `b/${file}`,
      ],
      { cwd: dir, encoding: "utf8" },
    );
    // git exits 1 when the files differ and 128 or more on trouble.
    if (run.status !== 1) {
      throw new Error(`git diff failed: ${run.error ?? run.stderr}`);
    }
    return run.stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// First, so that the contract below renders from the fresh fragments.
await update(GUIDE_DATA, await embeddedGuide());

const { renderGuide } = await import("../packages/contract/src/index.ts");
for (const { dir, surface, name, description } of SKILLS) {
  await update(
    `${dir}/SKILL.md`,
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${renderGuide(surface, "main")}`,
  );
  await update(`${dir}/references/planning.md`, renderGuide(surface, "planning"));
}

if (stale.length > 0) {
  console.error(
    `${stale.length} generated file(s) out of date: ${stale.join(", ")}\nRun \`pnpm generate\` and commit the result.`,
  );
  process.exit(1);
}
if (check) console.log("Generated files are up to date.");
