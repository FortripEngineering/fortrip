import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import { request, unwrap } from "../src/api.ts";
import { CliError, EXIT } from "../src/errors.ts";

function response(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return { status, body, headers: new Headers(headers) };
}

function exitCodeOf(fn: () => unknown): number {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CliError);
    return error.exitCode;
  }
  assert.fail("expected a CliError");
}

describe("unwrap", () => {
  it("returns data on success", () => {
    assert.deepEqual(unwrap(response(200, { success: true, data: { a: 1 } })), {
      a: 1,
    });
  });

  it("maps statuses onto the fixed exit codes", () => {
    assert.equal(
      exitCodeOf(() => unwrap(response(401, { success: false, error: "Unauthorized" }))),
      EXIT.unauthenticated,
    );
    assert.equal(
      exitCodeOf(() => unwrap(response(400, { success: false, error: "Invalid request" }))),
      EXIT.usage,
    );
    assert.equal(
      exitCodeOf(() => unwrap(response(429, { success: false }, { "retry-after": "12" }))),
      EXIT.rateLimited,
    );
    assert.equal(
      exitCodeOf(() => unwrap(response(422, { success: false, error: "x" }))),
      EXIT.error,
    );
    assert.equal(exitCodeOf(() => unwrap(response(307, {}))), EXIT.error);
  });

  it("keeps the API's extra fields and Retry-After in the details", () => {
    try {
      unwrap(
        response(
          429,
          { success: false, error: "Too many search requests" },
          { "retry-after": "12" },
        ),
      );
    } catch (error) {
      assert.ok(error instanceof CliError);
      assert.equal(error.message, "Too many search requests");
      assert.deepEqual(error.details, { status: 429, retryAfterSeconds: 12 });
    }
    try {
      unwrap(
        response(400, {
          success: false,
          error: "Invalid request",
          issues: [{ path: "checkIn", message: "Required" }],
        }),
      );
    } catch (error) {
      assert.ok(error instanceof CliError);
      assert.deepEqual(error.details, {
        status: 400,
        issues: [{ path: "checkIn", message: "Required" }],
      });
    }
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
    const error = await failure(request(url, "/api/x"));
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
      (url) => failure(request(url, "/api/x")),
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
      [500, '{"success":false,"error":"server_error"}', undefined],
      [
        503,
        '{"success":false,"error":"Supplier unavailable","reason":"supplier_unavailable","retryable":true}',
        true,
      ],
      [404, "<html>Not found</html>", undefined],
    ] as const) {
      const error = await withServer(answer(status, body), (url) =>
        failure(request(url, "/api/x")),
      );
      assert.equal(error.exitCode, EXIT.error, `${status} ${body}`);
      assert.equal(error.details.retryable, retryable, `${status} ${body}`);
    }
  });

  it("a 401 doesn't send agents to the blocking login command", () => {
    assert.throws(
      () => unwrap(response(401, { success: false, error: "Unauthorized" })),
      (error) => error instanceof CliError && !/fortrip login/.test(error.message),
    );
  });
});
