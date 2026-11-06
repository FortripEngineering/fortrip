"use client";
import { createCodeUsageGeneratorRegistry } from "fumadocs-openapi/requests/generators";
import { createOpenAPIPage } from "fumadocs-openapi/ui";

import { curlCommand } from "@/lib/openapi/curl";

/** An API reference page. No playground: every request needs a user's OAuth
 *  token. Its one code sample is curl, sending the token from `FORTRIP_TOKEN`
 *  as the examples do; the generated samples of other languages would send none. */
export const OpenAPIPage = createOpenAPIPage({
  playground: { enabled: false },
  codeUsages: createCodeUsageGeneratorRegistry(),
  generateCodeSamples: ({ operation }) => [
    {
      id: "curl",
      lang: "bash",
      label: "cURL",
      source: (data) => curlCommand(data, (operation.security ?? []).length > 0),
    },
  ],
});
