import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";

import { openapi } from "./openapi.ts";
import { referenceSource } from "./reference/pages.tsx";

const docs = defineDocs({
  dir: "content/docs",
});

export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    // A page per contract tool and command, generated rather than written.
    reference: referenceSource,
    // A page per HTTP operation, from the OpenAPI document the contract builds.
    openapi: await openapi.staticSource({ baseDir: "api/reference", meta: true }),
  },
  { baseUrl: "/", plugins: [openapi.loaderPlugin()] },
);
