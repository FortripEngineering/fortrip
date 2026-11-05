// Markdown text of the trees data components expand into. Only the node
// types `mdast.ts` builds are written; another one throws, so a builder
// can't produce a node that silently drops out of the Markdown.
import type { ListItem, PhrasingContent, RootContent } from "mdast";

import type { Block, Widget } from "./mdast.ts";
import { attributesOf, WIDGETS } from "./widgets.ts";

const isWidget = (node: Block): node is Widget => node.type === "mdxJsxFlowElement";

/** Text that Markdown would otherwise read as markup: emphasis, code, HTML.
 *  The docs' prose writes links and code with `inline()`, never as text. */
const escape = (value: string) => value.replace(/[\\`*<]/g, "\\$&");

/** An inline code span, fenced past any backticks it holds. */
function codeSpan(value: string): string {
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${pad}${value}${pad}${fence}`;
}

export function phrasing(nodes: PhrasingContent[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escape(node.value);
        case "inlineCode":
          return codeSpan(node.value);
        case "strong":
          return `**${phrasing(node.children)}**`;
        case "link":
          return `[${phrasing(node.children)}](${node.url})`;
        case "break":
          // Only in table cells, where a line break would end the row.
          return "<br>";
        default:
          throw new Error(`No Markdown for a ${node.type} node`);
      }
    })
    .join("");
}

function listItem(item: ListItem): string {
  return item.children
    .map((child) => {
      if (child.type !== "paragraph") throw new Error(`No Markdown for a ${child.type} in a list item`);
      return phrasing(child.children);
    })
    .join("\n\n");
}

function block(node: Block): string {
  if (isWidget(node)) return toMarkdown(WIDGETS[node.name]?.blocks(attributesOf(node)) ?? []);
  const content = node as RootContent;
  switch (content.type) {
    case "paragraph":
      return phrasing(content.children);
    case "heading": {
      const id = content.data?.hProperties?.id;
      return `${"#".repeat(content.depth)} ${phrasing(content.children)}${id ? ` [#${id}]` : ""}`;
    }
    case "list":
      return content.children
        .map((item, i) => {
          const marker = content.ordered ? `${i + 1}. ` : "- ";
          return marker + listItem(item).replaceAll("\n", `\n${" ".repeat(marker.length)}`);
        })
        .join("\n");
    case "blockquote":
      return content.children.map((child) => block(child)).join("\n\n").replace(/^/gm, "> ").replace(/^> $/gm, ">");
    case "code": {
      const longest = Math.max(2, ...(content.value.match(/^`+/gm) ?? []).map((run) => run.length));
      const fence = "`".repeat(longest + 1);
      return `${fence}${content.lang ?? ""}\n${content.value}\n${fence}`;
    }
    case "table": {
      // Unpadded: padding to column width is mostly spaces in a long table.
      const [head = [], ...rows] = content.children.map((row) =>
        row.children.map((cell) => phrasing(cell.children).replace(/\s*\n\s*/g, " ").replace(/(?<!\\)\|/g, "\\|")),
      );
      const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
      return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
    }
    default:
      throw new Error(`No Markdown for a ${content.type} node`);
  }
}

/** Blocks as Markdown, a blank line between them. */
export function toMarkdown(blocks: Block[]): string {
  return blocks.map(block).join("\n\n");
}
