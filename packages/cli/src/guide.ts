import { readFile } from "node:fs/promises";

import { usageError } from "./errors.ts";
import { VERSION } from "./version.ts";

/** Relative to the package root: one level up from both `src/` and the
 *  bundled `dist/cli.js`. */
const GUIDES: Record<string, string> = {
  main: "../AGENT_GUIDE.md",
  planning: "../guides/planning.md",
};

/** The guides say `fortrip@latest`; printing them pins this version, so a
 *  release published mid-conversation can't change the CLI under the agent. */
export async function readGuide(topic = "main"): Promise<string> {
  const path = GUIDES[topic];
  if (!path) throw usageError("Usage: fortrip guide [planning]");
  const guide = await readFile(new URL(path, import.meta.url), "utf8");
  return guide.replaceAll("fortrip@latest", `fortrip@${VERSION}`);
}
