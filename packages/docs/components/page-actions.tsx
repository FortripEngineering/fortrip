import { DOCS_ORIGIN, REPOSITORY_URL } from "@fortrip/agent-contract";
import type { InferPageType } from "fumadocs-core/source";
import { MarkdownCopyButton, ViewOptionsPopover } from "fumadocs-ui/layouts/docs/page";

import { markdownPath } from "@/lib/llms";
import type { source } from "@/lib/source";

/** Where the written pages are in the repository, on its default branch. */
const CONTENT_URL = `${REPOSITORY_URL}/blob/main/packages/docs/content/docs`;

/** What a page's actions point to: its Markdown on this site, that Markdown on
 *  the docs origin for an assistant to read, and its source on GitHub when the
 *  page is written rather than generated. */
export function pageActionUrls(page: Pick<InferPageType<typeof source>, "type" | "url" | "path">) {
  const markdownUrl = markdownPath(page.url);
  return {
    markdownUrl,
    pageUrl: `${DOCS_ORIGIN}${markdownUrl}`,
    githubUrl: page.type === "docs" ? `${CONTENT_URL}/${page.path}` : undefined,
  };
}

/** Under a page's description: a button that copies the page's Markdown, and
 *  a menu that opens the page on GitHub, as Markdown or in an AI assistant. */
export function PageActions({ page }: { page: InferPageType<typeof source> }) {
  const { markdownUrl, pageUrl, githubUrl } = pageActionUrls(page);
  return (
    <div className="flex flex-row flex-wrap items-center gap-2 border-b pb-6">
      <MarkdownCopyButton markdownUrl={markdownUrl} />
      <ViewOptionsPopover markdownUrl={markdownUrl} githubUrl={githubUrl} pageUrl={pageUrl} />
    </div>
  );
}
