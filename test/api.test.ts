import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unwrap } from "../src/api.ts";
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
