import pkg from "../package.json" with { type: "json" };

/** The contract's version, from package.json, the one place a release bumps it. */
export const CONTRACT_VERSION: string = pkg.version;
