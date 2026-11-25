"use client";
import { FrameworkProvider } from "fumadocs-core/framework";
import { RootProvider } from "fumadocs-ui/provider/base";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import type { ComponentProps } from "react";

import { i18n } from "@/lib/i18n";

const DEFAULT_PREFIX = `/${i18n.defaultLanguage}`;

/** The page's path as its links write it. The proxy serves `/quickstart` from
 *  `/en/quickstart`, which is the path a page is prerendered at; without this
 *  the sidebar and the TOC would match no link in the prerendered HTML. */
function useLinkPathname(): string {
  const pathname = usePathname();
  if (pathname === DEFAULT_PREFIX) return "/";
  return pathname.startsWith(`${DEFAULT_PREFIX}/`) ? pathname.slice(DEFAULT_PREFIX.length) : pathname;
}

function NextLink({ href = "", ...props }: ComponentProps<"a"> & { prefetch?: boolean }) {
  return <Link href={href} {...props} />;
}

/** Fumadocs' Next.js root provider, with the path above. */
export function Provider(props: ComponentProps<typeof RootProvider>) {
  return (
    <FrameworkProvider usePathname={useLinkPathname} useRouter={useRouter} useParams={useParams} Link={NextLink}>
      <RootProvider {...props} />
    </FrameworkProvider>
  );
}
