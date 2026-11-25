import { notFound } from "next/navigation";

import { i18n, isLang, type Lang } from "@/lib/i18n";
import { pageMarkdown } from "@/lib/llms";
import { source } from "@/lib/source";

// `/payments.md` and `/zh/payments.md` are rewritten here (next.config.mjs);
// built for every page in every language.
export const dynamic = "force-static";
// Only the pages built below: any other `.md` is a 404.
export const dynamicParams = false;

/** A Markdown path's language and page slugs: `zh/payments` is the Chinese
 *  page, and a language's root page is its `index`. */
function parse(slug: string[]): { lang: Lang; slugs: string[] } {
  const [first, ...rest] = slug;
  const prefixed = first !== undefined && first !== i18n.defaultLanguage && isLang(first);
  const lang = prefixed ? first : i18n.defaultLanguage;
  const slugs = prefixed ? rest : slug;
  return { lang, slugs: slugs.length === 1 && slugs[0] === "index" ? [] : slugs };
}

export async function GET(_request: Request, { params }: RouteContext<"/llms.md/[...slug]">) {
  const { lang, slugs } = parse((await params).slug);
  const page = source.getPage(slugs, lang);
  if (!page) notFound();
  return new Response(await pageMarkdown(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export function generateStaticParams() {
  return i18n.languages.flatMap((lang) =>
    source.getPages(lang).map((page) => {
      const slugs = page.slugs.length > 0 ? page.slugs : ["index"];
      return { slug: lang === i18n.defaultLanguage ? slugs : [lang, ...slugs] };
    }),
  );
}
