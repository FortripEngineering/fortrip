import { DOCS_ORIGIN } from "@fortrip/agent-contract";
import type { InferPageType } from "fumadocs-core/source";
import { llms } from "fumadocs-core/source/llms";

import { operationMarkdown } from "./markdown/pages.ts";
import { buildOpenApi } from "./openapi/build.ts";
import { SITE } from "./site.ts";
import { source } from "./source.ts";

type Page = InferPageType<typeof source>;

/** Where a page's Markdown is served: `/payments.md`, the root's `/index.md`. */
export function markdownPath(url: string): string {
  return `${url === "/" ? "/index" : url}.md`;
}

/** A link on the docs origin as `llms.txt` writes it: a page to its Markdown
 *  (keeping a `#section`), a file (`/openapi.json`) as it is. */
function absolute(path: string): string {
  const [pathname = "", hash] = path.split("#");
  const target = /\.\w+$/.test(pathname) ? pathname : markdownPath(pathname);
  return `${DOCS_ORIGIN}${target}${hash === undefined ? "" : `#${hash}`}`;
}

/** Markdown for reading off the site: headings without their Fumadocs anchor
 *  (`## Input [#input]`), and relative links (`/errors`, `#local-mcp`)
 *  absolute on the docs origin. Fenced code is left as it is. */
function offSite(markdown: string, url: string): string {
  return markdown
    .split(/^(```+[^\n]*\n[\s\S]*?^```+[ \t]*$)/m)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/^(#{1,6} .*?) \[#[^\]]+\][ \t]*$/gm, "$1")
            .replace(/\]\(([/#][^)]*)\)/g, (_, link: string) =>
              `](${absolute(link.startsWith("#") ? `${url}${link}` : link)})`,
            ),
    )
    .join("");
}

/** A page as Markdown: its title, its description, then its body with every
 *  component as text (`lib/remark-components.ts`). */
export async function pageMarkdown(page: Page): Promise<string> {
  let body: string;
  if (page.type === "docs") body = await page.data.getText("processed");
  else if (page.type === "reference") body = page.data.markdown();
  else body = operationMarkdown(page.slugs.at(-1) ?? "", page.data.description);
  const description = page.data.description ? [`> ${page.data.description}`] : [];
  return `${offSite([`# ${page.data.title}`, ...description, body.trim()].join("\n\n"), page.url)}\n`;
}

/** Fumadocs' llms.txt helper, for each sidebar node's link list. */
export const docsLlms = llms(source);

type TreeNode = ReturnType<typeof source.getPageTree>["children"][number];

/** The pages in sidebar order: a folder's index, then its children. */
export function sidebarPages(nodes: TreeNode[] = source.getPageTree().children): Page[] {
  return nodes.flatMap((node): Page[] => {
    if (node.type === "separator") return [];
    if (node.type === "page") return [source.getNodePage(node)].filter((p) => p !== undefined);
    const index = node.index ? sidebarPages([node.index]) : [];
    return [...index, ...sidebarPages(node.children)];
  });
}

/** `llms-full.txt`: every page's Markdown, in sidebar order. */
export async function llmsFull(): Promise<string> {
  return (await Promise.all(sidebarPages().map(pageMarkdown))).join("\n\n");
}

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
    `- [OpenAPI ${buildOpenApi().openapi} document](/openapi.json): the HTTP API's every request and response.`,
    "",
  ]
    .join("\n")
    .replace(/\]\((\/[^)]*)\)/g, (_, path: string) => `](${absolute(path)})`);
}
