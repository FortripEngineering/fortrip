// Search records of the trees data components expand into, shaped like the
// ones Fumadocs' remark-structure makes of authored Markdown.
import type { StructuredData } from "fumadocs-core/mdx-plugins";
import { tableRowToStructuredData } from "fumadocs-core/search";
import type { PhrasingContent } from "mdast";

import type { Block, Widget } from "./mdast.ts";
import { phrasing } from "./stringify.ts";
import { attributesOf, WIDGETS } from "./widgets.ts";

type Content = StructuredData["contents"][number];

/** Links written as their text, as Fumadocs' remark-structure writes them. */
function unlinked(nodes: PhrasingContent[]): PhrasingContent[] {
  return nodes.flatMap((node) =>
    node.type === "link" ? unlinked(node.children) : node.type === "strong" ? [{ ...node, children: unlinked(node.children) }] : [node],
  );
}

/** A record's text: Markdown, with links as their text. */
const recordText = (nodes: PhrasingContent[]) => phrasing(unlinked(nodes)).trim();

/**
 * A record per paragraph, list item, table row and heading. A record under a
 * heading with an id links to it; the others take the heading before the
 * component. `table` names the component's tables, unique in its page.
 */
export function toContents(blocks: Block[], table: string): Content[] {
  const contents: Content[] = [];
  let heading: string | undefined;
  let tables = 0;
  const add = (children: PhrasingContent[]) => {
    const content = recordText(children);
    if (content) contents.push({ heading, content });
  };
  const visit = (nodes: Block[]) => {
    for (const node of nodes) {
      if (node.type === "mdxJsxFlowElement") {
        const widget = WIDGETS[node.name ?? ""];
        if (widget?.searchable) visit(widget.blocks(attributesOf(node as Widget)));
      } else if (node.type === "heading") {
        const id = node.data?.hProperties?.id;
        if (typeof id === "string") heading = id;
        add(node.children);
      } else if (node.type === "paragraph") {
        add(node.children);
      } else if (node.type === "list") {
        for (const item of node.children) {
          for (const child of item.children) if (child.type === "paragraph") add(child.children);
        }
      } else if (node.type === "table") {
        const [head, ...rows] = node.children;
        const cells = (row: typeof head) => row?.children.map((cell) => recordText(cell.children)) ?? [];
        const id = `${table}-${tables++}`;
        for (const row of rows) {
          contents.push(tableRowToStructuredData({ table: id, heading, row: cells(row), header: cells(head) }));
        }
      }
    }
  };
  visit(blocks);
  return contents;
}
