import { defineConfig } from "fumadocs-mdx/config";

import { remarkComponents } from "./lib/remark-components.ts";
import { remarkFacts } from "./lib/remark-facts.ts";

export default defineConfig({
  mdxOptions: {
    // Both run before Fumadocs' structure and Markdown plugins, so the search
    // index and each page's Markdown see the values and the expanded components.
    remarkPlugins: [remarkFacts, remarkComponents],
  },
});
