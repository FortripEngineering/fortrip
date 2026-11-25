import { DOCS_ORIGIN } from "@fortrip/agent-contract";
import { MarkdownCopyButton, ViewOptionsPopover } from "fumadocs-ui/layouts/docs/page";

const CONTENT_ON_GITHUB = "https://github.com/fortripengineering/fortrip/blob/main/packages/docs/content/docs";

/** Under a page's title: copy its Markdown, or open it on GitHub, as
 *  Markdown, or in an AI chat that reads it from the docs origin. A page
 *  without `source` (`content/docs/...`) is generated and has no file to open. */
export function PageActions({ url, markdownUrl, source }: { url: string; markdownUrl: string; source?: string }) {
  return (
    <div className="flex flex-row flex-wrap items-center gap-2 border-b pb-6">
      <MarkdownCopyButton markdownUrl={markdownUrl} />
      <ViewOptionsPopover
        markdownUrl={markdownUrl}
        githubUrl={source && `${CONTENT_ON_GITHUB}/${source}`}
        pageUrl={`${DOCS_ORIGIN}${url}`}
      />
    </div>
  );
}
