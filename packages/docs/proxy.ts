import { createI18nMiddleware } from "fumadocs-core/i18n/middleware";

import { i18n } from "@/lib/i18n";

export const proxy = createI18nMiddleware(i18n);

export const config = {
  // Pages only: not the search API, Next's files, or any path with a dot
  // (`/llms.txt`, `/openapi.json`, `/quickstart.md`, `/fortrip-logo.svg`).
  matcher: ["/((?!api/|_next/|_vercel/|.*\\.).*)"],
};
