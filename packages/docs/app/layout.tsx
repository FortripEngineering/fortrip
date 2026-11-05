import "./global.css";

import { DOCS_ORIGIN } from "@fortrip/agent-contract";
import { Analytics } from "@vercel/analytics/next";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SITE } from "@/lib/site";
import { source } from "@/lib/source";

import { baseOptions } from "./layout.config.tsx";

export const metadata: Metadata = {
  metadataBase: new URL(DOCS_ORIGIN),
  title: { default: SITE.name, template: `%s | ${SITE.name}` },
  description: SITE.description,
  icons: { icon: "/favicon.svg" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>
          <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
            {children}
          </DocsLayout>
        </RootProvider>
        <Analytics />
      </body>
    </html>
  );
}
