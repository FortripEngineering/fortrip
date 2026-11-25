import { CONTRACT_VERSION, DOCS_ORIGIN, PUBLIC_ORIGINS } from "@fortrip/agent-contract";

import { buildOpenApi, OPERATIONS } from "./build.ts";

/** Where the collection is served, and what the download is called. */
export const POSTMAN_PATH = "/postman.json";
export const POSTMAN_FILENAME = "fortrip.postman_collection.json";

const SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

interface Parameter {
  name: string;
  in: "path" | "query";
  example?: string | number;
}

interface Operation {
  summary: string;
  security: unknown[];
  parameters?: Parameter[];
  requestBody?: { content: { "application/json": { examples?: Record<string, { value: unknown }> } } };
  responses: Record<string, { description: string; content: { "application/json": { examples?: Record<string, { summary: string; value: unknown }> } } }>;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * A Postman Collection v2.1 of the v1 API, from the OpenAPI document: one
 * request per operation in the endpoint table's order, with the example
 * request's path, query and body, and each 2xx example as a saved response.
 * `{{baseUrl}}` and `{{token}}` are collection variables; the token is sent as
 * a bearer token by every request that needs sign-in.
 */
export function buildPostmanCollection() {
  const doc = buildOpenApi();
  const paths = doc.paths as Record<string, Record<string, Operation>>;

  const item = OPERATIONS.map((op) => {
    const operation = paths[op.route.path]?.[op.route.method.toLowerCase()];
    if (!operation) throw new Error(`${op.id}: not in the OpenAPI document`);
    const parameters = operation.parameters ?? [];
    const pathValues = new Map(parameters.filter((p) => p.in === "path").map((p) => [p.name, p]));
    const segments = op.route.path
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.replace(/^\{(.+)\}$/, ":$1"));
    const query = parameters
      .filter((p) => p.in === "query")
      .map((p) => ({ key: p.name, value: p.example === undefined ? "" : String(p.example), ...(p.example === undefined && { disabled: true }) }));
    const enabledQuery = query.filter((q) => !q.disabled);
    const raw = `{{baseUrl}}/${segments.join("/")}${enabledQuery.length > 0 ? `?${enabledQuery.map((q) => `${q.key}=${q.value}`).join("&")}` : ""}`;
    const url = {
      raw,
      host: ["{{baseUrl}}"],
      path: segments,
      ...(query.length > 0 && { query }),
      ...(pathValues.size > 0 && {
        variable: [...pathValues.values()].map((p) => ({ key: p.name, value: String(p.example ?? "") })),
      }),
    };
    const bodyExample = Object.values(operation.requestBody?.content["application/json"].examples ?? {})[0];
    const request = {
      method: op.route.method,
      header: bodyExample ? [{ key: "Content-Type", value: "application/json" }] : [],
      url,
      ...(bodyExample && { body: { mode: "raw", raw: json(bodyExample.value), options: { raw: { language: "json" } } } }),
      ...(operation.security.length === 0 && { auth: { type: "noauth" } }),
      description: `${op.summary}\n\n[Reference](${DOCS_ORIGIN}/reference/${op.id})`,
    };
    const response = Object.entries(operation.responses)
      .filter(([status]) => /^2\d\d$/.test(status))
      .flatMap(([status, answer]) =>
        Object.values(answer.content["application/json"].examples ?? {}).map((example) => ({
          name: example.summary,
          originalRequest: request,
          code: Number(status),
          header: [{ key: "Content-Type", value: "application/json" }],
          _postman_previewlanguage: "json",
          body: json(example.value),
        })),
      );
    return { name: op.endpoint.title, request, response };
  });

  return {
    info: {
      name: "Fortrip API",
      description: `The Fortrip HTTP API v1. Set the \`token\` variable to an API key (\`ak_…\`) or an OAuth access token: [Authentication](${DOCS_ORIGIN}/api#authentication).`,
      version: CONTRACT_VERSION,
      schema: SCHEMA,
    },
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
    variable: [
      { key: "baseUrl", value: PUBLIC_ORIGINS.api, type: "string" },
      { key: "token", value: "", type: "string" },
    ],
    item,
  };
}
