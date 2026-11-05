import {
  ACCOUNT_ROUTES,
  authConfig,
  CONTRACT_VERSION,
  errorEnvelope,
  HTTP_ROUTES,
  type HttpRoute,
  type HttpToolName,
  meResult,
  ORDER_HTTP,
  PUBLIC_ORIGINS,
  TOOLS,
} from "@fortrip/agent-contract";
import type { OpenAPIV3_1 } from "fumadocs-openapi";
import { z } from "zod";

import { ENDPOINTS } from "../reference/api-docs.ts";
import { responseDocFor } from "../reference/response-docs.ts";

/** A JSON Schema 2020-12 object, as `z.toJSONSchema` writes it. */
interface Schema {
  properties?: Record<string, Schema>;
  required?: string[];
  [keyword: string]: unknown;
}

/** A contract schema as JSON Schema, without `$schema`. */
function jsonSchema(schema: z.ZodType, io: "input" | "output"): Schema {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io });
  return rest as Schema;
}

const json = (schema: Schema) => ({ "application/json": { schema } });

/** One operation: path and query fields as parameters, a POST's other fields
 *  as its JSON body, and the answers. */
function operation(
  operationId: string,
  route: HttpRoute,
  { input, output, description }: { input: z.ZodType | null; output: z.ZodType; description?: string },
) {
  const endpoint = ENDPOINTS.find((e) => e.method === route.method && e.path === route.path);
  if (!endpoint) throw new Error(`no endpoint for ${route.method} ${route.path}`);

  const inputSchema = input ? jsonSchema(input, "input") : null;
  const properties = inputSchema?.properties ?? {};
  const required = new Set(inputSchema?.required ?? []);
  const parameter = (name: string, where: "path" | "query") => {
    const schema = properties[name];
    if (!schema) throw new Error(`${operationId}: ${name} isn't an input field`);
    return { name, in: where, required: where === "path" || required.has(name), schema };
  };
  const parameters = [
    ...route.pathFields.map((name) => parameter(name, "path")),
    ...route.queryFields.map((name) => parameter(name, "query")),
  ];

  let requestBody: { required: true; content: ReturnType<typeof json> } | undefined;
  if (route.method === "POST" && inputSchema) {
    const inParameters = new Set([...route.pathFields, ...route.queryFields]);
    const body: Schema = {
      ...inputSchema,
      properties: Object.fromEntries(
        Object.entries(properties).filter(([name]) => !inParameters.has(name)),
      ),
    };
    const bodyRequired = [...required].filter((name) => !inParameters.has(name));
    if (bodyRequired.length > 0) body.required = bodyRequired;
    else delete body.required;
    requestBody = { required: true, content: json(body) };
  }

  const answer = { description: endpoint.title, content: json(jsonSchema(output, "output")) };
  const answers =
    operationId === "book_hotel"
      ? {
          [ORDER_HTTP.createdStatus]: answer,
          [ORDER_HTTP.replayedStatus]: {
            ...answer,
            headers: {
              [ORDER_HTTP.replayedHeader]: { required: true, schema: { type: "boolean", const: true } },
            },
          },
        }
      : { 200: answer };

  return {
    operationId,
    summary: endpoint.title,
    ...(description && { description }),
    security: endpoint.auth ? [{ bearerAuth: [] }] : [],
    ...(parameters.length > 0 && { parameters }),
    ...(requestBody && { requestBody }),
    responses: {
      ...answers,
      default: { description: "Error", content: json(jsonSchema(errorEnvelope, "output")) },
    },
  };
}

/** The routes that aren't tools: their operation ids and what they answer. */
const ACCOUNT_OPERATIONS: Record<keyof typeof ACCOUNT_ROUTES, { id: string; output: z.ZodType }> = {
  me: { id: "me", output: meResult },
  authConfig: { id: "auth_config", output: authConfig },
};

/** OpenAPI 3.1 for the v1 API, generated from the contract. */
export function buildOpenApi(): OpenAPIV3_1.Document {
  const paths: Record<string, Record<string, ReturnType<typeof operation>>> = {};
  const add = (route: HttpRoute, op: ReturnType<typeof operation>) => {
    (paths[route.path] ??= {})[route.method.toLowerCase()] = op;
  };

  for (const [name, route] of Object.entries(HTTP_ROUTES) as Array<[HttpToolName, HttpRoute]>) {
    const tool = TOOLS.find((t) => t.name === name);
    // The HTTP answer: the MCP tool's, less the `nextStep` only MCP carries.
    const output = responseDocFor(name)?.schema;
    if (!tool || !output) throw new Error(`no tool or response for ${name}`);
    add(route, operation(name, route, { input: tool.input, output, description: tool.description }));
  }
  for (const [key, route] of Object.entries(ACCOUNT_ROUTES) as Array<
    [keyof typeof ACCOUNT_ROUTES, HttpRoute]
  >) {
    const { id, output } = ACCOUNT_OPERATIONS[key];
    add(route, operation(id, route, { input: null, output }));
  }

  const document = {
    openapi: "3.1.1",
    info: { title: "Fortrip API", version: CONTRACT_VERSION },
    servers: [{ url: PUBLIC_ORIGINS.api }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: `A Fortrip OAuth access token from the device authorization flow (RFC 8628). \`GET ${ACCOUNT_ROUTES.authConfig.path}\` returns the flow's endpoints.`,
        },
      },
    },
  };
  // The bundled OpenAPI types can't hold JSON Schema 2020-12 (`const`, a schema
  // per path item method); the test validates the document against the 3.1 schema.
  return document as unknown as OpenAPIV3_1.Document;
}
