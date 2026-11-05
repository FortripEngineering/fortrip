import { defineConfig } from "fumadocs-mdx/config";

import { remarkFacts } from "./lib/remark-facts.ts";

export default defineConfig({
  mdxOptions: {
    // Runs before Fumadocs' structure plugin, so the search index sees the values.
    remarkPlugins: [remarkFacts],
  },
});
