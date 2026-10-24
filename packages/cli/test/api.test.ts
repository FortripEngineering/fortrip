import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import { request, unwrap } from "../src/api.ts";
import { CliError, EXIT } from "../src/errors.ts";

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return { status, body, headers: new Headers(headers) };
}

/** The v1 error envelope (spec §11). */
function envelope(code: string, message = "Something", extra: Record<string, unknown> = {}) {
  return { error: { code, message, retryable: false, requestId: "req_1", ...extra } };
}

function failureOf(fn: () => unknown): CliError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CliError, String(error));
    return error;
  }
  assert.fail("expected a CliError");
}

const exitCodeOf = (fn: () => unknown) => failureOf(fn).exitCode;

describe("unwrap", () => {
  it("returns a 2xx body as it is: the resource", () => {
    assert.deepEqual(unwrap(response(200, { a: 1 })), { a: 1 });
    assert.deepEqual(unwrap(response(201, { orderId: "ord_1" })), { orderId: "ord_1" });
    // A field named like 2.0's envelope is just a field.
    assert.deepEqual(unwrap(response(200, { success: true, data: 1 })), { success: true, data: 1 });
  });

  it("maps error codes onto the exit codes", () => {
    assert.equal(exitCodeOf(() => unwrap(response(401, envelope("unauthenticated")))), EXIT.unauthenticated);
    assert.equal(exitCodeOf(() => unwrap(response(429, envelope("rate_limited")))), EXIT.rateLimited);
    assert.equal(exitCodeOf(() => unwrap(response(400, envelope("invalid_request")))), EXIT.usage);
    for (const [status, code] of [
      [400, "cursor_invalid"],
      [404, "not_found"],
      [409, "offer_changed"],
      [422, "destination_ambiguous"],
      [503, "supplier_unavailable"],
      [500, "internal"],
    ] as const) {
      assert.equal(exitCodeOf(() => unwrap(response(status, envelope(code)))), EXIT.error, code);
    }
  });

  it("an unknown code falls back to the HTTP status", () => {
    for (const [status, exit] of [
      [400, EXIT.usage],
      [401, EXIT.unauthenticated],
      [429, EXIT.rateLimited],
      [409, EXIT.error],
      [503, EXIT.error],
    ] as const) {
      assert.equal(exitCodeOf(() => unwrap(response(status, envelope("brand_new_code")))), exit, String(status));
    }
    // The code decides when it is known, whatever the status.
    assert.equal(exitCodeOf(() => unwrap(response(422, envelope("invalid_request")))), EXIT.usage);
  });

  it("keeps the envelope and the status on the error", () => {
    const body = envelope("offer_expired", "The offer expired", {
      details: { offerId: "off_1", expiredAt: "2026-11-10T00:00:00Z" },
    });
    const error = failureOf(() => unwrap(response(409, body)));
    assert.deepEqual(error.envelope, body);
    assert.equal(error.details.status, 409);
    assert.equal(error.message, "The offer expired");
  });

  it("a body that isn't the envelope falls back to the status", () => {
    for (const [status, body, exit] of [
      [400, { error: "old style" }, EXIT.usage],
      [401, null, EXIT.unauthenticated],
      [429, {}, EXIT.rateLimited],
      [404, null, EXIT.error],
    ] as const) {
      const error = failureOf(() => unwrap(response(status, body)));
      assert.equal(error.exitCode, exit, `${status} ${JSON.stringify(body)}`);
      assert.equal(error.envelope, undefined);
      assert.equal(error.details.status, status);
    }
  });

  it("a 429 without an envelope says how long to wait from Retry-After", () => {
    const error = failureOf(() => unwrap(response(429, null, { "retry-after": "12" })));
    assert.equal(error.details.retryAfterSeconds, 12);
  });

  it("a redirect is an error naming FORTRIP_API_URL", () => {
    const error = failureOf(() => unwrap(response(307, null, { location: "https://elsewhere.test/" })));
    assert.equal(error.exitCode, EXIT.error);
    assert.match(error.message, /https:\/\/elsewhere\.test\/.*FORTRIP_API_URL/);
  });
});

describe("transport errors", () => {
  /** Runs `fn` against a one-off server answering with `handler`. */
  async function withServer<T>(
    handler: RequestListener,
    fn: (url: string) => Promise<T>,
  ): Promise<T> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }

  async function failure(promise: ReturnType<typeof request>): Promise<CliError> {
    try {
      unwrap(await promise);
    } catch (error) {
      assert.ok(error instanceof CliError);
      return error;
    }
    assert.fail("expected a CliError");
  }

  it("an unreachable server is retryable", async () => {
    const url = await withServer(
      () => {},
      async (url) => url,
    );
    const error = await failure(request(url, "/v1/x"));
    assert.equal(error.exitCode, EXIT.error);
    assert.equal(error.details.retryable, true);
  });

  it("a connection dropped mid-response is retryable", async () => {
    const error = await withServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "application/json", "content-length": "100" });
        res.write('{"success":');
        setTimeout(() => res.socket?.destroy(), 20);
      },
      (url) => failure(request(url, "/v1/x")),
    );
    assert.equal(error.exitCode, EXIT.error);
    assert.equal(error.details.retryable, true);
  });

  it("a 5xx that isn't the API's JSON is retryable; the API's own 5xx says for itself", async () => {
    const answer = (status: number, body: string): RequestListener =>
      (_req, res) => {
        res.writeHead(status, { "content-type": "text/html" });
        res.end(body);
      };
    for (const [status, body, retryable] of [
      [502, "<html>Bad gateway</html>", true],
      [504, "", true],
      [500, JSON.stringify(envelope("internal")), undefined],
      [
        503,
        JSON.stringify(envelope("supplier_unavailable", "Supplier unavailable", { retryable: true })),
        true,
      ],
      [404, "<html>Not found</html>", undefined],
    ] as const) {
      const error = await withServer(answer(status, body), (url) =>
        failure(request(url, "/v1/x")),
      );
      assert.equal(error.exitCode, EXIT.error, `${status} ${body}`);
      assert.equal(error.details.retryable, retryable, `${status} ${body}`);
    }
  });

  it("the API's own retryable 503 says so in its envelope", async () => {
    const body = envelope("service_unavailable", "Try again", { retryable: true, retryAfterSeconds: 5 });
    const error = await withServer(
      (_req, res) => {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      },
      (url) => failure(request(url, "/v1/x")),
    );
    assert.deepEqual(error.envelope, body);
  });

  it("a 401 doesn't send agents to the blocking login command", () => {
    assert.throws(
      () => unwrap(response(401, envelope("unauthenticated", "Unauthorized"))),
      (error) => error instanceof CliError && !/fortrip login/.test(error.message),
    );
  });
});
