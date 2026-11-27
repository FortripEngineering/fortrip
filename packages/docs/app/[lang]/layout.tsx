import "../global.css";

import { DOCS_ORIGIN } from "@fortrip/agent-contract";
import { Analytics } from "@vercel/analytics/next";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { defineI18nUI } from "fumadocs-ui/i18n";
import { GeistMono } from "geist/font/mono";
import type { Metadata } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Provider } from "@/components/provider";
import { FUMADOCS_ZH, i18n, isLang, UI } from "@/lib/i18n";
import { SITE } from "@/lib/site";
import { source } from "@/lib/source";

import { baseOptions } from "./layout.config.tsx";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const interTight = Inter_Tight({ subsets: ["latin"], variable: "--font-inter-tight" });

const i18nUI = defineI18nUI(i18n, { en: { displayName: UI.en.languageName }, zh: FUMADOCS_ZH });

export async function generateMetadata(props: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await props.params;
  return {
    metadataBase: new URL(DOCS_ORIGIN),
    title: { default: SITE.name, template: `%s | ${SITE.name}` },
    description: isLang(lang) ? UI[lang].siteDescription : SITE.description,
    icons: { icon: "/favicon.svg" },
  };
}

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

export default async function Layout({ params, children }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <html lang={UI[lang].htmlLang} className={`${inter.variable} ${interTight.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider i18n={i18nUI.provider(lang)}>
          <DocsLayout tree={source.getPageTree(lang)} {...baseOptions(lang)}>
            {children}
          </DocsLayout>
        </Provider>
        <Analytics />
      </body>
    </html>
  );
}
