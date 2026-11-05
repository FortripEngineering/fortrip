import "./global.css";

import { Analytics } from "@vercel/analytics/next";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { source } from "@/lib/source";

import { baseOptions } from "./layout.config.tsx";

export const metadata: Metadata = {
  metadataBase: new URL("https://docs.fortrip.ai"),
  title: { default: "Fortrip Docs", template: "%s | Fortrip Docs" },
  description: "Connect an AI agent to Fortrip to search, price and book hotels.",
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
