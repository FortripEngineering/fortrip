import { DOCS_ORIGIN } from "@fortrip/agent-contract";
import type { InferPageType } from "fumadocs-core/source";
import { llms } from "fumadocs-core/source/llms";

import { operationMarkdown } from "./markdown/pages.ts";
import { SITE } from "./site.ts";
import { source } from "./source.ts";

type Page = InferPageType<typeof source>;

/** Where a page's Markdown is served: `/payments.md`, the root's `/index.md`. */
export function markdownPath(url: string): string {
  return `${url === "/" ? "/index" : url}.md`;
}

/** A page as Markdown: its title, its description, then its body with every
 *  component as text (`lib/remark-components.ts`). */
export async function pageMarkdown(page: Page): Promise<string> {
  let body: string;
  if (page.type === "docs") body = await page.data.getText("processed");
  else if (page.type === "reference") body = page.data.markdown();
  else body = operationMarkdown(page.slugs.at(-1) ?? "");
  const description = page.data.description ? [`> ${page.data.description}`] : [];
  return `${[`# ${page.data.title}`, ...description, body.trim()].join("\n\n")}\n`;
}

export const docsLlms = llms(source, { renderPage: pageMarkdown });

/**
 * `llms.txt`: the title, the summary, then the pages as the sidebar groups
 * them, a section per group, each linking to the page's Markdown on the docs
 * origin; last, the OpenAPI document.
 */
export function llmsIndex(): string {
  const groups = source.getPageTree().children.map((node) =>
    node.type === "separator" ? `\n## ${node.name}\n` : docsLlms.indexNode(node),
  );
  return [
    `# ${SITE.name}`,
    "",
    `> ${SITE.description}`,
    "",
    ...groups,
    "",
    "## OpenAPI",
    "",
    `- [OpenAPI 3.1 document](/openapi.json): the HTTP API's every request and response.`,
    "",
  ]
    .join("\n")
    .replace(/\]\((\/[^)]*)\)/g, (_, path: string) =>
      `](${DOCS_ORIGIN}${path.endsWith(".json") ? path : markdownPath(path)})`,
    );
}
