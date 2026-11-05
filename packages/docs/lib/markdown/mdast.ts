// Builders for the Markdown trees (mdast) that data components expand into.
// The same tree is the page (MDX renders it), the search records and the
// Markdown text (`stringify.ts`, `structure.ts`).
import type {
  Code,
  Heading,
  InlineCode,
  Link,
  List,
  Paragraph,
  PhrasingContent,
  RootContent,
  Strong,
  Table,
  TableRow,
  Text,
} from "mdast";

/**
 * A component a page keeps as JSX, for a look Markdown has no element for
 * (`Fields`, a field list; `Example`, code in tabs). It still has a Markdown
 * form and search records: `widgets.ts`.
 */
export interface Widget {
  type: "mdxJsxFlowElement";
  name: string;
  attributes: { type: "mdxJsxAttribute"; name: string; value: string }[];
  children: [];
  data?: RootContent["data"];
}

/** What a data component expands into. */
export type Block = RootContent | Widget;

export const text = (value: string): Text => ({ type: "text", value });
export const code = (value: string): InlineCode => ({ type: "inlineCode", value });
export const strong = (...children: PhrasingContent[]): Strong => ({ type: "strong", children });
export const link = (url: string, ...children: PhrasingContent[]): Link => ({ type: "link", url, children });
export const lineBreak = (): PhrasingContent => ({ type: "break" });
export const paragraph = (children: PhrasingContent[]): Paragraph => ({ type: "paragraph", children });
export const codeBlock = (lang: string | null, value: string): Code => ({ type: "code", lang, value });

/** A heading; with an `id`, it is a link target and in the table of contents. */
export function heading(depth: Heading["depth"], children: PhrasingContent[], id?: string): Heading {
  return { type: "heading", depth, children, ...(id && { data: { hProperties: { id } } }) };
}

/** A tight list, an item each. */
export function list(items: PhrasingContent[][], ordered = false): List {
  return {
    type: "list",
    ordered,
    spread: false,
    children: items.map((item) => ({ type: "listItem", spread: false, children: [paragraph(item)] })),
  };
}

/** A table with a header row. A row's `id` makes it a link target. */
export function table(head: string[], rows: Array<{ cells: PhrasingContent[][]; id?: string }>): Table {
  const row = (cells: PhrasingContent[][], id?: string): TableRow => ({
    type: "tableRow",
    children: cells.map((children) => ({ type: "tableCell", children })),
    ...(id && { data: { hProperties: { id } } }),
  });
  return {
    type: "table",
    align: head.map(() => null),
    children: [row(head.map((cell) => [text(cell)])), ...rows.map((r) => row(r.cells, r.id))],
  };
}

export function widget(name: string, attributes: Record<string, string>): Widget {
  return {
    type: "mdxJsxFlowElement",
    name,
    attributes: Object.entries(attributes).map(([key, value]) => ({ type: "mdxJsxAttribute", name: key, value })),
    children: [],
  };
}

const INLINE = /`([^`]+)`|\[((?:`[^`]+`|[^\]`])+)\]\(([^)\s]+)\)/g;

/** Prose with `code` spans and [links](/url), the only Markdown the docs'
 *  data strings use, as phrasing content. */
export function inline(prose: string): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let at = 0;
  for (const match of prose.matchAll(INLINE)) {
    if (match.index > at) out.push(text(prose.slice(at, match.index)));
    const [, span, label, url] = match;
    out.push(span !== undefined ? code(span) : link(url as string, ...inline(label as string)));
    at = match.index + match[0].length;
  }
  if (at < prose.length) out.push(text(prose.slice(at)));
  return out;
}

/** `a`, `b` and `c`, each as code. */
export function codeList(names: readonly string[], last = "and"): PhrasingContent[] {
  return names.flatMap((name, i) => [
    ...(i === 0 ? [] : [text(i === names.length - 1 ? ` ${last} ` : ", ")]),
    code(name),
  ]);
}

/** Phrasing parts joined by `separator`. */
export function joined(parts: PhrasingContent[][], separator: string): PhrasingContent[] {
  return parts.flatMap((part, i) => (i === 0 ? part : [text(separator), ...part]));
}
