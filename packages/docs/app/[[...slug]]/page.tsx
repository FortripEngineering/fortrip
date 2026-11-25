import { createRelativeLink } from "fumadocs-ui/mdx";
import { flattenTree } from "fumadocs-core/page-tree";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OpenAPIPage } from "@/components/api-page";
import { getMDXComponents } from "@/components/mdx";
import { PageActions } from "@/components/page-actions";
import { ModelReads, OperationSurfaces, SurfaceLinks } from "@/components/reference";
import { SiteFooter } from "@/components/site-footer";
import { markdownPath } from "@/lib/llms";
import { OPERATIONS } from "@/lib/openapi/build";
import { MCP_TOOLS } from "@/lib/reference/mcp-tools";
import { SITE } from "@/lib/site";
import { source } from "@/lib/source";

/** The written pages about the HTTP API, which offer its Postman collection
 *  as every operation's page does. */
const API_PAGES = new Set(["/api", "/api-quickstart"]);

/** The pages before and after `url` in sidebar order, as Fumadocs' footer
 *  lists them, by title only: a card shows the direction and the title. */
function neighbours(url: string) {
  const list = flattenTree(source.getPageTree().children).filter((node) => !node.external);
  const index = list.findIndex((node) => node.url === url);
  if (index === -1) return {};
  const item = (node: (typeof list)[number] | undefined) => node && { name: node.name, url: node.url };
  return { previous: item(list[index - 1]), next: item(list[index + 1]) };
}

export default async function Page(props: PageProps<"/[[...slug]]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  if (page.type === "openapi") {
    // The short summary heads the page, and the body quotes the tool's
    // description, the endpoint's full description, under its label. After
    // the HTTP request and responses come the MCP tool and the CLI command,
    // which a line at the top links to: the page has no table of contents.
    const tool = MCP_TOOLS.find((t) => t.name === OPERATIONS.find((op) => op.id === page.slugs.at(-1))?.endpoint.tool);
    return (
      <DocsPage toc={page.data.toc} full footer={{ component: <SiteFooter items={neighbours(page.url)} /> }}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
        <PageActions url={page.url} markdownUrl={markdownPath(page.url)} postman />
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
    <DocsPage toc={page.data.toc} full={page.data.full} footer={{ component: <SiteFooter items={neighbours(page.url)} /> }}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <PageActions
        url={page.url}
        markdownUrl={markdownPath(page.url)}
        source={page.type === "docs" ? page.path : undefined}
        postman={API_PAGES.has(page.url)}
      />
      <DocsBody>
        <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<"/[[...slug]]">): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const { title, description } = page.data;
  return {
    title,
    description,
    alternates: { canonical: page.url },
    openGraph: { type: "article", siteName: SITE.name, url: page.url, title, description },
  };
}
