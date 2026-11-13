import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // The contract (a workspace package) and zod, which the contract builds its
  // command specs with, are bundled. The MCP SDK that `fortrip mcp` bridges
  // with is the one runtime dependency: `dependencies` stay external.
  noExternal: ["@fortrip/agent-contract", "zod"],
});
