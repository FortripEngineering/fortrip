import { ENVIRONMENT, type EnvVar } from "../../../cli/src/environment.ts";

/** A variable a reader sets: the CLI's, less those only Fortrip's own
 *  development uses. */
type PublicName = Extract<EnvVar, { internal: false }>["name"];

/** What each variable does. Keyed by the CLI's public variables, so one the
 *  CLI gains fails the typecheck until it is described. */
const MEANINGS: Record<PublicName, string> = {
  FORTRIP_TOKEN:
    "Use this access token instead of the saved sign-in. An access token is short-lived, so it suits a remote agent environment or a CI run; for longer, sign in.",
  FORTRIP_CURRENCY:
    "Default `--currency` for `hotels search` and `hotels offers`: prices and the order are in this currency.",
};

/** One row per variable a reader sets, in the CLI's order. */
export const ENVIRONMENT_ROWS: Array<{ name: PublicName; meaning: string }> = ENVIRONMENT.flatMap((variable) =>
  variable.internal ? [] : [{ name: variable.name, meaning: MEANINGS[variable.name] }],
);
