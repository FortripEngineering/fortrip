import { PageFooter } from "fumadocs-ui/layouts/docs/page";
import type { ComponentProps } from "react";

import { type Lang, localize, UI } from "@/lib/i18n";
import { FOOTER_LINKS } from "@/lib/site";

/** The previous and next pages, then the links every page ends with, in the
 *  page's language. */
export function SiteFooter({ lang, ...props }: ComponentProps<typeof PageFooter> & { lang: Lang }) {
  return (
    <>
      <PageFooter {...props} />
      <footer className="mt-8 flex flex-wrap gap-x-4 gap-y-1 border-t pt-4 text-sm text-fd-muted-foreground">
        {FOOTER_LINKS.map((link) => (
          <a key={link.key} href={link.url.startsWith("/") ? localize(lang, link.url) : link.url} className="hover:text-fd-foreground">
            {UI[lang][link.key]}
          </a>
        ))}
      </footer>
    </>
  );
}
