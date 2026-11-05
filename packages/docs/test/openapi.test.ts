import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { openapiV31 } from "@apidevtools/openapi-schemas";
import {
  ACCOUNT_ROUTES,
  CONTRACT_VERSION,
  DOCS_ORIGIN,
  errorEnvelope,
  HTTP_ROUTES,
  order,
  ORDER_HTTP,
  PUBLIC_ORIGINS,
  TOOLS,
} from "@fortrip/agent-contract";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { z } from "zod";

import { buildOpenApi, OPERATIONS, tidy } from "../lib/openapi/build.ts";
import { ENDPOINTS } from "../lib/reference/api-docs.ts";
import { EXAMPLE_REQUESTS } from "../lib/reference/examples.ts";
import { MCP_TOOLS } from "../lib/reference/mcp-tools.ts";
import { ERRORS, errorExampleFor, type OperationId, PAY_RESPONSES, RESPONSES } from "../lib/reference/responses.ts";
import { pageHtml, pageText } from "./built-page.ts";

const doc = buildOpenApi();
const METHODS = ["get", "post"] as const;

/** Every operation: `[path, method, operation]`. */
const operations = Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
  METHODS.filter((method) => item?.[method]).map((method) => [path, method, item![method]!] as const),
);

/** A JSON Schema as it stands alone, without `$schema`. */
const standalone = (schema: z.ZodType) => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io: "output" });
  return rest;
};

/** A response's JSON schema. */
const responseSchema = (response: unknown) =>
  (response as { content?: Record<string, { schema?: Record<string, unknown> }> }).content?.[
    "application/json"
  ]?.schema;

const ajv = () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats.default(ajv);
  // The 3.1 schema's format for a media type range, `application/*`; not checked.
  ajv.addFormat("media-range", true);
  return ajv;
};

describe("OpenAPI document", () => {
  it("validates as OpenAPI 3.1", () => {
    assert.match(doc.openapi ?? "", /^3\.1\.\d+$/);
    // Ajv resolves `$dynamicRef` only to a `$dynamicAnchor` at a schema's root,
    // and the 3.1 schema's `#meta` anchor is `$defs/schema`; Ajv would check
    // every Schema Object against the whole document's schema. Point the refs at
    // the anchor's schema, which is what they resolve to here.
    const text = JSON.stringify(openapiV31);
    const dynamicRef = '"$dynamicRef":"#meta"';
    assert.equal(text.split(dynamicRef).length - 1, 4, "the patch below still applies");
    const schema = JSON.parse(text.replaceAll(dynamicRef, '"$ref":"#/$defs/schema"'));
    assert.ok(schema.$defs.schema.$dynamicAnchor === "meta");
    const validate = ajv().compile(schema);
    assert.ok(validate(doc), JSON.stringify(validate.errors, null, 2));
  });

  it("states the contract's version and the API's origin", () => {
    assert.equal(doc.info?.version, CONTRACT_VERSION);
    assert.deepEqual(doc.servers, [{ url: PUBLIC_ORIGINS.api }]);
  });

  it("has an operation per route, named by its tool", () => {
    assert.equal(operations.length, 10);
    assert.equal(Object.keys(doc.paths ?? {}).length, 9);
    const ids = operations.map(([, , op]) => op.operationId).sort();
    assert.deepEqual(ids, [...Object.keys(HTTP_ROUTES), "auth_config", "me"].sort());
    for (const [name, route] of Object.entries(HTTP_ROUTES)) {
      const op = doc.paths?.[route.path]?.[route.method.toLowerCase() as "get" | "post"];
      assert.equal(op?.operationId, name);
      assert.equal(op?.description, TOOLS.find((tool) => tool.name === name)?.description);
    }
  });

  it("takes pay_order's method in its body", () => {
    const body = doc.paths?.["/v1/orders/{orderId}/pay"]?.post?.requestBody;
    assert.ok(body && !("$ref" in body));
    const schema = body.content?.["application/json"]?.schema as {
      properties: Record<string, { enum?: string[] }>;
    };
    assert.ok(schema.properties.method?.enum?.includes("alipay_wechat_pay"));
    // The path field is a parameter, not a body field.
    assert.equal("orderId" in schema.properties, false);
  });

  it("reads path and query fields as parameters, the rest of a POST as its body", () => {
    for (const [name, route] of Object.entries({ ...HTTP_ROUTES })) {
      const tool = TOOLS.find((t) => t.name === name);
      const op = doc.paths?.[route.path]?.[route.method.toLowerCase() as "get" | "post"];
      const params = (op?.parameters ?? []) as Array<{ name: string; in: string; required?: boolean }>;
      assert.deepEqual(
        params.map((p) => `${p.in}:${p.name}`),
        [...route.pathFields.map((f) => `path:${f}`), ...route.queryFields.map((f) => `query:${f}`)],
        name,
      );
      for (const p of params) if (p.in === "path") assert.equal(p.required, true, `${name} ${p.name}`);
      assert.ok(tool?.input, name);
      if (route.method === "GET") {
        assert.equal(op?.requestBody, undefined, name);
        // A GET drops no input field.
        const fields = Object.keys(
          (z.toJSONSchema(tool.input, { io: "input" }) as { properties: object }).properties,
        );
        assert.deepEqual(fields.sort(), params.map((p) => p.name).sort(), name);
      } else assert.ok(op?.requestBody, name);
    }
  });

  it("answers book_hotel 201, or 200 with the replay header", () => {
    const responses = doc.paths?.["/v1/orders"]?.post?.responses ?? {};
    assert.deepEqual(Object.keys(responses).sort(), [
      String(ORDER_HTTP.createdStatus),
      String(ORDER_HTTP.replayedStatus),
      "default",
    ].sort());
    const replayed = responses[String(ORDER_HTTP.replayedStatus)] as {
      headers?: Record<string, unknown>;
    };
    assert.ok(replayed.headers?.[ORDER_HTTP.replayedHeader]);
  });

  it("answers every other operation 200, and every failure with the error envelope", () => {
    for (const [path, method, op] of operations) {
      const failure = op.responses?.default as { content: Record<string, { schema: object }> };
      assert.deepEqual(
        failure.content["application/json"]?.schema,
        { $ref: "#/components/schemas/ErrorEnvelope" },
        `${method} ${path}`,
      );
      if (op.operationId === "book_hotel") continue;
      assert.deepEqual(Object.keys(op.responses ?? {}).sort(), ["200", "default"], op.operationId);
    }
  });

  it("writes a response schema that answers share once, under components", () => {
    assert.deepEqual(Object.keys(doc.components?.schemas ?? {}).sort(), ["ErrorEnvelope", "Order"]);
    assert.deepEqual(doc.components?.schemas?.ErrorEnvelope, tidy(standalone(errorEnvelope)));
    assert.deepEqual(doc.components?.schemas?.Order, tidy(standalone(order)));
    const orderAnswers = operations.flatMap(([, , op]) =>
      Object.entries(op.responses ?? {})
        .filter(([status]) => status !== "default")
        .filter(([, r]) => responseSchema(r)?.$ref === "#/components/schemas/Order")
        .map(([status]) => `${op.operationId} ${status}`),
    );
    assert.deepEqual(orderAnswers.sort(), [
      `book_hotel ${ORDER_HTTP.replayedStatus}`,
      `book_hotel ${ORDER_HTTP.createdStatus}`,
      "cancel_order 200",
      "get_order 200",
      "pay_order 200",
    ]);
    // No answer's schema is written out twice.
    const inline = operations.flatMap(([, , op]) =>
      Object.values(op.responses ?? {})
        .map(responseSchema)
        .filter((schema) => schema && !("$ref" in schema))
        .map((schema) => JSON.stringify(schema)),
    );
    assert.equal(new Set(inline).size, inline.length);
  });

  it("documents the HTTP answer, without MCP's nextStep", () => {
    assert.equal(JSON.stringify(doc).includes('"nextStep"'), false);
  });

  it("asks for a bearer token everywhere but the sign-in settings", () => {
    assert.deepEqual(
      (doc.components?.securitySchemes?.bearerAuth as { type: string; scheme: string }) && {
        type: (doc.components?.securitySchemes?.bearerAuth as { type: string }).type,
        scheme: (doc.components?.securitySchemes?.bearerAuth as { scheme: string }).scheme,
      },
      { type: "http", scheme: "bearer" },
    );
    for (const [, , op] of operations) {
      const expected = op.operationId === "auth_config" ? [] : [{ bearerAuth: [] }];
      assert.deepEqual(op.security, expected, op.operationId);
    }
    assert.ok(doc.paths?.[ACCOUNT_ROUTES.authConfig.path]?.get);
  });

  it("says nothing its schemas don't need: no safe-integer bounds, no empty additionalProperties", () => {
    const text = JSON.stringify(doc);
    assert.equal(text.includes(String(Number.MAX_SAFE_INTEGER)), false);
    assert.equal(text.includes('"additionalProperties":{}'), false);
    // A real bound stays.
    assert.ok(text.includes('"maximum":50'));
    assert.deepEqual(tidy({ a: { minimum: -Number.MAX_SAFE_INTEGER, maximum: 3, additionalProperties: {} }, b: [{ additionalProperties: false }] }), {
      a: { maximum: 3 },
      b: [{ additionalProperties: false }],
    });
  });

  it("links the bearer token to how to get one", () => {
    const scheme = doc.components?.securitySchemes?.bearerAuth as { description: string };
    assert.ok(scheme.description.includes(`(${DOCS_ORIGIN}/api#authentication)`), scheme.description);
  });

  it("gives every operation the example requests and answers, each valid under its schema", () => {
    const check = ajv();
    // Each component under its own id, references rewritten to it.
    const id = (name: string) => `https://openapi.test/components/${name}`;
    const resolved = (schema: object) =>
      JSON.parse(JSON.stringify(schema).replace(/"#\/components\/schemas\/(\w+)"/g, (_, n) => `"${id(n)}"`));
    for (const [name, schema] of Object.entries(doc.components?.schemas ?? {})) {
      check.addSchema(resolved(schema as object), id(name));
    }
    const valid = (schema: object, value: unknown, where: string) => {
      const validate = check.compile(resolved(schema));
      assert.ok(validate(value), `${where}: ${JSON.stringify(validate.errors)}`);
    };
    for (const [, , op] of operations) {
      const opId = op.operationId as OperationId;
      const requests = EXAMPLE_REQUESTS[opId];
      for (const p of (op.parameters ?? []) as Array<{ name: string; in: string; example?: unknown; schema: object }>) {
        const sent = requests[0]?.params?.[p.name];
        assert.equal(p.example, sent, `${opId} ${p.name}`);
        if (p.in === "path") assert.notEqual(sent, undefined, `${opId} ${p.name}: a path parameter has an example`);
        if (sent !== undefined) valid(p.schema, sent, `${opId} ${p.name}`);
      }
      const body = (op.requestBody as { content: Record<string, { schema: object; examples?: Record<string, { value: unknown }> }> } | undefined)?.content["application/json"];
      if (body) {
        assert.deepEqual(
          Object.fromEntries(Object.entries(body.examples ?? {}).map(([name, e]) => [name, e.value])),
          Object.fromEntries(requests.map((r) => [r.name, r.body])),
          opId,
        );
        for (const [name, e] of Object.entries(body.examples ?? {})) valid(body.schema, e.value, `${opId} body ${name}`);
      }
      for (const [status, response] of Object.entries(op.responses ?? {})) {
        const media = (response as { content: Record<string, { schema: object; examples?: Record<string, { value: unknown }> }> }).content["application/json"];
        const values = Object.values(media?.examples ?? {}).map((e) => e.value);
        const expected =
          status === "default"
            ? [ERRORS[errorExampleFor(opId)].envelope]
            : opId === "pay_order"
              ? Object.values(PAY_RESPONSES)
              : [RESPONSES[opId]];
        assert.deepEqual(values, expected, `${opId} ${status}`);
        for (const value of values) valid(media!.schema, value, `${opId} ${status}`);
      }
    }
  });

  it("embeds only valid JSON Schemas, referring only to its own components", () => {
    const text = JSON.stringify(doc);
    assert.equal(text.includes('"$schema"'), false);
    assert.equal(text.includes('"$defs"'), false);
    const names = Object.keys(doc.components?.schemas ?? {});
    const refs = [...text.matchAll(/"\$ref":"([^"]*)"/g)].map((m) => m[1]);
    assert.ok(refs.length > 0);
    for (const ref of refs) {
      const name = ref?.match(/^#\/components\/schemas\/(\w+)$/)?.[1];
      assert.ok(name && names.includes(name), ref);
    }

    // Each component under its own id, references rewritten to it.
    const id = (name: string) => `https://openapi.test/components/${name}`;
    const resolved = (schema: object) =>
      JSON.parse(
        JSON.stringify(schema).replace(/"#\/components\/schemas\/(\w+)"/g, (_, n) => `"${id(n)}"`),
      );
    const check = ajv();
    for (const [name, schema] of Object.entries(doc.components?.schemas ?? {})) {
      check.addSchema(resolved(schema as object), id(name));
    }
    for (const name of names) assert.ok(check.getSchema(id(name)), name);
    for (const [, , op] of operations) {
      const schemas = [
        ...((op.parameters ?? []) as Array<{ schema: object }>).map((p) => p.schema),
        ...Object.values(
          (op.requestBody as { content: Record<string, { schema: object }> } | undefined)
            ?.content ?? {},
        ).map((c) => c.schema),
        ...Object.values(op.responses ?? {}).map(responseSchema),
      ];
      for (const schema of schemas) {
        assert.ok(schema, op.operationId);
        assert.doesNotThrow(() => check.compile(resolved(schema)), op.operationId);
      }
    }
  });
});

// Reads the output of `next build`, which the package's test script runs first.
describe("built OpenAPI", () => {
  const app = new URL("../.next/server/app/", import.meta.url).pathname;

  it("serves the document at /openapi.json, built at build time", () => {
    const file = join(app, "openapi.json.body");
    assert.ok(existsSync(file), "a static /openapi.json");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), JSON.parse(JSON.stringify(doc)));
  });

  it("has a reference page per operation, linked from /api with the document", () => {
    for (const [, , op] of operations) {
      const html = pageHtml(`/api/reference/${op.operationId}`);
      assert.ok(html.includes(op.summary ?? "?"), op.operationId);
    }
    const api = pageHtml("/api");
    assert.ok(api.includes('href="/api/reference/'), "/api links the reference");
    assert.ok(api.includes('href="/openapi.json"'), "/api links the document");
  });

  it("samples each request with curl as the examples send it: the token, the example ids and body", () => {
    for (const op of OPERATIONS) {
      const html = pageHtml(`/api/reference/${op.id}`);
      // The highlighted sample, as the page's text holds it.
      const text = pageText(`/api/reference/${op.id}`);
      const auth = 'Authorization: Bearer $FORTRIP_TOKEN"';
      assert.equal(text.includes(auth), op.endpoint.auth, `${op.id}: the token`);
      assert.ok(!text.includes(`'Authorization`), `${op.id}: the token in single quotes isn't expanded`);
      assert.ok(text.includes(`curl -X ${op.route.method}`), op.id);
      for (const field of op.route.pathFields) {
        assert.ok(text.includes(String(EXAMPLE_REQUESTS[op.id as OperationId][0]?.params?.[field])), `${op.id}: ${field}`);
      }
      assert.doesNotMatch(text, /\/string\b|"string"/, op.id);
      assert.doesNotMatch(html, /9007199254740991|property1|additionalProp\d/, op.id);
      // One sample language: curl.
      assert.doesNotMatch(text, /\bfetch\(|import requests/, op.id);
    }
    // The body sent is the example's.
    assert.ok(pageText("/api/reference/search_hotels").includes('"countryCode": "JP"'));
    assert.ok(pageText("/api/reference/pay_order").includes("alipay_wechat_pay") || pageHtml("/api/reference/pay_order").includes("Alipay or WeChat Pay"));
  });

  it("quotes the tool description under its label, and sends no reader to the MCP page for it", () => {
    for (const op of OPERATIONS) {
      const text = pageText(`/api/reference/${op.id}`);
      const tool = MCP_TOOLS.find((t) => t.name === op.endpoint.tool);
      assert.doesNotMatch(text, /full rules agents follow/, op.id);
      if (!tool) continue;
      assert.ok(text.includes("What the model reads (tool description)"), op.id);
      assert.ok(text.includes(tool.summary), op.id);
    }
  });

  it("lists the reference in the endpoint table's order", () => {
    const expected = ENDPOINTS.map(
      (e) => e.tool ?? (e.path === ACCOUNT_ROUTES.me.path ? "me" : "auth_config"),
    );
    const listed = [
      ...new Set(
        [...pageHtml("/api/reference/me").matchAll(/href="\/api\/reference\/(\w+)"/g)].map(
          (m) => m[1],
        ),
      ),
    ];
    assert.deepEqual(listed, expected);
  });
});
