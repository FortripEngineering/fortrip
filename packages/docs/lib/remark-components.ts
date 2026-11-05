import { replaceSource, type Stringifier } from "fumadocs-core/mdx-plugins/stringifier";
import type { Nodes, Parent, PhrasingContent, RootContent } from "mdast";

import { BLOCKS, INLINE } from "./markdown/components.ts";
import type { Widget } from "./markdown/mdast.ts";
import { phrasing, toMarkdown } from "./markdown/stringify.ts";
import { toContents } from "./markdown/structure.ts";
import { attributesOf, WIDGETS } from "./markdown/widgets.ts";

// The mdast-util-mdx-jsx and vfile shapes this plugin reads.
interface JsxElement extends Parent {
  type: "mdxJsxFlowElement" | "mdxJsxTextElement";
  name: string | null;
  attributes: { type: string; name?: string; value?: unknown }[];
}
interface File {
  fail(reason: string, place?: unknown): never;
}
type SourceArgs = Parameters<typeof replaceSource>;

const isJsx = (node: { type: string }): node is JsxElement =>
  node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";

/** The concatenated text inside a node. */
const textOf = (node: Nodes): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map((c) => textOf(c as Nodes)).join("") : "";

/**
 * Expands each data component (`lib/markdown/components.ts`) into the Markdown
 * tree it stands for, so the page, Fumadocs' search records and the Markdown
 * text (`getText("processed")`) are all made from one tree. The search records
 * of a component's blocks ride on its first block (`data.structuredData`),
 * since generated nodes have no source position for Fumadocs to slice.
 *
 * Elements kept as JSX get a Markdown form too: `<Example>` its code,
 * `<Cards>` a list of links, `<code>` Markdown inline code. A `<pre>` becomes
 * a Markdown code block on the page too. Any other
 * component fails the compilation, and with it the build, so no page's
 * Markdown is left holding JSX. Runs after `remarkFacts`.
 */
export function remarkComponents() {
  return (tree: Parent, file: File) => {
    const sourceFile = file as unknown as SourceArgs[0];
    const setMarkdown = (node: JsxElement, markdown: string | ((s: Stringifier) => string)) =>
      replaceSource(sourceFile, node as unknown as SourceArgs[1], markdown);
    let expanded = 0;

    const propsOf = (node: JsxElement): Record<string, string> => {
      const props: Record<string, string> = {};
      for (const attribute of node.attributes) {
        if (attribute.type !== "mdxJsxAttribute" || typeof attribute.value !== "string") {
          file.fail(`<${node.name}> takes string literal props only`, node);
        }
        props[attribute.name as string] = attribute.value as string;
      }
      return props;
    };

    const expand = (node: JsxElement, parent: Parent): RootContent[] | PhrasingContent[] | null => {
      const name = node.name ?? "";
      const flow = node.type === "mdxJsxFlowElement";
      if (BLOCKS[name] && flow) {
        const blocks = BLOCKS[name](propsOf(node));
        setMarkdown(node, toMarkdown(blocks));
        const [first] = blocks;
        if (first) {
          first.data = { ...first.data, structuredData: { contents: toContents(blocks, `${name}-${expanded++}`) } } as typeof first.data;
        }
        return blocks as RootContent[];
      }
      if (INLINE[name]) {
        const content = INLINE[name](propsOf(node));
        setMarkdown(node, phrasing(content));
        return flow ? [{ type: "paragraph", children: content }] : content;
      }
      if (BLOCKS[name]) file.fail(`<${name}> stands on its own line`, node);
      if (WIDGETS[name] && flow) {
        const widget = node as unknown as Widget;
        setMarkdown(node, toMarkdown([widget]));
        if (WIDGETS[name].searchable) {
          node.data = { ...node.data, structuredData: { contents: toContents([widget], `${name}-${expanded++}`) } } as typeof node.data;
        }
        return null;
      }
      if (name === "Cards") {
        setMarkdown(node, (s) =>
          (node.children.filter((child) => isJsx(child)) as unknown as JsxElement[])
            .map((card) => {
              const { title, href } = propsOf(card);
              return `- [${title}](${href}): ${s.inner(card as unknown as Nodes).replace(/\s+/g, " ").trim()}`;
            })
            .join("\n"),
        );
        return null;
      }
      // A card is written by the <Cards> around it.
      if (name === "Card" && isJsx(parent) && parent.name === "Cards") return null;
      if (name === "code") {
        setMarkdown(node, phrasing([{ type: "inlineCode", value: textOf(node as unknown as Nodes) }]));
        return null;
      }
      if (name === "pre" && flow) {
        // Markdown code, so the page renders it as the site's code block
        // (scrolling, with a copy button), which JSX `<pre>` never reaches.
        const code: RootContent = { type: "code", lang: null, value: textOf(node as unknown as Nodes) };
        setMarkdown(node, toMarkdown([code]));
        return [code];
      }
      if (/^[A-Z]/.test(name)) file.fail(`<${name}> has no Markdown form`, node);
      return null;
    };

    const visit = (parent: Parent) => {
      parent.children = parent.children.flatMap((node) => {
        if (isJsx(node)) {
          const replacement = expand(node, parent);
          if (replacement) return replacement as Parent["children"];
        }
        if (Array.isArray((node as Partial<Parent>).children)) visit(node as Parent);
        return [node];
      });
    };
    visit(tree);
  };
}
