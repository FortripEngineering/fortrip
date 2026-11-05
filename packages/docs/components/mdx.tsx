import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { ClientSetup, RemoteMcpTable } from "./client-setup.tsx";
import { PayWays } from "./pay-ways.tsx";
import {
  CommandList,
  DestinationFields,
  EndpointTable,
  FilterableAmenities,
  McpContentTable,
  OtherDisplayCurrencies,
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
    ClientSetup,
    CommandList,
    DestinationFields,
    EndpointTable,
    FilterableAmenities,
    McpContentTable,
    OtherDisplayCurrencies,
    PayWays,
    RemoteMcpTable,
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
