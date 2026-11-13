import assert from "node:assert/strict";
import { test } from "node:test";

import { ERROR_CODES, ERROR_DETAILS, LIMITS, SUPPLIER_OUTCOME_STATUS } from "@fortrip/agent-contract";

import { RETRY_WAYS } from "../lib/prose/retries.ts";
import { detailFields, ERROR_ROWS } from "../lib/reference/error-docs.ts";

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

test("details are listed field by field, as the contract's shapes", () => {
  const details = (code: keyof typeof ERROR_CODES) =>
    ERROR_ROWS.find((row) => row.code === code)?.details;
  assert.deepEqual(details("cursor_invalid"), ['`reason`: `"expired" | "mismatch" | "malformed"`']);
  assert.deepEqual(details("payment_in_progress"), ["`orderId`: `string`"]);
  assert.deepEqual(details("supplier_unavailable"), ['`outcome`: `"not_started" | "unknown"`']);
  assert.deepEqual(details("stay_in_past"), ["`checkIn`: `string`", "`timeZone`: `string | null`"]);
  assert.deepEqual(details("payment_total_mismatch"), ["`orderId`: `string`", "`total`: `{ amount: string; currency: string }`"]);
  // A union lists each of its branches whole.
  assert.deepEqual(details("stay_unsupported"), ['`{ reason: "mixed_occupancy" }`', '`{ reason: "max_nights"; max: number }`']);
  assert.equal(details("destination_not_found")?.length, 3);
  assert.match(details("destination_not_found")?.[2] ?? "", /^`\{ reason: "not_a_locality"; placeId: string; hub: \{ placeId; name; names \} \| null; hubTotal: number \| null \}`$/);
  // offer_changed: each change's fields, and the new offer linked to its schema.
  assert.deepEqual(details("offer_changed"), [
    '`changes[]`: `{ field: "total" | "meals" | "cancellation" | "confirmation" | "payAtProperty"; previous; current; worse: boolean }`',
    "`offer`: [Offer](/schemas#offers)",
  ]);
  // Objects the schemas page describes link there; other nested objects name their fields.
  assert.ok(details("search_too_broad")?.includes("`localities`: [`coverage.localities`](/schemas#search-result)"));
  assert.ok(details("search_too_broad")?.includes("`center`: [`destination.center`](/schemas#search-result) or `null`"));
  assert.match(details("destination_ambiguous")?.find((line) => line.startsWith("`candidates[]`")) ?? "", /\{ placeId; name; names; .*; hotels \}/);
  assert.deepEqual(details("invalid_request"), ["`issues[]`: `{ pointer: string; message: string }`"]);
  // order_not_cancellable carries the order's cancel, by its fields' names.
  assert.deepEqual(details("order_not_cancellable"), ["`cancel`: `{ action; blockedBy; penalty; refund }`"]);
  assert.deepEqual(details("payment_method_unavailable"), [
    '`reason`: `"payment_open_on_page" | "token_not_offered" | "charge_refused"`',
  ]);
  assert.equal(details("client_outdated"), null);
  for (const row of ERROR_ROWS) {
    for (const line of row.details ?? []) assert.doesNotMatch(line, /\bobject\b/, `${row.code}: ${line}`);
  }
  assert.equal(detailFields(null), null);
});

test("the meanings say what the contract and its guide say", () => {
  const meaning = (code: keyof typeof ERROR_CODES) =>
    ERROR_ROWS.find((row) => row.code === code)?.meaning ?? "";
  assert.match(meaning("invalid_request"), /`issues` lists each problem: `pointer`, a JSON Pointer to the field, and `message`\.$/);
  assert.match(meaning("order_not_cancellable"), /`cancel` is the order's `cancel` as it is now/);
  assert.match(meaning("client_outdated"), /`message` says so and gives the command that updates it/);
  assert.match(
    meaning("destination_ambiguous"),
    new RegExp(`lists up to ${LIMITS.candidatesShown} with`),
  );
  // One offer, one order (the guide's offer_already_ordered row).
  assert.match(meaning("offer_already_ordered"), /An offer is ordered once, even when its order failed or expired/);
});

test("the pay cutoff and supplier_unavailable's statuses come from the contract", () => {
  const meaning = (code: keyof typeof ERROR_CODES) =>
    ERROR_ROWS.find((row) => row.code === code)?.meaning ?? "";
  assert.ok(
    meaning("order_not_payable").includes(`whose payment window closes within ${LIMITS.payCutoffMinutes} minutes`),
    meaning("order_not_payable"),
  );
  for (const [outcome, status] of Object.entries(SUPPLIER_OUTCOME_STATUS)) {
    assert.ok(meaning("supplier_unavailable").includes(`\`${outcome}\` (${status})`), outcome);
  }
});

test("the retry advice places exactly the codes a retry can help, each once", () => {
  const placed = Object.values(RETRY_WAYS).flat();
  assert.equal(new Set(placed).size, placed.length);
  assert.deepEqual(
    [...placed].sort(),
    ERROR_ROWS.filter((row) => row.retryable).map((row) => row.code).sort(),
  );
});
