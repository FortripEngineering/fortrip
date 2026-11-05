import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";

import { openapi } from "./openapi.ts";
import { OPERATIONS } from "./openapi/build.ts";
import { referenceSource } from "./reference/pages.tsx";

const docs = defineDocs({
  dir: "content/docs",
});

const REFERENCE_DIR = "api/reference";
const openapiPages = await openapi.staticSource({ baseDir: REFERENCE_DIR });

export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    // A page per contract tool and command, generated rather than written.
    reference: referenceSource,
    // A page per HTTP operation, from the OpenAPI document the contract builds,
    // listed in the endpoint table's order.
    openapi: {
      files: [
        ...openapiPages.files,
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
