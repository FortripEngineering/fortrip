import { readFileSync } from "node:fs";

/** From the package root, one level up from both `src/` and `dist/cli.js`,
 *  so `npm version` is the only place a release bumps it. */
export const VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

/** What the CLI calls itself on every request it sends: its HTTP calls and
 *  its MCP bridge. The service reads the version from it, to tell a CLI that
 *  is too old to update (`client_outdated`). */
export const USER_AGENT = `fortrip-cli/${VERSION}`;
