import type { InferPageType } from "fumadocs-core/source";
import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";

import { i18n } from "./i18n.ts";
import { openapi } from "./openapi.ts";
import { OPERATIONS } from "./openapi/build.ts";
import { contentSentence, SURFACE_HEADINGS, toolSentence } from "./prose/mcp-content.ts";
import { CLI_COMMANDS } from "./reference/cli-commands.ts";
import { MCP_TOOLS } from "./reference/mcp-tools.ts";
import { referenceSource } from "./reference/pages.tsx";

const docs = defineDocs({
  dir: "content/docs",
  // Each page's Markdown, for `/<page>.md` and the llms files.
  docs: { postprocess: { includeProcessedMarkdown: true } },
});

const REFERENCE_DIR = "reference";
const openapiPages = await openapi.staticSource({ baseDir: REFERENCE_DIR });

const plain = (text: string) => text.replaceAll("`", "");

/** The search headings and records of the sections that end an operation's
 *  page: its MCP tool and its CLI command, as `OperationSurfaces` shows them. */
function surfaceRecords(toolName: string | null) {
  const tool = MCP_TOOLS.find((t) => t.name === toolName);
  if (!tool) return { headings: [], contents: [] };
  const command = CLI_COMMANDS.find((c) => c.slug === tool.cliSlug);
  const cli = command
    ? [
        command.invocation,
        command.usage,
        ...(command.how ?? []),
        ...(command.flags ?? []).map(([flag, , description]) => `${flag}: ${description}`),
        command.output,
      ]
    : [];
  return {
    headings: [
      { id: "mcp", content: SURFACE_HEADINGS.mcp },
      ...(command ? [{ id: "cli", content: SURFACE_HEADINGS.cli }] : []),
    ],
    contents: [
      ...[toolSentence(tool.name, tool.access), contentSentence(tool.name)].map((content) => ({ heading: "mcp", content: plain(content) })),
      ...cli.map((content) => ({ heading: "cli", content: plain(content) })),
    ],
  };
}

/** An operation's page with the operation's short summary as its description
 *  (meta, header, cards, llms.txt). Its search records keep the full
 *  description, which the page shows under its "what the model reads" label.
 *  Its MCP tool and CLI command, which the OpenAPI document doesn't hold, get
 *  their search records here. */
const describedOpenapiPages = openapiPages.files.map((file): (typeof openapiPages.files)[number] => {
  if (file.type !== "page") return file;
  const id = file.path.split("/").at(-1)?.replace(/\.\w+$/, "");
  const op = OPERATIONS.find((o) => o.id === id);
  if (!op) throw new Error(`${file.path}: no operation`);
  const { structuredData } = file.data;
  const surfaces = surfaceRecords(op.endpoint.tool);
  return {
    ...file,
    data: {
      ...file.data,
      description: op.summary,
      structuredData: {
        ...structuredData,
        headings: [...structuredData.headings, ...surfaces.headings],
        contents: [...structuredData.contents, ...surfaces.contents],
      },
    },
  };
});

export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    // A page per contract tool and command, generated rather than written.
    reference: referenceSource,
    // A page per HTTP operation, from the OpenAPI document the contract builds,
    // listed in the endpoint table's order.
    openapi: {
      files: [
        ...describedOpenapiPages,
        {
          type: "meta",
          path: `${REFERENCE_DIR}/meta.json`,
          data: { title: "Operations", pages: OPERATIONS.map((op) => op.id) },
        },
      ],
    },
  },
  { baseUrl: "/", i18n, plugins: [openapi.loaderPlugin()] },
);

type Page = InferPageType<typeof source>;

/** Whether a page has its own file in its language (`quickstart.zh.mdx`),
 *  rather than being the default language's page under its URL. */
export function isTranslated(page: Page): boolean {
  if (page.locale === undefined || page.locale === i18n.defaultLanguage) return true;
  return source.getPage(page.slugs, i18n.defaultLanguage)?.data !== page.data;
}
