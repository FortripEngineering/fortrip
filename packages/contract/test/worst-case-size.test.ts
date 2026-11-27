import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { strictOutput } from "../src/conventions/open.ts";
import { offersPerHotel } from "../src/inputs.ts";
import { LIMITS } from "../src/limits.ts";
import { type HotelOffersResult, hotelOffersResult, UNAVAILABLE_REASONS } from "../src/outputs/offer.ts";
import { orderList } from "../src/outputs/order.ts";
import { type SearchResult, searchResult } from "../src/outputs/search.ts";
import { renderToolResult } from "../src/render/index.ts";
import { offerLine } from "../src/render/offers.ts";
import { PRESENTATION_HINT } from "../src/tools.ts";

/*
 * The largest results a call can answer, measured as the text a model
 * reads: the whole MCP text, with the rules and hints that end it. In
 * characters, since tokens cannot be counted offline. Three results: offers
 * (hotels with offers, each also saying what it left out, alone and with the
 * call's other hotels unavailable), a page of orders, and a page of search
 * results. Each is built from the fixtures' longest items repeated, not from
 * a bound of the schema: a real item can be longer than any fixture's, which
 * is why the limits leave headroom under the budget. The counts come from
 * `offersPerHotel` and `LIMITS`, so a change of a limit is measured too.
 */

/** Under this a result fits the tool-result caps of the clients measured. */
const BUDGET_CHARS = 48_000;

const fixture = (
  JSON.parse(
    readFileSync(new URL("./fixtures/v1/offers-two-hotels-one-unavailable.json", import.meta.url), "utf8"),
  ) as { data: HotelOffersResult }
).data;
const hotel = fixture.hotels[0]!;
const longest = hotel.offers.reduce((a, b) => (offerLine(b).length > offerLine(a).length ? b : a));

const id = (prefix: "htl" | "off", n: number) => `${prefix}_${String(n).padStart(20, "0")}`;

const omittedEvery = { byNationality: 12, byFilters: 12, dominated: 12, unreadable: 12, byLimit: 12, byCallLimit: 12 };

function unavailableLine(u: HotelOffersResult["unavailable"][number]): string {
  return renderToolResult("get_hotel_offers", { ...fixture, hotels: [], unavailable: [u] })
    .split("\n")
    .find((line) => line.startsWith("- Hotel "))!;
}

/** The unavailable hotel whose line is the longest the renderer writes: the
 *  longest reason, and offers left out for every reason. */
const longestUnavailable = UNAVAILABLE_REASONS.map((reason) => ({
  hotelId: id("htl", 0),
  reason,
  omitted: omittedEvery,
})).reduce((a, b) => (unavailableLine(b).length > unavailableLine(a).length ? b : a));

/** `hotels` hotels of `each` offers, each hotel with offers left out for
 *  every reason, and `unavailable` hotels with the longest unavailable line. */
function result(hotels: number, each: number, unavailable = 0): HotelOffersResult {
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
      omitted: omittedEvery,
    })),
    unavailable: Array.from({ length: unavailable }, (_, u) => ({ ...longestUnavailable, hotelId: id("htl", hotels + u) })),
  };
}

/** The characters a model reads for the result. */
function size(data: HotelOffersResult): number {
  strictOutput(hotelOffersResult).parse(data);
  const text = renderToolResult("get_hotel_offers", data);
  assert.equal(text.split("\n").filter((line) => /^\d+\. Offer off_/.test(line)).length, data.hotels.flatMap((h) => h.offers).length);
  assert.equal(text.split("\n").filter((line) => line.startsWith("- Hotel ")).length, data.unavailable.length);
  assert.ok(text.endsWith(`\n\n${PRESENTATION_HINT}`));
  return text.length;
}

/** For each number of hotels with offers a call can have: its offers, and
 *  the size of its text; with `fill`, the call's other hotels unavailable. */
function sizes(limitPerHotel: number | undefined, fill = false) {
  return Array.from({ length: LIMITS.offersHotels }, (_, i) => {
    const hotels = i + 1;
    const each = offersPerHotel(limitPerHotel, hotels);
    const unavailable = fill ? LIMITS.offersHotels - hotels : 0;
    return { hotels, unavailable, offers: hotels * each, chars: size(result(hotels, each, unavailable)) };
  });
}

describe("the largest offers result", () => {
  it(`at the default budget is under ${BUDGET_CHARS} characters`, () => {
    const all = sizes(undefined);
    const most = all.at(-1)!;
    // The most hotels a call takes, three offers each: the whole default budget.
    assert.deepEqual([most.hotels, most.offers], [LIMITS.offersHotels, LIMITS.offersPerCallDefault]);
    for (const { hotels, offers, chars } of all) {
      assert.ok(offers <= LIMITS.offersPerCallDefault, `${hotels} hotels: ${offers} offers`);
      assert.ok(chars < BUDGET_CHARS, `${hotels} hotels, ${offers} offers: ${chars} characters`);
    }
  });

  it(`at the ceiling of a call is under ${BUDGET_CHARS} characters`, () => {
    const all = sizes(LIMITS.offersPerHotelMax);
    // Some number of hotels fills the ceiling exactly.
    assert.equal(Math.max(...all.map((s) => s.offers)), LIMITS.offersPerCallMax);
    for (const { hotels, offers, chars } of all) {
      assert.ok(offers <= LIMITS.offersPerCallMax, `${hotels} hotels: ${offers} offers`);
      assert.ok(chars < BUDGET_CHARS, `${hotels} hotels, ${offers} offers: ${chars} characters`);
    }
  });

  it(`with the call's other hotels unavailable is under ${BUDGET_CHARS} characters`, () => {
    for (const limitPerHotel of [undefined, LIMITS.offersPerHotelMax]) {
      const all = sizes(limitPerHotel, true);
      for (const { hotels, unavailable, offers, chars } of all) {
        assert.equal(hotels + unavailable, LIMITS.offersHotels);
        assert.ok(chars < BUDGET_CHARS, `${hotels} hotels, ${offers} offers, ${unavailable} unavailable: ${chars} characters`);
      }
    }
  });
});

describe("the largest page of orders", () => {
  it(`is under ${BUDGET_CHARS} characters`, () => {
    const dir = new URL("./fixtures/v1/", import.meta.url);
    const fixtures = readdirSync(dir)
      .filter((name) => /^order-.*\.json$/.test(name))
      .map((name) => ({
        name,
        order: (JSON.parse(readFileSync(new URL(name, dir), "utf8")) as { data: unknown }).data,
      }));
    const pageOf = (order: unknown, n: number) => ({
      data: Array.from({ length: n }, () => order),
      nextCursor: "c".repeat(120),
    });
    // The longest order is the one that adds the most to a page: a page of it alone.
    const measured = fixtures.map((f) => ({ ...f, chars: renderToolResult("list_orders", pageOf(f.order, 1)).length }));
    const longest = measured.reduce((a, b) => (b.chars > a.chars ? b : a));
    const page = pageOf(longest.order, LIMITS.ordersPageSizeMax);
    strictOutput(orderList).parse(page);
    const text = renderToolResult("list_orders", page);
    assert.equal(text.split("\n").filter((line) => /^Order ord_/.test(line)).length, LIMITS.ordersPageSizeMax, text.slice(0, 600));
    assert.ok(text.length < BUDGET_CHARS, `${LIMITS.ordersPageSizeMax} of ${longest.name}: ${text.length} characters`);
  });
});

describe("the largest page of search results", () => {
  it(`is under ${BUDGET_CHARS} characters`, () => {
    const dir = new URL("./fixtures/v1/", import.meta.url);
    const fixtures = readdirSync(dir)
      .filter((name) => /^search-.*\.json$/.test(name))
      .map((name) => ({
        name,
        result: (JSON.parse(readFileSync(new URL(name, dir), "utf8")) as { data: SearchResult }).data,
      }));
    // Each fixture's page filled with copies of one of its hotels: the
    // longest row is the one whose page is the longest.
    const pages = fixtures.flatMap(({ name, result }) =>
      result.data.map((hotel) => {
        const page = { ...result, data: Array.from({ length: LIMITS.pageSizeMax }, () => hotel) };
        strictOutput(searchResult).parse(page);
        return { name, hotelId: hotel.hotelId, text: renderToolResult("search_hotels", page) };
      }),
    );
    assert.ok(pages.length > 0);
    const most = pages.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    assert.equal(
      most.text.split("\n").filter((line) => /^\d+\. Hotel: /.test(line)).length,
      LIMITS.pageSizeMax,
      most.text.slice(0, 600),
    );
    assert.ok(most.text.endsWith(`\n\n${PRESENTATION_HINT}`));
    assert.ok(
      most.text.length < BUDGET_CHARS,
      `${LIMITS.pageSizeMax} of ${most.hotelId} (${most.name}): ${most.text.length} characters`,
    );
  });
});
