import { defineConfig } from "tsup";

export default defineConfig({
  // `guest-name` is its own module so browser code can import the guest-name rule
  // without pulling the zod schemas the root bundle builds at load.
  entry: { index: "src/index.ts", "guest-name": "src/guest-name.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: true,
  clean: true,
});
