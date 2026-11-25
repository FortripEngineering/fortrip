import { DOCS_ORIGIN, REPOSITORY_URL } from "@fortrip/agent-contract";
import { CopyMarkdownButton, OpenMenu } from "@/components/page-menus";
import { PostmanActions } from "@/components/postman-actions";
import { type Lang, UI } from "@/lib/i18n";
import { POSTMAN_FILENAME, POSTMAN_PATH } from "@/lib/openapi/postman";

const CONTENT_ON_GITHUB = `${REPOSITORY_URL}/blob/main/packages/docs/content/docs`;

/** Under a page's title: copy its Markdown, or open it on GitHub, as
 *  Markdown, or in an AI chat that reads it from the docs origin. A page
 *  without `source` (`content/docs/...`) is generated and has no file to open.
 *  A page of the HTTP API adds the API's Postman collection. */
export function PageActions({
  lang,
  url,
  markdownUrl,
  source,
  postman = false,
}: {
  lang: Lang;
  url: string;
  markdownUrl: string;
  source?: string;
  postman?: boolean;
}) {
  const t = UI[lang];
  return (
    <div className="mb-2 flex flex-row flex-wrap items-center gap-2 border-b pt-2 pb-6">
      <CopyMarkdownButton t={t} markdownUrl={markdownUrl} />
      <OpenMenu t={t} markdownUrl={markdownUrl} githubUrl={source && `${CONTENT_ON_GITHUB}/${source}`} pageUrl={`${DOCS_ORIGIN}${url}`} />
      {postman && <PostmanActions t={t} path={POSTMAN_PATH} url={`${DOCS_ORIGIN}${POSTMAN_PATH}`} filename={POSTMAN_FILENAME} />}
    </div>
  );
}
