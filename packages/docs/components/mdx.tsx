import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { ClientSetup, RemoteMcpTable } from "./client-setup.tsx";
import { PreReleasePolicy } from "./compatibility.tsx";
import { Example } from "./example.tsx";
import { OrderStatuses, PaymentStatuses } from "./order-statuses.tsx";
import { PayInputs, PayWays } from "./pay-ways.tsx";
import {
  CommandList,
  CommandPage,
  DestinationFields,
  EndpointTable,
  ErrorCodes,
  FilterableAmenities,
  GlobalFlags,
  LimitsTable,
  McpContentTable,
  NextStepTools,
  OtherDisplayCurrencies,
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
    NextStepTools,
    OrderStatuses,
    OtherDisplayCurrencies,
    PayInputs,
    PaymentStatuses,
    PayWays,
    PreReleasePolicy,
    RemoteMcpTable,
    CommandPage,
    ErrorCodes,
    Example,
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
