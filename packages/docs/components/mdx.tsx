import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps, FC } from "react";

import { type Lang, localizeHref } from "@/lib/i18n";

import { Example } from "./example.tsx";
import { CommandPage, Fields } from "./reference.tsx";

/** The components a page renders. The data components an MDX page names
 *  (`<PayWays />`, `<EndpointTable />` …) are expanded into Markdown at
 *  compile time by `lib/remark-components.ts`; what stays JSX is here. */
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    CommandPage,
    Example,
    Fields,
    ...components,
  } satisfies MDXComponents;
}

/** A page's components in its language: the links it writes to other pages
 *  (`/payments`, a card's `href`) go to those pages in the same language. */
export function localizedComponents(lang: Lang, Link: FC<ComponentProps<"a">>) {
  const { Card } = defaultMdxComponents;
  return getMDXComponents({
    a: (props: ComponentProps<"a">) => <Link {...props} href={localizeHref(lang, props.href)} />,
    Card: (props: ComponentProps<typeof Card>) => <Card {...props} href={localizeHref(lang, props.href)} />,
  });
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
