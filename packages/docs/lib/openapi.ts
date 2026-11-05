import type { Document } from "fumadocs-openapi";
import { createOpenAPI } from "fumadocs-openapi/server";

import { buildOpenApi } from "./openapi/build.ts";

/** The API reference's document: built from the contract, never fetched.
 *  Fumadocs types its input as 3.2, and upgrades a 3.1 document when it loads it. */
export const openapi = createOpenAPI({
  input: { fortrip: () => buildOpenApi() as unknown as Document },
});
