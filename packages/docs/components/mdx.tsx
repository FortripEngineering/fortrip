import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { Example } from "./example.tsx";
import { CommandPage, Fields, ToolPage } from "./reference.tsx";

/** The components a page renders. The data components an MDX page names
 *  (`<PayWays />`, `<EndpointTable />` …) are expanded into Markdown at
 *  compile time by `lib/remark-components.ts`; what stays JSX is here. */
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    CommandPage,
    Example,
    Fields,
    ToolPage,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
