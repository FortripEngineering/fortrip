import * as contract from "@fortrip/agent-contract";
import {
  ACCOUNT_ROUTES,
  authConfig,
  CONTRACT_VERSION,
  DOCS_ORIGIN,
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
import { EXAMPLE_REQUESTS } from "../reference/examples.ts";
import { MCP_TOOLS } from "../reference/mcp-tools.ts";
import { ERRORS, errorExampleFor, type OperationId, PAY_RESPONSES, RESPONSES } from "../reference/responses.ts";
import { responseDocFor } from "../reference/response-docs.ts";

/** A JSON Schema 2020-12 object, as `z.toJSONSchema` writes it. */
interface Schema {
  properties?: Record<string, Schema>;
  required?: string[];
  [keyword: string]: unknown;
}

const SAFE = Number.MAX_SAFE_INTEGER;

/** A JSON Schema without what says nothing: the safe-integer bounds zod puts
 *  on every integer, and `additionalProperties: {}` (allowed either way), which
 *  the reference would show as made-up fields in its samples. */
export function tidy<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map(tidy) as T;
  if (typeof schema !== "object" || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "minimum" && value === -SAFE) continue;
    if (key === "maximum" && value === SAFE) continue;
    if (key === "additionalProperties" && typeof value === "object" && value !== null && Object.keys(value).length === 0) continue;
    out[key] = tidy(value);
  }
  return out as T;
}

/** A contract schema as JSON Schema, without `$schema`, tidied. It must stand
 *  alone: inside the document, a `#/$defs/...` reference would resolve
 *  against the document's root. */
function jsonSchema(schema: z.ZodType, io: "input" | "output"): Schema {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io });
  const text = JSON.stringify(rest);
  if (text.includes('"$defs"') || text.includes('"$ref"')) {
    throw new Error(`a contract schema converts with $defs or $ref: ${text.slice(0, 200)}`);
  }
  return tidy(rest) as Schema;
}

/** Named examples, as a media type object holds them. */
type Examples = Record<string, { summary: string; value: unknown }>;

const json = (schema: Schema, examples?: Examples) => ({ "application/json": { schema, ...(examples && { examples }) } });

/** An operation of the API, as the endpoint table lists it. */
interface OperationSpec {
  id: string;
  route: HttpRoute;
  endpoint: Endpoint;
  input: z.ZodType | null;
  output: z.ZodType;
  /** The page's short description (meta, header, cards, llms.txt): the
   *  matching MCP tool page's, or the docs' own for an account route. */
  summary: string;
  /** The operation's full description, in the page body and openapi.json. */
  description?: string;
}

/** The routes that aren't tools: their operation ids and what they answer. */
const ACCOUNT_OPERATIONS: Record<keyof typeof ACCOUNT_ROUTES, { id: string; output: z.ZodType; summary: string }> = {
  me: { id: "me", output: meResult, summary: "The signed-in user the access token belongs to: their id, email and name." },
  authConfig: {
    id: "auth_config",
    output: authConfig,
    summary: "Where and how a client signs in with the device authorization flow. It needs no access token.",
  },
};

/** Every operation, in the endpoint table's order. */
export const OPERATIONS: OperationSpec[] = ENDPOINTS.map((endpoint) => {
  if (endpoint.tool) {
    const tool = TOOLS.find((t) => t.name === endpoint.tool);
    // The HTTP answer: the MCP tool's, less the `nextStep` only MCP carries.
    const output = responseDocFor(endpoint.tool)?.schema;
    if (!tool || !output) throw new Error(`no tool or response for ${endpoint.tool}`);
    const route = HTTP_ROUTES[endpoint.tool];
    const summary = MCP_TOOLS.find((t) => t.name === tool.name)?.human;
    if (!summary) throw new Error(`${tool.name} has no MCP tool page`);
    return { id: tool.name, route, endpoint, input: tool.input, output, summary, description: tool.description };
  }
  const key = (Object.keys(ACCOUNT_ROUTES) as Array<keyof typeof ACCOUNT_ROUTES>).find(
    (k) => ACCOUNT_ROUTES[k].method === endpoint.method && ACCOUNT_ROUTES[k].path === endpoint.path,
  );
  if (!key) throw new Error(`no route for ${endpoint.method} ${endpoint.path}`);
  const { id, output, summary } = ACCOUNT_OPERATIONS[key];
  return { id, route: ACCOUNT_ROUTES[key], endpoint, input: null, output, summary };
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
  const requests = EXAMPLE_REQUESTS[id as OperationId];
  const parameter = (name: string, where: "path" | "query") => {
    const schema = properties[name];
    if (!schema) throw new Error(`${id}: ${name} isn't an input field`);
    // The example requests share their path and query values.
    const example = requests[0]?.params?.[name];
    return {
      name,
      in: where,
      required: where === "path" || required.has(name),
      schema,
      ...(example !== undefined && { example }),
    };
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
    const examples = Object.fromEntries(
      requests.flatMap((request) => (request.body ? [[request.name, { summary: request.title, value: request.body }]] : [])),
    );
    requestBody = { required: true, content: json(body, examples) };
  }

  const error = ERRORS[errorExampleFor(id as OperationId)];
  const examples = (status: string): Examples =>
    status === "default"
      ? { [error.envelope.error.code]: { summary: `${error.status} ${error.envelope.error.code}`, value: error.envelope } }
      : id === "pay_order"
        ? Object.fromEntries(
            requests.map((request) => [request.name, { summary: request.title, value: PAY_RESPONSES[request.name as keyof typeof PAY_RESPONSES] }]),
          )
        : { [id]: { summary: endpoint.title, value: RESPONSES[id as OperationId] } };
  const responses = Object.fromEntries(
    Object.entries(answers(op)).map(([status, schema]) => {
      const response = {
        description: status === "default" ? "Error" : endpoint.title,
        content: json(answer(schema), examples(status)),
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
          description: `A Fortrip OAuth access token of the signed-in user. How to get one: [Authentication](${DOCS_ORIGIN}/api#authentication).`,
        },
      },
    },
  };
  // The bundled OpenAPI types can't hold JSON Schema 2020-12 (`const`, a schema
  // per path item method); the test validates the document against the 3.1 schema.
  return document as unknown as OpenAPIV3_1.Document;
}
