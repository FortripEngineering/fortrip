import { createRelativeLink } from "fumadocs-ui/mdx";
import { flattenTree } from "fumadocs-core/page-tree";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OpenAPIPage } from "@/components/api-page";
import { getMDXComponents } from "@/components/mdx";
import { TOOL_RULES } from "@/lib/markdown/pages";
import { OPERATIONS } from "@/lib/openapi/build";
import { MCP_TOOLS } from "@/lib/reference/mcp-tools";
import { SITE } from "@/lib/site";
import { source } from "@/lib/source";

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
    // The short summary heads the page, and the body links the MCP tool's
    // page for the contract's full description, which openapi.json keeps.
    const tool = MCP_TOOLS.find((t) => t.name === OPERATIONS.find((op) => op.id === page.slugs.at(-1))?.endpoint.tool);
    return (
      <DocsPage toc={page.data.toc} full footer={{ items: neighbours(page.url) }}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          {tool && (
            <p>
              {TOOL_RULES[0]}
              <Link href={`/mcp/${tool.slug}`}>
                <code>{tool.name}</code>
              </Link>
              {TOOL_RULES[1]}
            </p>
          )}
          <OpenAPIPage {...page.data.getOpenAPIPageProps()} showDescription={false} />
        </DocsBody>
      </DocsPage>
    );
  }

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full} footer={{ items: neighbours(page.url) }}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
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
