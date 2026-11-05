import { DOCS_ORIGIN } from "@fortrip/agent-contract";
import type { MetadataRoute } from "next";

import { source } from "@/lib/source";

/** Every page, from the loader, on the docs origin. */
export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({ url: new URL(page.url, DOCS_ORIGIN).href }));
}
