import type { MetaData, PageData, VirtualFile } from "fumadocs-core/source";
import type { StructuredData } from "fumadocs-core/mdx-plugins";
import type { TOCItemType } from "fumadocs-core/toc";
import type { MDXComponents } from "mdx/types";
import type { FC } from "react";

import { CommandPage } from "../../components/reference.tsx";
import { commandMarkdown } from "../markdown/pages.ts";
import { CLI_COMMANDS } from "./cli-commands.ts";

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

/** The commands with a page of their own: those that call no operation. An
 *  operation's command is a section of the operation's page. */
export const COMMANDS_WITH_PAGES = CLI_COMMANDS.filter((command) => !command.tool);

const commandPages: ReferencePage[] = COMMANDS_WITH_PAGES.map((command) => ({
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

/** One page per command that calls no operation. */
export const REFERENCE_PAGES: ReferencePage[] = commandPages;

/** The generated pages and their folders' sidebars, for the loader. */
export const referenceSource: { files: VirtualFile<Config>[] } = {
  files: [
    ...REFERENCE_PAGES,
    folder("cli", "CLI", COMMANDS_WITH_PAGES),
  ],
};
