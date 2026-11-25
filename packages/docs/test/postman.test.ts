import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { PUBLIC_ORIGINS } from "@fortrip/agent-contract";

import { OPERATIONS } from "../lib/openapi/build.ts";
import { buildPostmanCollection, POSTMAN_PATH } from "../lib/openapi/postman.ts";
import { EXAMPLE_REQUESTS } from "../lib/reference/examples.ts";
import type { OperationId } from "../lib/reference/responses.ts";
import { pageHtml } from "./built-page.ts";

const collection = buildPostmanCollection();

describe("Postman collection", () => {
  it("is a v2.1 collection on the API's origin, sending {{token}} as a bearer token", () => {
    assert.equal(collection.info.schema, "https://schema.getpostman.com/json/collection/v2.1.0/collection.json");
    assert.deepEqual(collection.auth, { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] });
    assert.equal(collection.variable.find((v) => v.key === "baseUrl")?.value, PUBLIC_ORIGINS.api);
  });

  it("has a request per operation, in the endpoint table's order, signed in unless the operation needs no sign-in", () => {
    assert.deepEqual(
      collection.item.map((item) => item.name),
      OPERATIONS.map((op) => op.endpoint.title),
    );
    for (const [i, op] of OPERATIONS.entries()) {
      const { request } = collection.item[i]!;
      assert.equal(request.method, op.route.method, op.id);
      assert.equal("auth" in request, !op.endpoint.auth, `${op.id}: noauth`);
      assert.ok(request.description.includes(`/reference/${op.id})`), `${op.id}: links its reference page`);
    }
  });

  it("sends each operation's example request: its path and query values and its body", () => {
    for (const [i, op] of OPERATIONS.entries()) {
      const { request } = collection.item[i]!;
      const example = EXAMPLE_REQUESTS[op.id as OperationId][0];
      const path = op.route.path.replace(/\{(\w+)\}/g, ":$1");
      assert.ok(request.url.raw.startsWith(`{{baseUrl}}${path}`), `${op.id}: ${request.url.raw}`);
      for (const field of op.route.pathFields) {
        const variable = request.url.variable?.find((v) => v.key === field);
        assert.equal(variable?.value, String(example?.params?.[field]), `${op.id}: ${field}`);
      }
      for (const field of op.route.queryFields) {
        const query = request.url.query?.find((q) => q.key === field);
        assert.ok(query, `${op.id}: ${field}`);
        const value = example?.params?.[field];
        assert.equal(query.disabled ?? false, value === undefined, `${op.id}: ${field} on only with a value`);
        if (value !== undefined) assert.ok(request.url.raw.includes(`${field}=${value}`), `${op.id}: ${field}`);
      }
      if (example?.body === undefined) assert.equal(request.body, undefined, op.id);
      else assert.deepEqual(JSON.parse(request.body?.raw ?? ""), example.body, op.id);
    }
  });

  it("saves each operation's successful answer as an example response", () => {
    for (const [i, op] of OPERATIONS.entries()) {
      const { response } = collection.item[i]!;
      assert.ok(response.length > 0, op.id);
      for (const answer of response) {
        assert.ok(answer.code >= 200 && answer.code < 300, op.id);
        assert.doesNotThrow(() => JSON.parse(answer.body), op.id);
      }
    }
  });
});

// Reads the output of `next build`, which the package's test script runs first.
describe("built Postman collection", () => {
  const app = new URL("../.next/server/app/", import.meta.url).pathname;

  it(`serves the collection at ${POSTMAN_PATH}, built at build time`, () => {
    const file = join(app, `${POSTMAN_PATH.slice(1)}.body`);
    assert.ok(existsSync(file), `a static ${POSTMAN_PATH}`);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), JSON.parse(JSON.stringify(collection)));
  });

  it("is offered on the API pages and every operation's page, and not elsewhere", () => {
    for (const route of ["/api", "/api-quickstart", ...OPERATIONS.map((op) => `/reference/${op.id}`)]) {
      assert.ok(pageHtml(route).includes(">Postman</button>"), route);
    }
    for (const route of ["/", "/quickstart", "/mcp", "/errors"]) {
      assert.ok(!pageHtml(route).includes(">Postman</button>"), route);
    }
  });
});
