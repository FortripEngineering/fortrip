import { DOCS_ORIGIN } from "@fortrip/agent-contract";
import { MarkdownCopyButton, ViewOptionsPopover } from "fumadocs-ui/layouts/docs/page";

import { PostmanActions } from "@/components/postman-actions";
import { POSTMAN_FILENAME, POSTMAN_PATH } from "@/lib/openapi/postman";

const CONTENT_ON_GITHUB = "https://github.com/fortripengineering/fortrip/blob/main/packages/docs/content/docs";

/** Under a page's title: copy its Markdown, or open it on GitHub, as
 *  Markdown, or in an AI chat that reads it from the docs origin. A page
 *  without `source` (`content/docs/...`) is generated and has no file to open.
 *  A page of the HTTP API adds the API's Postman collection. */
export function PageActions({
  url,
  markdownUrl,
  source,
  postman = false,
}: {
  url: string;
  markdownUrl: string;
  source?: string;
  postman?: boolean;
}) {
  return (
    <div className="mb-2 flex flex-row flex-wrap items-center gap-2 border-b pt-2 pb-6">
      <MarkdownCopyButton markdownUrl={markdownUrl} />
      <ViewOptionsPopover
        markdownUrl={markdownUrl}
        githubUrl={source && `${CONTENT_ON_GITHUB}/${source}`}
        pageUrl={`${DOCS_ORIGIN}${url}`}
      />
      {postman && <PostmanActions path={POSTMAN_PATH} url={`${DOCS_ORIGIN}${POSTMAN_PATH}`} filename={POSTMAN_FILENAME} />}
    </div>
  );
}
