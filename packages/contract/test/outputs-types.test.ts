import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Money } from "../src/conventions/money.ts";
import type { KnownBranch } from "../src/conventions/open.ts";
import type { CancelOrderInput, PayOrderInput, SearchHotelsInput } from "../src/inputs.ts";
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

/** The Money a request sends is typed as Money, not `unknown`. */
type MaxPerRoomNight = NonNullable<NonNullable<NonNullable<SearchHotelsInput["filters"]>["price"]>["maxPerRoomNight"]>;
const requestMoneyTyped: [
  IsUnknown<NonNullable<CancelOrderInput["maximumPenalty"]>>,
  IsUnknown<PayOrderInput["total"]>,
  IsUnknown<MaxPerRoomNight>,
] = [false, false, false];
const echoedPenalty: CancelOrderInput = {
  orderId: "ord_x",
  maximumPenalty: { amount: "12.50", currency: "EUR" } satisfies Money,
};

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

describe("v1 output and request Money types", () => {
  it("are checked by tsc", () => {
    assert.deepEqual(notUnknown, [false, false, false, false]);
    assert.deepEqual(requestMoneyTyped, [false, false, false]);
    assert.equal(echoedPenalty.maximumPenalty?.currency, "EUR");
    assert.ok([checkIn, previousTotal, changedFields, hubName, placeId].every((f) => typeof f === "function"));
  });
});
