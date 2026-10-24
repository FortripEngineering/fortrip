// What is wrong with the MCP Registry entry (plugins/registry/server.json)
// next to the package it lists: the CLI at packages/cli. Used by validate.mjs;
// a function of parsed files so that a test can feed it all of them.

/** `a.b.c` as numbers, or null for anything else. */
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  return match ? match.slice(1).map(Number) : null;
}

/** Whether version `a` is greater than version `b` (both `a.b.c`). */
function isGreater(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/**
 * @param {{ name?: string, packages?: { registryType?: string, identifier?: string, version?: string }[] }} server
 * @param {{ name: string, version: string, mcpName?: string }} cli (the MCP Registry requires `mcpName` on the package it lists)
 * @param {{ version?: string } | undefined} [published] the entry on origin/main, when it can be read: the Registry rejects a version that is not greater than the one it has, so a changed entry must raise `version`
 * @returns {string[]} one line per problem; empty when the entry matches
 */
export function registryEntryProblems(server, cli, published) {
  const problems = [];
  const entry = server.packages?.find(
    (candidate) => candidate.registryType === "npm" && candidate.identifier === cli.name,
  );
  if (!entry) {
    problems.push(`packages[] has no npm entry for ${cli.name}`);
  } else if (entry.version !== cli.version) {
    problems.push(
      `packages[] lists ${cli.name}@${entry.version}, but packages/cli is ${cli.version}`,
    );
  }
  if (cli.mcpName !== server.name) {
    problems.push(
      `packages/cli mcpName is ${cli.mcpName}, but the registry entry is named ${server.name}`,
    );
  }
  // An entry that is the published one is not a new publish, so only a
  // changed entry has to raise the version.
  if (published && JSON.stringify(published) !== JSON.stringify(server)) {
    const next = parseVersion(server.version);
    const current = parseVersion(published.version);
    if (!next) {
      problems.push(`the entry's version ${server.version} is not a.b.c`);
    } else if (current && !isGreater(next, current)) {
      problems.push(
        `the entry's version is ${server.version}, which is not greater than ${published.version} on origin/main`,
      );
    }
  }
  return problems;
}
