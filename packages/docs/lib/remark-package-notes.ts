import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";
import type { Nodes, Parent } from "mdast";

type SourceArgs = Parameters<typeof replaceSource>;

const textOf = (node: Nodes): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map((c) => textOf(c as Nodes)).join("") : "";

/**
 * Drops every `### Package` section, from that heading to the next heading of
 * level 3 or above. The changelog keeps its notes on the contract package's
 * own exports there, for the package's readers; the docs show what a caller
 * of the API, the MCP tools or the CLI sees. The section's source goes too,
 * so the page's Markdown and search records leave it out with the page.
 */
export function remarkPackageNotes() {
  return (tree: Parent, file: unknown) => {
    let dropping = false;
    tree.children = tree.children.filter((node) => {
      if (node.type === "heading" && node.depth <= 3) {
        dropping = node.depth === 3 && textOf(node).trim() === "Package";
      }
      if (dropping) replaceSource(file as SourceArgs[0], node as SourceArgs[1], "");
      return !dropping;
    });
  };
}
