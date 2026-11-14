import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { strictOutput } from "../src/conventions/open.ts";
import { offersPerHotel } from "../src/inputs.ts";
import { LIMITS } from "../src/limits.ts";
import { type HotelOffersResult, hotelOffersResult } from "../src/outputs/offer.ts";
import { renderToolResult } from "../src/render/index.ts";
import { offerLine } from "../src/render/offers.ts";
import { PRESENTATION_HINT } from "../src/tools.ts";

/*
 * The largest offers result a call can answer, measured as the
 * text a model reads: the whole MCP text, which ends with the presentation
 * hint. In characters, since tokens cannot be counted offline.
 * The offers are the fixture's longest, every hotel also says what it left
 * out, and the counts come from `offersPerHotel` and `LIMITS`, so a change
 * of the budget is measured too.
 */

/** Under these a result fits the tool-result caps of the clients measured. */
const DEFAULT_BUDGET_CHARS = 48_000;
const CEILING_CHARS = 100_000;

const fixture = (
  JSON.parse(
    readFileSync(new URL("./fixtures/v1/offers-two-hotels-one-unavailable.json", import.meta.url), "utf8"),
  ) as { data: HotelOffersResult }
).data;
const hotel = fixture.hotels[0]!;
const longest = hotel.offers.reduce((a, b) => (offerLine(b).length > offerLine(a).length ? b : a));

const id = (prefix: "htl" | "off", n: number) => `${prefix}_${String(n).padStart(20, "0")}`;

/** `hotels` hotels of `each` offers, each hotel with offers left out for every reason. */
function result(hotels: number, each: number): HotelOffersResult {
  return {
    ...fixture,
    hotels: Array.from({ length: hotels }, (_, h) => ({
      ...hotel,
      hotelId: id("htl", h),
      offers: Array.from({ length: each }, (_, o) => ({
        ...longest,
        hotelId: id("htl", h),
        offerId: id("off", h * LIMITS.offersPerCallMax + o),
      })),
      omitted: { byNationality: 12, byFilters: 12, dominated: 12, unreadable: 12, byLimit: 12, byCallLimit: 12 },
    })),
    unavailable: [],
  };
}

/** The characters a model reads for the result. */
function size(data: HotelOffersResult): number {
  strictOutput(hotelOffersResult).parse(data);
  const text = renderToolResult("get_hotel_offers", data);
  assert.equal(text.split("\n").filter((line) => /^\d+\. Offer off_/.test(line)).length, data.hotels.flatMap((h) => h.offers).length);
  assert.ok(text.endsWith(`\n\n${PRESENTATION_HINT}`));
  return text.length;
}

/** For each number of hotels a call can have: its offers, and the size of its text. */
function sizes(limitPerHotel: number | undefined) {
  return Array.from({ length: LIMITS.offersHotels }, (_, i) => {
    const hotels = i + 1;
    const each = offersPerHotel(limitPerHotel, hotels);
    return { hotels, offers: hotels * each, chars: size(result(hotels, each)) };
  });
}

describe("the largest offers result", () => {
  it(`at the default budget is under ${DEFAULT_BUDGET_CHARS} characters`, () => {
    const all = sizes(undefined);
    const most = all.at(-1)!;
    // The most hotels a call takes, three offers each: the whole default budget.
    assert.deepEqual([most.hotels, most.offers], [LIMITS.offersHotels, LIMITS.offersPerCallDefault]);
    for (const { hotels, offers, chars } of all) {
      assert.ok(offers <= LIMITS.offersPerCallDefault, `${hotels} hotels: ${offers} offers`);
      assert.ok(chars < DEFAULT_BUDGET_CHARS, `${hotels} hotels, ${offers} offers: ${chars} characters`);
    }
  });

  it(`at the ceiling of a call is under ${CEILING_CHARS} characters`, () => {
    const all = sizes(LIMITS.offersPerHotelMax);
    // Some number of hotels fills the ceiling exactly.
    assert.equal(Math.max(...all.map((s) => s.offers)), LIMITS.offersPerCallMax);
    for (const { hotels, offers, chars } of all) {
      assert.ok(offers <= LIMITS.offersPerCallMax, `${hotels} hotels: ${offers} offers`);
      assert.ok(chars < CEILING_CHARS, `${hotels} hotels, ${offers} offers: ${chars} characters`);
    }
  });
});
