import type { MetaData, PageData, VirtualFile } from "fumadocs-core/source";
import type { StructuredData } from "fumadocs-core/mdx-plugins";
import type { TOCItemType } from "fumadocs-core/toc";
import type { MDXComponents } from "mdx/types";
import type { FC } from "react";

import { CommandPage, ToolPage } from "../../components/reference.tsx";
import { commandMarkdown, toolMarkdown } from "../markdown/pages.ts";
import { CLI_COMMANDS } from "./cli-commands.ts";
import { TOOL_INPUTS } from "./input-docs.ts";
import { MCP_TOOLS } from "./mcp-tools.ts";
import { inputRows } from "./schema-rows.ts";

/** A generated page, shaped like a compiled MDX page so one route renders both. */
export interface ReferencePageData extends PageData {
  title: string;
  description: string;
  body: FC<{ components?: MDXComponents }>;
  /** The body as Markdown, for the page's `.md` and the llms files. */
  markdown: () => string;
  toc: TOCItemType[];
  structuredData: StructuredData;
  full?: boolean;
}

type Config = { pageData: ReferencePageData; metaData: MetaData };
type ReferencePage = Extract<VirtualFile<Config>, { type: "page" }>;

const plain = (text: string) => text.replaceAll("`", "");

/** Table of contents and search entries for headings and their text. */
function outline(
  intro: string[],
  sections: Array<{ id: string; title: string; content: string[] }>,
): Pick<ReferencePageData, "toc" | "structuredData"> {
  return {
    toc: sections.map(({ id, title }) => ({ title, url: `#${id}`, depth: 2 })),
    structuredData: {
      headings: sections.map(({ id, title }) => ({ id, content: title })),
      contents: [
        ...intro.map((content) => ({ heading: undefined, content: plain(content) })),
        ...sections.flatMap(({ id, content }) =>
          content.map((text) => ({ heading: id, content: plain(text) })),
        ),
      ],
    },
  };
}

const toolPages: ReferencePage[] = MCP_TOOLS.map((tool) => {
  const input = tool.name === "get_planning_guide" ? null : TOOL_INPUTS[tool.name];
  const returns = typeof tool.returns === "string" ? tool.returns : `${tool.returns.title} object`;
  return {
    type: "page",
    path: `mcp/${tool.slug}.mdx`,
    data: {
      title: tool.title,
      description: tool.snippet,
      body: () => <ToolPage name={tool.name} />,
      markdown: () => toolMarkdown(tool.name),
      ...outline(
        [tool.name, ...(tool.summary.startsWith(tool.snippet) ? [] : [tool.snippet]), tool.summary],
        [
          {
            id: "input",
            title: "Input",
            content: input
              ? inputRows(input).map((row) => `${row.path}: ${row.description}`)
              : ["None."],
          },
          { id: "output", title: "Output", content: [returns] },
        ],
      ),
    },
  };
});

const commandPages: ReferencePage[] = CLI_COMMANDS.map((command) => ({
  type: "page",
  path: `cli/${command.slug}.mdx`,
  data: {
    title: command.title,
    description: plain(command.summary),
    body: () => <CommandPage path={command.slug} />,
    markdown: () => commandMarkdown(command.slug),
    ...outline(
      [command.invocation, command.summary],
      [
        { id: "usage", title: "Usage", content: [command.usage] },
        ...(command.how ? [{ id: "how", title: "How it works", content: command.how }] : []),
        ...(command.flags
          ? [
              {
                id: "options",
                title: "Options",
                content: command.flags.map(([flag, , description]) => `${flag}: ${description}`),
              },
            ]
          : []),
        { id: "output", title: "Output", content: [command.output] },
      ],
    ),
  },
}));

/** A folder's sidebar: its pages under their group names. The folder itself
 *  links to its overview (`index.mdx`). */
function folder(dir: string, title: string, entries: Array<{ slug: string; group: string }>) {
  const pages: string[] = [];
  let group: string | undefined;
  for (const entry of entries) {
    if (entry.group !== group) pages.push(`---${entry.group}---`);
    group = entry.group;
    pages.push(entry.slug);
  }
  return { type: "meta" as const, path: `${dir}/meta.json`, data: { title, pages } };
}

/** One page per contract tool and command. */
export const REFERENCE_PAGES: ReferencePage[] = [...toolPages, ...commandPages];

/** The generated pages and their folders' sidebars, for the loader. */
export const referenceSource: { files: VirtualFile<Config>[] } = {
  files: [
    ...REFERENCE_PAGES,
    folder("mcp", "MCP", MCP_TOOLS),
    folder("cli", "CLI", CLI_COMMANDS),
  ],
};
