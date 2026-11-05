import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";

import { referenceSource } from "./reference/pages.tsx";

const docs = defineDocs({
  dir: "content/docs",
});

export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    // A page per contract tool and command, generated rather than written.
    reference: referenceSource,
  },
  { baseUrl: "/" },
);
