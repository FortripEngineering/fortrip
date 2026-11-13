import { EXIT, EXIT_BY_STATUS } from "../../../cli/src/exit-codes.ts";

type ExitName = keyof typeof EXIT;

/** How an error code the CLI doesn't know exits, from the CLI's own mapping:
 *  "400 → 2, 401 → 3, 429 → 4, any other status 1". */
const byStatus = [
  ...Object.entries(EXIT_BY_STATUS).map(([status, exit]) => `${status} → ${exit}`),
  `any other status ${EXIT.error}`,
].join(", ");

/** What each exit code means. Keyed by the CLI's exit names, so an exit code
 *  the CLI gains fails the typecheck until it is described. */
const MEANINGS: Record<ExitName, string> = {
  ok: "Success.",
  error: `Any other error. An error code the CLI doesn't know exits by its HTTP status: ${byStatus}.`,
  usage: "Invalid arguments, found by the CLI or answered as `invalid_request`.",
  unauthenticated:
    'Not signed in, or the saved sign-in is no longer accepted (`unauthenticated`). stderr normally includes `loginUrl` and `userCode`: show them to the user and rerun the command once they have approved. When `FORTRIP_TOKEN` is set and Fortrip rejects it, stderr has `tokenSource: "FORTRIP_TOKEN"` and no link: replace or unset the token.',
  rateLimited: "Rate limited (`rate_limited`). stderr includes `retryAfterSeconds`.",
  clientOutdated:
    "This version of the CLI is too old for Fortrip (`client_outdated`). stderr is Fortrip's message, with the command that updates the CLI: update it, then run the command again.",
};

/** One row per CLI exit code, in the CLI's order. */
export const EXIT_ROWS: Array<{ code: number; meaning: string }> = (Object.keys(EXIT) as ExitName[]).map(
  (name) => ({ code: EXIT[name], meaning: MEANINGS[name] }),
);
