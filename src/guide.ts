import { readFile } from "node:fs/promises";

/** `AGENT_GUIDE.md` at the package root: one level up from both `src/` and
 *  the bundled `dist/cli.js`. */
export function readGuide(): Promise<string> {
  return readFile(new URL("../AGENT_GUIDE.md", import.meta.url), "utf8");
}
