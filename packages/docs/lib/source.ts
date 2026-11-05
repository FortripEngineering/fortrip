import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";

import { openapi } from "./openapi.ts";
import { OPERATIONS } from "./openapi/build.ts";
import { referenceSource } from "./reference/pages.tsx";

const docs = defineDocs({
  dir: "content/docs",
  // Each page's Markdown, for `/<page>.md` and the llms files.
  docs: { postprocess: { includeProcessedMarkdown: true } },
});

const REFERENCE_DIR = "api/reference";
const openapiPages = await openapi.staticSource({ baseDir: REFERENCE_DIR });

/** An operation's page with the operation's short summary as its description
 *  (meta, header, cards, llms.txt) and in its search records: the page shows
 *  the summary, and the full description lives in openapi.json and on the MCP
 *  tool's page. */
const describedOpenapiPages = openapiPages.files.map((file): (typeof openapiPages.files)[number] => {
  if (file.type !== "page") return file;
  const id = file.path.split("/").at(-1)?.replace(/\.\w+$/, "");
  const op = OPERATIONS.find((o) => o.id === id);
  if (!op) throw new Error(`${file.path}: no operation`);
  const { structuredData } = file.data;
  return {
    ...file,
    data: {
      ...file.data,
      description: op.summary,
      structuredData: {
        ...structuredData,
        contents: structuredData.contents.map((record) =>
          record.content === op.description ? { ...record, content: op.summary } : record,
        ),
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
          data: { pages: OPERATIONS.map((op) => op.id) },
        },
      ],
    },
  },
  { baseUrl: "/", plugins: [openapi.loaderPlugin()] },
);
