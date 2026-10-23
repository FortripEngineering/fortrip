import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KnownBranch } from "../src/conventions/open.ts";
import type { ErrorEnvelope, KnownErrorBody } from "../src/outputs/error-details.ts";
import type { OfferChange, Order } from "../src/outputs/order.ts";
import type { SearchResult } from "../src/outputs/search.ts";

/*
 * Type-level checks, enforced by `tsc` (the package's `typecheck`): the types
 * inferred through `openUnion` are not `unknown`, and a known branch narrows
 * by its discriminator. The runtime test only keeps the file in the suite.
 */

type IsUnknown<T> = unknown extends T ? true : false;

const notUnknown: [
  IsUnknown<Order["items"][number]>,
  IsUnknown<OfferChange>,
  IsUnknown<ErrorEnvelope["error"]>,
  IsUnknown<SearchResult["destination"]>,
] = [false, false, false, false];

function checkIn(item: Order["items"][number]): string | null {
  const known = item as KnownBranch<typeof item, "type">;
  return known.type === "hotel" ? known.hotel.checkIn : null;
}

function previousTotal(change: OfferChange): string | null {
  const known = change as KnownBranch<OfferChange, "field">;
  return known.field === "price" ? known.previous.amount : null;
}

function changedFields(body: KnownErrorBody): string[] {
  if (body.code !== "offer_changed") return [];
  return (body.details?.changes ?? []).map((c) => c.field);
}

function hubName(body: KnownErrorBody): string | null {
  if (body.code !== "destination_not_found" || !body.details) return null;
  const d = body.details as KnownBranch<typeof body.details, "reason">;
  return d.reason === "not_a_locality" ? (d.hub?.name ?? null) : null;
}

function placeId(result: SearchResult): string | null {
  const d = result.destination as KnownBranch<SearchResult["destination"], "kind"> | null;
  return d?.kind === "place" ? d.place.placeId : null;
}

describe("v1 output types", () => {
  it("are checked by tsc", () => {
    assert.deepEqual(notUnknown, [false, false, false, false]);
    assert.ok([checkIn, previousTotal, changedFields, hubName, placeId].every((f) => typeof f === "function"));
  });
});
