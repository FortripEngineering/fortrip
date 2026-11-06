import { defineConfig } from "fumadocs-mdx/config";

import { remarkComponents } from "./lib/remark-components.ts";
import { remarkFacts } from "./lib/remark-facts.ts";
import { remarkPackageNotes } from "./lib/remark-package-notes.ts";

export default defineConfig({
  mdxOptions: {
    // All run before Fumadocs' structure and Markdown plugins, so the search
    // index and each page's Markdown see the values and the expanded
    // components, and not the changelog's notes on the contract package.
    remarkPlugins: [remarkPackageNotes, remarkFacts, remarkComponents],
  },
});
