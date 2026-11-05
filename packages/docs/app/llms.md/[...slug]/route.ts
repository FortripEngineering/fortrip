import { notFound } from "next/navigation";

import { pageMarkdown } from "@/lib/llms";
import { source } from "@/lib/source";

// `/payments.md` is rewritten here (next.config.mjs); built for every page.
export const dynamic = "force-static";
// Only the pages built below: any other `.md` is a 404.
export const dynamicParams = false;

/** The root page's Markdown is `/index.md`. */
const slugsOf = (slug: string[]) => (slug.length === 1 && slug[0] === "index" ? [] : slug);

export async function GET(_request: Request, { params }: RouteContext<"/llms.md/[...slug]">) {
  const page = source.getPage(slugsOf((await params).slug));
  if (!page) notFound();
  return new Response(await pageMarkdown(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: page.slugs.length > 0 ? page.slugs : ["index"] }));
}
