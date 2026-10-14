import { readFileSync } from "node:fs";

/** From the package root, one level up from both `src/` and `dist/cli.js`,
 *  so `npm version` is the only place a release bumps it. */
export const VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
