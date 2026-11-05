import { DOCS_ORIGIN } from "@fortrip/agent-contract";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${DOCS_ORIGIN}/sitemap.xml`,
  };
}
