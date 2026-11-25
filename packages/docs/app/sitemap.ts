import { DOCS_ORIGIN } from "@fortrip/agent-contract";
import type { MetadataRoute } from "next";

import { i18n, UI } from "@/lib/i18n";
import { isTranslated, source } from "@/lib/source";

/** Every page, from the loader, on the docs origin: the default language's
 *  pages, and each translation, which the default page lists as an alternate. */
export default function sitemap(): MetadataRoute.Sitemap {
  const url = (path: string) => new URL(path, DOCS_ORIGIN).href;
  return i18n.languages.flatMap((lang) =>
    source
      .getPages(lang)
      .filter(isTranslated)
      .map((page) => {
        const translations = i18n.languages.flatMap((l) => {
          const other = source.getPage(page.slugs, l);
          return other && isTranslated(other) ? [[UI[l].htmlLang, url(other.url)] as const] : [];
        });
        return {
          url: url(page.url),
          ...(translations.length > 1 && { alternates: { languages: Object.fromEntries(translations) } }),
        };
      }),
  );
}
