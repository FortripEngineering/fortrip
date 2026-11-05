import * as contract from "@fortrip/agent-contract";
import {
  ACCOUNT_ROUTES,
  authConfig,
  CONTRACT_VERSION,
  errorEnvelope,
  HTTP_ROUTES,
  type HttpRoute,
  meResult,
  ORDER_HTTP,
  PUBLIC_ORIGINS,
  TOOLS,
} from "@fortrip/agent-contract";
import type { OpenAPIV3_1 } from "fumadocs-openapi";
import { z } from "zod";

import { type Endpoint, ENDPOINTS } from "../reference/api-docs.ts";
import { responseDocFor } from "../reference/response-docs.ts";

/** A JSON Schema 2020-12 object, as `z.toJSONSchema` writes it. */
interface Schema {
  properties?: Record<string, Schema>;
  required?: string[];
  [keyword: string]: unknown;
}

/** A contract schema as JSON Schema, without `$schema`. It must stand alone:
 *  inside the document, a `#/$defs/...` reference would resolve against the
 *  document's root. */
function jsonSchema(schema: z.ZodType, io: "input" | "output"): Schema {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io });
  const text = JSON.stringify(rest);
  if (text.includes('"$defs"') || text.includes('"$ref"')) {
    throw new Error(`a contract schema converts with $defs or $ref: ${text.slice(0, 200)}`);
  }
  return rest as Schema;
}

const json = (schema: Schema) => ({ "application/json": { schema } });

/** An operation of the API, as the endpoint table lists it. */
interface OperationSpec {
  id: string;
  route: HttpRoute;
  endpoint: Endpoint;
  input: z.ZodType | null;
  output: z.ZodType;
  description?: string;
}

/** The routes that aren't tools: their operation ids and what they answer. */
const ACCOUNT_OPERATIONS: Record<keyof typeof ACCOUNT_ROUTES, { id: string; output: z.ZodType }> = {
  me: { id: "me", output: meResult },
  authConfig: { id: "auth_config", output: authConfig },
};

/** Every operation, in the endpoint table's order. */
export const OPERATIONS: OperationSpec[] = ENDPOINTS.map((endpoint) => {
  if (endpoint.tool) {
    const tool = TOOLS.find((t) => t.name === endpoint.tool);
    // The HTTP answer: the MCP tool's, less the `nextStep` only MCP carries.
    const output = responseDocFor(endpoint.tool)?.schema;
    if (!tool || !output) throw new Error(`no tool or response for ${endpoint.tool}`);
    const route = HTTP_ROUTES[endpoint.tool];
    return { id: tool.name, route, endpoint, input: tool.input, output, description: tool.description };
  }
  const key = (Object.keys(ACCOUNT_ROUTES) as Array<keyof typeof ACCOUNT_ROUTES>).find(
    (k) => ACCOUNT_ROUTES[k].method === endpoint.method && ACCOUNT_ROUTES[k].path === endpoint.path,
  );
  if (!key) throw new Error(`no route for ${endpoint.method} ${endpoint.path}`);
  const { id, output } = ACCOUNT_OPERATIONS[key];
  return { id, route: ACCOUNT_ROUTES[key], endpoint, input: null, output };
});

/** What an operation answers, by status. */
export function answers(op: OperationSpec): Record<string, z.ZodType> {
  const ok: Record<string, z.ZodType> =
    op.id === "book_hotel"
      ? { [ORDER_HTTP.createdStatus]: op.output, [ORDER_HTTP.replayedStatus]: op.output }
      : { 200: op.output };
  return { ...ok, default: errorEnvelope };
}

/** A schema's name in `components.schemas`: its export from the contract,
 *  capitalized (`order` is `Order`). */
function componentName(schema: z.ZodType): string {
  const name = Object.entries(contract).find(([, value]) => value === schema)?.[0];
  if (!name) throw new Error("a shared response schema isn't exported by the contract");
  return name[0]!.toUpperCase() + name.slice(1);
}

/** One operation: path and query fields as parameters, a POST's other fields
 *  as its JSON body, and the answers, each a schema or a reference to one. */
function operation(op: OperationSpec, answer: (schema: z.ZodType) => Schema) {
  const { id, route, endpoint } = op;
  const inputSchema = op.input ? jsonSchema(op.input, "input") : null;
  const properties = inputSchema?.properties ?? {};
  const required = new Set(inputSchema?.required ?? []);
  const parameter = (name: string, where: "path" | "query") => {
    const schema = properties[name];
    if (!schema) throw new Error(`${id}: ${name} isn't an input field`);
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

  const responses = Object.fromEntries(
    Object.entries(answers(op)).map(([status, schema]) => {
      const response = {
        description: status === "default" ? "Error" : endpoint.title,
        content: json(answer(schema)),
      };
      if (id === "book_hotel" && status === String(ORDER_HTTP.replayedStatus)) {
        const header = { required: true, schema: { type: "boolean", const: true } };
        return [status, { ...response, headers: { [ORDER_HTTP.replayedHeader]: header } }];
      }
      return [status, response];
    }),
  );

  return {
    operationId: id,
    summary: endpoint.title,
    ...(op.description && { description: op.description }),
    security: endpoint.auth ? [{ bearerAuth: [] }] : [],
    ...(parameters.length > 0 && { parameters }),
    ...(requestBody && { requestBody }),
    responses,
  };
}

/** OpenAPI 3.1 for the v1 API, generated from the contract. A response schema
 *  more than one answer shares is written once, under `components.schemas`. */
export function buildOpenApi(): OpenAPIV3_1.Document {
  const uses = new Map<z.ZodType, number>();
  for (const op of OPERATIONS) {
    for (const schema of Object.values(answers(op))) uses.set(schema, (uses.get(schema) ?? 0) + 1);
  }
  const schemas: Record<string, Schema> = {};
  const answer = (schema: z.ZodType): Schema => {
    if ((uses.get(schema) ?? 0) < 2) return jsonSchema(schema, "output");
    const name = componentName(schema);
    schemas[name] ??= jsonSchema(schema, "output");
    return { $ref: `#/components/schemas/${name}` };
  };

  const paths: Record<string, Record<string, ReturnType<typeof operation>>> = {};
  for (const op of OPERATIONS) {
    (paths[op.route.path] ??= {})[op.route.method.toLowerCase()] = operation(op, answer);
  }

  const document = {
    openapi: "3.1.1",
    info: { title: "Fortrip API", version: CONTRACT_VERSION },
    servers: [{ url: PUBLIC_ORIGINS.api }],
    paths,
    components: {
      schemas,
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
