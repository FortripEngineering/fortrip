import { createFromSource } from "fumadocs-core/search/server";

import { source } from "@/lib/source";

// An index per language; the default tokenizer segments Chinese as well as English.
export const { GET } = createFromSource(source);
