import assert from "node:assert/strict";
import { test } from "node:test";

import { ERROR_CODES, ERROR_DETAILS, LIMITS } from "@fortrip/agent-contract";

import { detailsShape, ERROR_ROWS } from "../lib/reference/error-docs.ts";

test("every contract error code has exactly one row, with its status and retry rule", () => {
  assert.deepEqual(
    ERROR_ROWS.map((row) => row.code),
    Object.keys(ERROR_CODES),
  );
  for (const row of ERROR_ROWS) {
    const spec = ERROR_CODES[row.code];
    assert.equal(row.status, spec.status.join(" / "), row.code);
    assert.equal(row.retryable, spec.retryable, row.code);
    assert.ok(row.meaning.length > 20, `${row.code} says when it happens`);
    assert.equal(
      row.details === null,
      ERROR_DETAILS[row.code] === null,
      `${row.code}: details`,
    );
  }
});

test("details read as the shapes in the contract", () => {
  const details = (code: keyof typeof ERROR_CODES) =>
    ERROR_ROWS.find((row) => row.code === code)?.details;
  assert.equal(
    details("cursor_invalid"),
    '{ reason: "expired" | "mismatch" | "malformed" }',
  );
  assert.equal(
    details("order_removed"),
    "{ orderId: string; reference: string }",
  );
  assert.equal(
    details("stay_unsupported"),
    '{ reason: "mixed_occupancy" } or { reason: "max_nights"; max: number }',
  );
  assert.equal(
    details("supplier_unavailable"),
    '{ outcome: "not_started" | "unknown" }',
  );
  assert.equal(
    details("stay_in_past"),
    "{ checkIn: string; timeZone: string | null }",
  );
  // Nested objects are named, not spelled out.
  assert.match(
    details("destination_ambiguous") ?? "",
    /candidates: object\[\]/,
  );
  assert.match(
    details("destination_not_found") ?? "",
    /^\{ reason: "no_match";/,
  );
  assert.match(
    details("destination_not_found") ?? "",
    / or \{ reason: "not_a_locality";/,
  );
  // A nested object of scalars is spelled out.
  assert.match(
    details("invalid_request") ?? "",
    /^\{ issues: \{ pointer: string; message: string \}\[\]; filterable\?: .+; share\?: \{ code: string; listedShare: number \} \}$/,
  );
  assert.equal(detailsShape(null), null);
});

test("the meanings say what the contract and its guide say", () => {
  const meaning = (code: keyof typeof ERROR_CODES) =>
    ERROR_ROWS.find((row) => row.code === code)?.meaning ?? "";
  assert.match(
    meaning("invalid_request"),
    /`listedShare` is the fraction, from 0 to 1, of the hotels that list facilities/,
  );
  assert.match(
    meaning("destination_ambiguous"),
    new RegExp(`lists up to ${LIMITS.candidatesShown} with`),
  );
  // The guide's order_exists cases (renderGuide "cli" main).
  for (const blocked of [
    /open order for one of these guests/,
    /A party with none of its guests can order the stay/,
    /once the stay's order is confirmed, cancelled or refused by the hotel/,
    /earlier order failed at the hotel with its outcome unknown/,
    /the stay has had 20 orders/,
  ]) {
    assert.match(meaning("order_exists"), blocked);
  }
});
