// The components a page keeps as JSX (see `Widget`), with the Markdown
// they stand for: what the Markdown text and the search records hold.
import { TOOLS, type ToolName } from "@fortrip/agent-contract";
import type { PhrasingContent } from "mdast";

import { EXAMPLE_LANGUAGES, exampleCode } from "../reference/examples.ts";
import { TOOL_INPUTS } from "../reference/input-docs.ts";
import { RESPONSE_DOCS } from "../reference/response-docs.ts";
import { type FieldRow, inputRows } from "../reference/schema-rows.ts";
import {
  type Block,
  code,
  codeBlock,
  inline,
  joined,
  list,
  paragraph,
  strong,
  text,
  type Widget,
  widget,
} from "./mdast.ts";

/**
 * The rows of a field list, by name: `response:<schemas id>` (a response
 * object) or `input:<tool>` (a tool's input).
 */
export function fieldRows(of: string): FieldRow[] {
  const [kind, name] = of.split(":");
  if (kind === "response") {
    const doc = RESPONSE_DOCS.find((d) => d.id === name);
    if (doc) return doc.rows;
  } else if (kind === "input" && name && name !== "get_planning_guide" && TOOLS.some((t) => t.name === name)) {
    return inputRows(TOOL_INPUTS[name as Exclude<ToolName, "get_planning_guide">]);
  }
  throw new Error(`Unknown field list: ${of}`);
}

/** A field's constraint, its pattern or default value as code: "matches `^[A-Z]{2}$`". */
function constraint(meta: string): PhrasingContent[] {
  const value = /^((?:each )?(?:matches|default) )(.+)$/.exec(meta);
  return value ? [text(value[1] as string), code(value[2] as string)] : [text(meta)];
}

/** A field list, shown as `<Fields of="…" />`. */
export const fields = (of: string): Widget => widget("Fields", { of });

interface WidgetText {
  /** The widget as Markdown, in mdast. */
  blocks: (attributes: Record<string, string>) => Block[];
  /** Whether search indexes it (code is not). */
  searchable: boolean;
}

export const WIDGETS: Record<string, WidgetText> = {
  Fields: {
    searchable: true,
    blocks: ({ of = "" }) => [
      list(
        fieldRows(of).map((row) => [
          code(row.path),
          text(row.variant ? " (when " : " ("),
          code(row.type),
          text(row.badge ? `, ${row.badge})` : ")"),
          ...(row.description ? [text(": "), ...inline(row.description)] : []),
          ...(row.meta.length > 0 ? [text(" "), ...joined(row.meta.map(constraint), " · ")] : []),
        ]),
      ),
    ],
  },
  Example: {
    searchable: false,
    blocks: ({ name = "" }) =>
      EXAMPLE_LANGUAGES.flatMap((language) => [
        paragraph([strong(text(language.label))]),
        codeBlock(language.lang, exampleCode(name, language)),
      ]),
  },
};

/** The attributes of a widget, each a string literal. */
export function attributesOf(node: Widget): Record<string, string> {
  return Object.fromEntries(node.attributes.map((a) => [a.name, a.value]));
}
