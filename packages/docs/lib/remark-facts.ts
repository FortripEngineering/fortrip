import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";

import { fact, type FactPath } from "../components/fact.tsx";

// The few mdast / mdast-util-mdx-jsx / vfile shapes this plugin reads.
interface Node {
  type: string;
  children?: Node[];
  position?: unknown;
}
interface JsxElement extends Node {
  type: "mdxJsxFlowElement" | "mdxJsxTextElement";
  name: string | null;
  attributes: { type: string; name?: string; value?: unknown }[];
}
interface File {
  fail(reason: string, place?: unknown): never;
}
type SourceArgs = Parameters<typeof replaceSource>;

function isFact(node: Node): node is JsxElement {
  return (
    (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
    (node as JsxElement).name === "Fact"
  );
}

/**
 * Replaces every `<Fact path="…" />` with the contract's value as plain text
 * (a paragraph when the tag stands on its own line). It also replaces the tag's
 * source for Fumadocs' source-backed outputs (the search index, Markdown/LLM
 * text), which slice the authored MDX. An unknown or non-literal path fails
 * the compilation, and with it the build.
 */
export function remarkFacts() {
  return (tree: Node, file: File) => {
    const visit = (parent: Node) => {
      parent.children = parent.children?.map((node) => {
        if (!isFact(node)) {
          visit(node);
          return node;
        }
        const path = node.attributes.find((a) => a.type === "mdxJsxAttribute" && a.name === "path")?.value;
        if (typeof path !== "string") {
          file.fail('<Fact> needs a string literal path, e.g. <Fact path="LIMITS.rooms" />', node);
        }
        let value: string;
        try {
          value = fact(path as FactPath);
        } catch (error) {
          file.fail((error as Error).message, node);
        }
        const text: Node & { value: string } = { type: "text", value, position: node.position };
        replaceSource(file as SourceArgs[0], text as SourceArgs[1], value);
        return node.type === "mdxJsxFlowElement"
          ? { type: "paragraph", children: [text], position: node.position }
          : text;
      });
    };
    visit(tree);
  };
}
