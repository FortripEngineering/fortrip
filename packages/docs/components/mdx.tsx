import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import {
  CommandList,
  CommandPage,
  ErrorCodes,
  GlobalFlags,
  LimitsTable,
  RateLimitsTable,
  RawBodyExample,
  RegionList,
  SchemaTables,
  ToolList,
  ToolPage,
} from "./reference.tsx";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    CommandList,
    CommandPage,
    ErrorCodes,
    GlobalFlags,
    LimitsTable,
    RateLimitsTable,
    RawBodyExample,
    RegionList,
    SchemaTables,
    ToolList,
    ToolPage,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
