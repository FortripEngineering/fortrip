import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { Fact } from "./fact.tsx";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Fact,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
