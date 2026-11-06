import { PageFooter } from "fumadocs-ui/layouts/docs/page";
import type { ComponentProps } from "react";

import { FOOTER_LINKS } from "@/lib/site";

/** The previous and next pages, then the links every page ends with. */
export function SiteFooter(props: ComponentProps<typeof PageFooter>) {
  return (
    <>
      <PageFooter {...props} />
      <footer className="mt-8 flex flex-wrap gap-x-4 gap-y-1 border-t pt-4 text-sm text-fd-muted-foreground">
        {FOOTER_LINKS.map((link) => (
          <a key={link.text} href={link.url} className="hover:text-fd-foreground">
            {link.text}
          </a>
        ))}
      </footer>
    </>
  );
}
