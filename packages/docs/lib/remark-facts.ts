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

/** JSX elements whose content is text, never a paragraph. */
const TEXT_ONLY = new Set(["code", "pre"]);

/** A value that is an email address, rendered as a `mailto:` link. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]+$/i;

function isFact(node: Node): node is JsxElement {
  return (
    (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
    (node as JsxElement).name === "Fact"
  );
}

/**
 * Replaces every `<Fact path="…" />` with the contract's value as plain text
 * (a paragraph when the tag stands on its own line, except in <code>/<pre>),
 * or a `mailto:` link when the value is an email address.
 * It also replaces the tag's source for Fumadocs' source-backed outputs (the
 * search index, Markdown/LLM text), which slice the authored MDX. An unknown or
 * non-literal path fails the compilation, and with it the build.
 */
export function remarkFacts() {
  return (tree: Node, file: File) => {
    const visit = (parent: Node) => {
      // Leaves have no `children` key; adding one (even undefined) breaks
      // Fumadocs' Markdown output, which walks every node that has it.
      if (!parent.children) return;
      parent.children = parent.children.map((node) => {
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
        // Inside <code> or <pre>, which hold text only, a value stays text and
        // is never a paragraph or a link.
        const inCode =
          (parent.type === "mdxJsxFlowElement" || parent.type === "mdxJsxTextElement") &&
          TEXT_ONLY.has((parent as JsxElement).name ?? "");
        let inline: Node;
        if (EMAIL.test(value) && !inCode && parent.type !== "link") {
          const url = `mailto:${value}`;
          inline = { type: "link", url, children: [{ type: "text", value } as Node], position: node.position } as Node;
          replaceSource(file as SourceArgs[0], inline as SourceArgs[1], `[${value}](${url})`);
          replaceSource(file as SourceArgs[0], inline as SourceArgs[1], value, "search");
        } else {
          inline = { type: "text", value, position: node.position } as Node;
          replaceSource(file as SourceArgs[0], inline as SourceArgs[1], value);
        }
        return node.type === "mdxJsxFlowElement" && !inCode
          ? { type: "paragraph", children: [inline], position: node.position }
          : inline;
      });
    };
    visit(tree);
  };
}
