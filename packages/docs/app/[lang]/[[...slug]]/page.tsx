import { REPOSITORY_URL } from "@fortrip/agent-contract";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { flattenTree } from "fumadocs-core/page-tree";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OpenAPIPage } from "@/components/api-page";
import { localizedComponents } from "@/components/mdx";
import { PageActions } from "@/components/page-actions";
import { PageControls } from "@/components/page-controls";
import { ModelReads, OperationSurfaces, SurfaceLinks } from "@/components/reference";
import { SiteFooter } from "@/components/site-footer";
import { markdownPath } from "@/lib/llms";
import { OPERATIONS } from "@/lib/openapi/build";
import { MCP_TOOLS } from "@/lib/reference/mcp-tools";
import { i18n, isLang, type Lang, UI } from "@/lib/i18n";
import { SITE } from "@/lib/site";
import { isTranslated, source } from "@/lib/source";

/** The written pages about the HTTP API, by slug, which offer its Postman
 *  collection as every operation's page does. */
const API_PAGES = new Set(["api", "api-quickstart"]);

/** The pages before and after `url` in sidebar order, as Fumadocs' footer
 *  lists them, by title only: a card shows the direction and the title. */
function neighbours(url: string, lang: Lang) {
  const list = flattenTree(source.getPageTree(lang).children).filter((node) => !node.external);
  const index = list.findIndex((node) => node.url === url);
  if (index === -1) return {};
  const item = (node: (typeof list)[number] | undefined) => node && { name: node.name, url: node.url };
  return { previous: item(list[index - 1]), next: item(list[index + 1]) };
}

/** Above a page shown in a language it isn't written in: it is the default
 *  language's page. */
function Untranslated({ lang }: { lang: Lang }) {
  return <p className="rounded-lg border bg-fd-card px-4 py-3 text-sm text-fd-muted-foreground">{UI[lang].untranslated}</p>;
}

/** The language and theme controls on a page with no table of contents: its
 *  top right corner, inside the page's padding, level with the breadcrumb. */
const TOP_RIGHT = "absolute end-4 top-6 md:end-6 md:top-8 xl:end-8 xl:top-14";

/** The page at `slug` in `lang`, or a 404. */
function pageOf(lang: string, slug: string[] | undefined) {
  const page = isLang(lang) ? source.getPage(slug, lang) : undefined;
  if (!page) notFound();
  return { page, lang: lang as Lang };
}

export default async function Page(props: PageProps<"/[lang]/[[...slug]]">) {
  const params = await props.params;
  const { page, lang } = pageOf(params.lang, params.slug);

  if (page.type === "openapi") {
    // The short summary heads the page, and the body quotes the tool's
    // description, the endpoint's full description, under its label. After
    // the HTTP request and responses come the MCP tool and the CLI command,
    // which a line at the top links to: the page has no table of contents.
    const tool = MCP_TOOLS.find((t) => t.name === OPERATIONS.find((op) => op.id === page.slugs.at(-1))?.endpoint.tool);
    return (
      <DocsPage
        toc={page.data.toc}
        full
        className="relative"
        footer={{ component: <SiteFooter lang={lang} items={neighbours(page.url, lang)} /> }}
      >
        <PageControls repositoryUrl={REPOSITORY_URL} className={TOP_RIGHT} />
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
        <PageActions lang={lang} url={page.url} markdownUrl={markdownPath(page.url)} postman />
        {!isTranslated(page) && <Untranslated lang={lang} />}
        <DocsBody>
          {tool && <SurfaceLinks name={tool.name} />}
          {tool && <ModelReads description={tool.summary} />}
          <OpenAPIPage {...page.data.getOpenAPIPageProps()} showDescription={false} />
          {tool && <OperationSurfaces name={tool.name} />}
        </DocsBody>
      </DocsPage>
    );
  }

  const MDX = page.data.body;

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      className="relative"
      tableOfContent={{ header: <PageControls repositoryUrl={REPOSITORY_URL} className="mb-6" /> }}
      footer={{ component: <SiteFooter lang={lang} items={neighbours(page.url, lang)} /> }}
    >
      {/* Where the table of contents is hidden, the controls head the page. */}
      <PageControls repositoryUrl={REPOSITORY_URL} className={page.data.full ? TOP_RIGHT : "xl:hidden"} />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <PageActions
        lang={lang}
        url={page.url}
        markdownUrl={markdownPath(page.url)}
        source={page.type === "docs" ? page.path : undefined}
        postman={API_PAGES.has(page.slugs.join("/"))}
      />
      {!isTranslated(page) && <Untranslated lang={lang} />}
      <DocsBody>
        <MDX components={localizedComponents(lang, createRelativeLink(source, page))} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<"/[lang]/[[...slug]]">): Promise<Metadata> {
  const params = await props.params;
  const { page, lang } = pageOf(params.lang, params.slug);

  // A page with no translation is the default language's: that is canonical,
  // and only the languages the page is written in are its alternates.
  const translations = i18n.languages.flatMap((l) => {
    const other = source.getPage(page.slugs, l);
    return other && isTranslated(other) ? [other] : [];
  });
  const canonical = isTranslated(page) ? page.url : (source.getPage(page.slugs, i18n.defaultLanguage)?.url ?? page.url);
  const { title, description } = page.data;
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: Object.fromEntries(translations.map((other) => [UI[other.locale as Lang].htmlLang, other.url])),
    },
    openGraph: { type: "article", siteName: SITE.name, url: page.url, title, description, locale: UI[lang].htmlLang },
  };
}
