// What is wrong with the MCP Registry entry (plugins/registry/server.json)
// next to the package it lists: the CLI at packages/cli. Used by validate.mjs;
// a function of two parsed files so that a test can feed it both.

/**
 * @param {{ name?: string, packages?: { registryType?: string, identifier?: string, version?: string }[] }} server
 * @param {{ name: string, version: string, mcpName?: string }} cli (the MCP Registry requires `mcpName` on the package it lists)
 * @returns {string[]} one line per problem; empty when the entry matches
 */
export function registryEntryProblems(server, cli) {
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
  return problems;
}
