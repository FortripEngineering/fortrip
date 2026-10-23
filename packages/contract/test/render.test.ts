import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import { strictOutput } from "../src/conventions/open.ts";
import { strictErrorEnvelope } from "../src/outputs/error-details.ts";
import { renderError, renderToolResult } from "../src/render/index.ts";
import { ORDER_NEXT_STEP, TOOLS, type ToolName } from "../src/tools.ts";

/*
 * Goldens: each fixture in fixtures/v1 is synthetic (no supplier names or
 * ids) and valid under the strict schema; its rendering must equal the
 * `.txt` next to it. UPDATE_GOLDENS=1 rewrites the `.txt` files.
 */

type RenderTool = Exclude<ToolName, "get_planning_guide">;
type ToolFixture = { tool: RenderTool; data: Record<string, unknown> };
type ErrorFixture = { status: number; envelope: { error: Record<string, unknown> } };
type Fixture = ToolFixture | ErrorFixture;

const DIR = new URL("./fixtures/v1/", import.meta.url);
const GOLDENS = [
  "search-shanghai-area",
  "search-locality-phuket",
  "search-pool-limited",
  "search-empty",
  "error-search-too-broad-bali",
  "error-search-too-broad-text-only",
  "error-destination-ambiguous-suzhou",
  "error-not-a-locality-patong",
  "hotel-long-description",
  "offers-two-hotels-one-unavailable",
  "order-awaiting-payment",
  "order-confirmed",
  "list-orders",
] as const;
type Golden = (typeof GOLDENS)[number];

function load(name: Golden): Fixture {
  return JSON.parse(readFileSync(new URL(`${name}.json`, DIR), "utf8")) as Fixture;
}

/** A deep copy to change in a test. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

function render(fixture: Fixture): string {
  return "tool" in fixture
    ? renderToolResult(fixture.tool, fixture.data)
    : renderError(fixture.envelope, fixture.status);
}

function outputOf(tool: RenderTool) {
  const schema = TOOLS.find((t) => t.name === tool)?.output;
  assert.ok(schema, tool);
  return schema;
}

const ID = /^(?:(?:htl|off|ord)_[0-9A-Za-z]{20}|plc_\d{1,12})$/;

/**
 * Every id in a value, except a hotel's `address.region`: the region's name
 * is shown on each hotel line, its id only on the hotel's own page.
 */
function idsIn(value: unknown, path: string[] = []): string[] {
  if (typeof value === "string") return ID.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((v) => idsIn(v, path));
  if (value && typeof value === "object") {
    if (path.at(-1) === "region" && path.at(-2) === "address") return [];
    return Object.entries(value).flatMap(([k, v]) => idsIn(v, [...path, k]));
  }
  return [];
}

/** Every string under `key` anywhere in a value. */
function stringsAt(value: unknown, key: string): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => stringsAt(v, key));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      k === key && typeof v === "string" ? [v] : stringsAt(v, key),
    );
  }
  return [];
}

function assertClean(text: string) {
  assert.doesNotMatch(text, /undefined|\bnull\b|\[object|NaN/);
}

describe("render fixtures", () => {
  for (const name of GOLDENS) {
    describe(name, () => {
      const fixture = load(name);

      it("is valid under the strict schema", () => {
        if ("tool" in fixture) {
          strictOutput(outputOf(fixture.tool)).parse(fixture.data);
        } else {
          strictErrorEnvelope().parse(fixture.envelope);
        }
      });

      it("renders every id verbatim and no undefined, null or [object", () => {
        const text = render(fixture);
        const ids = idsIn("tool" in fixture ? fixture.data : fixture.envelope);
        assert.ok(ids.length > 0);
        for (const id of ids) assert.ok(text.includes(id), `${id} missing`);
        assertClean(text);
      });

      it("equals its golden (UPDATE_GOLDENS=1 rewrites it)", () => {
        const text = render(fixture);
        const golden = new URL(`${name}.txt`, DIR);
        if (process.env.UPDATE_GOLDENS === "1") writeFileSync(golden, text + "\n");
        assert.ok(existsSync(golden), "no golden: run with UPDATE_GOLDENS=1");
        assert.equal(text + "\n", readFileSync(golden, "utf8"));
      });
    });
  }

  it("has a golden for every fixture", () => {
    const names = readdirSync(DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length))
      .sort();
    assert.deepEqual(names, [...GOLDENS].sort());
  });
});

describe("search results", () => {
  it("writes every note's message", () => {
    for (const name of GOLDENS.filter((n) => n.startsWith("search-"))) {
      const fixture = load(name) as ToolFixture;
      const text = render(fixture);
      const notes = fixture.data.notes as { code: string; message: string }[];
      assert.ok(notes.length > 0, name);
      for (const note of notes) assert.ok(text.includes(note.message), `${name}: ${note.code}`);
    }
  });

  it("heads a locality search as 'Phuket (locality) · 2,752 hotels'", () => {
    const text = render(load("search-locality-phuket"));
    assert.ok(text.split("\n")[0]!.startsWith("Phuket (locality) · 2,752 hotels"), text);
    assert.match(text, /2026-12-20 → 2026-12-27/);
    assert.match(text, /2 rooms, each 2 adults and 1 child \(age 7\)/);
  });

  it("says a pool-limited price sort is the cheapest within the pool radius", () => {
    const text = render(load("search-pool-limited"));
    assert.ok(text.includes("cheapest within 9.0 km of Shanghai"), text);
  });

  it("lists localities with ids, counts, includes and how to pass one back", () => {
    const text = render(load("search-shanghai-area"));
    assert.ok(
      text.includes(
        "Pudong plc_9100021 4,120 (incl. Lujiazui plc_9100022, 359 hotels overall)",
      ),
      text,
    );
    assert.ok(text.includes("Jing'an plc_9100011, 512 hotels overall; Huangpu"), text);
    assert.ok(text.includes('{ kind: "locality", placeId }'), text);
    assert.match(text, /never the name/);
    assert.ok(text.includes("112 more localities; name one with place_name"), text);
    assert.match(text, /351 hotels .*no locality/);
  });

  it("labels a hub named like the searched area as not the whole area", () => {
    const text = render(load("search-shanghai-area"));
    const line = text.split("\n").find((l) => l.includes("plc_9100002 6,953"));
    assert.ok(line, text);
    assert.match(line, /the locality, not the whole of Shanghai/);
    assert.match(line, /incl\. Jing'an/);
  });

  it("shows count and total when a locality reaches beyond the scope", () => {
    const fixture = copy(load("search-shanghai-area")) as ToolFixture;
    const loc = (fixture.data.coverage as { localities: { items: { total: number }[] } })
      .localities.items[1]!;
    loc.total = 5000;
    const text = render(fixture);
    assert.ok(text.includes("Pudong plc_9100021 4,120 here, 5,000 as a locality"), text);
  });

  it("writes unknowns out: stars, address, distance and price", () => {
    const text = render(load("search-shanghai-area"));
    const line = text.split("\n").find((l) => l.includes("htl_NoAddress"));
    assert.ok(line);
    assert.match(line, /stars not listed/);
    assert.match(line, /address not listed/);
    assert.match(line, /distance unknown/);
    assert.match(line, /no indicative price/);
  });

  it("says a next page takes the cursor and, optionally, limit", () => {
    const text = render(load("search-shanghai-area"));
    assert.ok(
      text.endsWith('Next page: call again with only the cursor and, optionally, limit: { cursor: "c_shanghai_area_page_2" }.'),
      text,
    );
  });

  it("says when nothing matched and what to try", () => {
    const text = render(load("search-empty"));
    assert.match(text, /No hotels on this page/);
    assert.match(text, /text "Ritz Carlton"/);
  });

  it("renders an unknown note code with its message", () => {
    const fixture = copy(load("search-locality-phuket")) as ToolFixture;
    (fixture.data.notes as unknown[]).push({ code: "new_kind_of_note", message: "Something new." });
    const text = render(fixture);
    assert.ok(text.includes("new_kind_of_note"));
    assert.ok(text.includes("Something new."));
  });

  it("keeps going on unknown fields and values, showing the raw value", () => {
    const fixture = copy(load("search-shanghai-area")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    data.somethingNew = { deep: [1, 2] };
    data.sort = "vibes_desc";
    data.pricing.scope = "galaxy";
    data.destination.scope = "orbit";
    data.destination.place.kind = "archipelago";
    data.coverage.localities.items[0].somethingNew = true;
    data.data[0].price.basis = "lowest_bed";
    const text = render(fixture);
    assert.match(text, /vibes_desc/);
    assert.match(text, /orbit/);
    assert.match(text, /archipelago/);
    assertClean(text);
  });

  it("keeps going on an unknown destination kind, even when the pool is limited", () => {
    const fixture = copy(load("search-pool-limited")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    data.destination = { kind: "polygon", scope: "radius", radiusMeters: 5000 };
    const text = render(fixture);
    assert.match(text.split("\n")[0]!, /^Destination of kind polygon · 8,412 hotels/);
    assert.ok(text.includes("cheapest within 9.0 km of the center"), text);
    assertClean(text);
  });

  it("renders a point and a text-only search", () => {
    const fixture = copy(load("search-empty")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    data.destination = {
      kind: "point",
      center: { location: { lat: 42.8, lng: 140.69 }, place: null, basis: "point" },
      scope: "radius",
      radiusMeters: 5000,
      radiusSource: "requested",
    };
    let text = render(fixture);
    assert.match(text.split("\n")[0]!, /^Point 42\.8, 140\.69 \(within 5\.0 km\)/);
    data.destination = null;
    text = render(fixture);
    assert.match(text.split("\n")[0]!, /^Text "Ritz Carlton"/);
    assertClean(text);
  });

  it("says prices are unavailable when the lookup failed", () => {
    const fixture = copy(load("search-shanghai-area")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    data.pricing.status = "unavailable";
    data.coverage.withPrice = null;
    for (const h of data.data) h.price = null;
    const text = render(fixture);
    assert.match(text, /indicative prices unavailable/);
    const lines = text.split("\n").filter((l) => /^\d+\. /.test(l));
    assert.equal(lines.length, 4);
    for (const line of lines) {
      assert.match(line, /price unavailable this time/);
      assert.doesNotMatch(line, /no indicative price/);
    }
    assertClean(text);
  });
});

describe("errors that lead to a next call", () => {
  it("search_too_broad lists localities and the next request", () => {
    const text = render(load("error-search-too-broad-bali"));
    for (const part of [
      "Denpasar plc_9400001 3,911 (incl. Kuta plc_9400011, 1,205 hotels overall;",
      "Ubud plc_9400002 1,762",
      "Jimbaran plc_9400003 728",
      '{ kind: "locality", placeId: "<id>" }',
      "the same text, filters, stay and sort",
      "show the user these localities and ask which they prefer, unless their request already names one of them",
      "31 more localities; name one with place_name",
    ]) {
      assert.ok(text.includes(part), `${part}\n---\n${text}`);
    }
  });

  type TooBroad = {
    localities: { items: { count: number; total: number }[] };
    center: { place: { placeId: string } | null } | null;
  };
  const tooBroad = (f: ErrorFixture) => f.envelope.error.details as TooBroad;

  it("search_too_broad offers the same area with radiusMeters when the top locality is its center and over the pool", () => {
    const text = render(load("error-search-too-broad-bali"));
    assert.ok(
      text.includes(
        "Denpasar, the area's center, alone has 3,911 matching hotels: the same destination with radiusMeters (up to 80000) prices nearly the same hotels",
      ),
      text,
    );
    assert.doesNotMatch(text, /\bIf\b/);
  });

  it("search_too_broad offers no radiusMeters when the top locality is within the pool", () => {
    const small = copy(load("error-search-too-broad-bali")) as ErrorFixture;
    tooBroad(small).localities.items[0]!.count = 3000;
    tooBroad(small).localities.items[0]!.total = 3000;
    assert.doesNotMatch(render(small), /radiusMeters/);
  });

  it("search_too_broad offers no radiusMeters when the top locality is not the area's center", () => {
    const other = copy(load("error-search-too-broad-bali")) as ErrorFixture;
    tooBroad(other).center!.place!.placeId = "plc_9400002";
    assert.doesNotMatch(render(other), /radiusMeters/);
    tooBroad(other).center!.place = null;
    assert.doesNotMatch(render(other), /radiusMeters/);
  });

  it("search_too_broad offers no radiusMeters for a text-only search (center null)", () => {
    const fixture = load("error-search-too-broad-text-only");
    assert.equal(tooBroad(fixture as ErrorFixture).center, null);
    const text = render(fixture);
    assert.ok(text.includes("Chengdu plc_9600001 3,412"), text);
    assert.doesNotMatch(text, /radiusMeters/);
  });

  it("destination_ambiguous lists candidates and the place request", () => {
    const text = render(load("error-destination-ambiguous-suzhou"));
    for (const part of [
      "Suzhou (苏州) plc_9500001",
      "Suzhou (宿州) plc_9500002",
      "Jiangsu",
      "Anhui",
      "9,210 hotels",
      '{ kind: "place", placeId: "<id>" }',
    ]) {
      assert.ok(text.includes(part), `${part}\n---\n${text}`);
    }
  });

  it("not_a_locality names the hub and says to use place for the town", () => {
    const text = render(load("error-not-a-locality-patong"));
    for (const part of [
      "Phuket plc_9200002",
      "2,752",
      '{ kind: "locality", placeId: "plc_9200002" }',
      '{ kind: "place", placeId: "plc_9200010" }',
    ]) {
      assert.ok(text.includes(part), `${part}\n---\n${text}`);
    }
  });

  it("not_a_locality without a hub says so", () => {
    const fixture = copy(load("error-not-a-locality-patong")) as ErrorFixture;
    const details = fixture.envelope.error.details as Record<string, unknown>;
    details.hub = null;
    details.hubTotal = null;
    const text = render(fixture);
    assert.match(text, /belongs to no locality/);
    assertClean(text);
  });
});

describe("other errors", () => {
  const envelope = (error: Record<string, unknown>) => ({
    error: { message: "Something happened.", requestId: "req_1", ...error },
  });

  it("an unknown code falls back to the status and retryable", () => {
    const text = renderError(
      envelope({ code: "brand_new_problem", retryable: true, details: { x: 1 } }),
      418,
    );
    assert.match(text, /brand_new_problem/);
    assert.match(text, /HTTP 418/);
    assert.match(text, /retryable/i);
    assert.match(text, /Something happened\./);
    assertClean(text);
  });

  it("never throws, whatever it is given", () => {
    for (const value of [undefined, null, 42, "oops", [], {}, { error: null }, { error: { code: 7 } }]) {
      const text = renderError(value, 500);
      assert.match(text, /HTTP 500/);
      assertClean(text);
    }
    assert.doesNotThrow(() => renderError(undefined));
  });

  it("a known code with malformed details still renders its message", () => {
    const text = renderError(
      envelope({ code: "search_too_broad", retryable: false, details: { matched: "lots" } }),
      422,
    );
    assert.match(text, /search_too_broad/);
    assert.match(text, /Something happened\./);
    assertClean(text);
  });

  it("an unknown reason of a known code renders the raw reason", () => {
    const text = renderError(
      envelope({
        code: "destination_not_found",
        retryable: false,
        details: { reason: "moved_to_the_moon", placeId: "plc_1" },
      }),
      422,
    );
    assert.match(text, /moved_to_the_moon/);
    assert.match(text, /plc_1/);
  });

  it("retryable errors say when to retry", () => {
    const text = renderError(
      envelope({
        code: "order_in_progress",
        retryable: true,
        retryAfterSeconds: 5,
        details: { orderId: "ord_0123456789abcdefABCD" },
      }),
      409,
    );
    assert.match(text, /retry after 5 s/);
    assert.ok(text.includes("ord_0123456789abcdefABCD"));
  });

  it("invalid_request lists every issue", () => {
    const text = renderError(
      envelope({
        code: "invalid_request",
        retryable: false,
        param: "/filters/amenities/0",
        details: {
          issues: [{ pointer: "/filters/amenities/0", message: "spa can't be filtered by" }],
          filterable: ["parking", "wifi"],
          share: { code: "spa", listedShare: 0.123 },
        },
      }),
      400,
    );
    assert.match(text, /\/filters\/amenities\/0: spa can't be filtered by/);
    assert.match(text, /parking, wifi/);
    assert.match(text, /12\.3 %/);
  });

  it("offer_changed lists every change and the new offer", () => {
    const offers = load("offers-two-hotels-one-unavailable") as ToolFixture;
    const offer = (offers.data.hotels as { offers: Record<string, any>[] }[])[0]!.offers[1]!;
    const before = copy(offer.hotel.meals);
    const after = { ...copy(before), included: [], label: null, guestsCoveredPerRoom: null };
    const text = renderError(
      envelope({
        code: "offer_changed",
        retryable: false,
        details: {
          changes: [
            { field: "price", previous: { amount: "365.00", currency: "USD" }, current: { amount: "389.00", currency: "USD" }, worse: true },
            { field: "meals", previous: before, current: after, worse: true },
            { field: "parking", previous: 1, current: 2, worse: false },
          ],
          offer,
        },
      }),
      409,
    );
    assert.match(text, /price: USD 365\.00 → USD 389\.00 \(worse\)/);
    assert.match(text, /meals: breakfast for 2 guests per room → room only \(worse\)/);
    assert.match(text, /parking/);
    assert.ok(text.includes(offer.offerId as string));
    assertClean(text);
  });
});

describe("hotel detail", () => {
  it("keeps the full description and every policy (no truncation)", () => {
    const fixture = load("hotel-long-description") as ToolFixture;
    const data = fixture.data as Record<string, any>;
    const description = data.description.text as string;
    assert.equal(description.length, 18357);
    const text = render(fixture);
    assert.ok(text.includes(description));
    for (const policy of data.policies.items) assert.ok(text.includes(policy.text));
  });

  it("writes out what is not listed or unknown", () => {
    const fixture = copy(load("hotel-long-description")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    data.description = null;
    data.policies = { listed: false, items: [] };
    data.amenities = { listed: false, items: [] };
    data.rooms = { listed: false, items: [] };
    data.deposit = { required: null, amount: null };
    data.stars = null;
    data.bookable = false;
    const text = render(fixture);
    for (const part of [
      "Description: not listed",
      "Policies: not listed",
      "Amenities: not listed",
      "Rooms: not listed",
      "Deposit: not stated",
      "Breakfast served: not stated",
      "no longer bookable",
    ]) {
      assert.ok(text.includes(part), `${part}\n---\n${text}`);
    }
    assertClean(text);
  });
});

describe("offers", () => {
  it("writes out unknown meals, cancellation, fees and confirmation", () => {
    const text = render(load("offers-two-hotels-one-unavailable"));
    for (const part of [
      "cancellation terms unknown",
      "fees at the property not fully disclosed",
      "confirmation mode unknown",
      "room name not listed",
      "sold out",
    ]) {
      assert.ok(text.includes(part), `${part}\n---\n${text}`);
    }
  });
});

describe("unknowns carry their own negation inline", () => {
  const MEALS_UNKNOWN =
    "meals not stated by the supplier — not known to be room only, may include breakfast; ask or check at booking";
  const offerLines = (text: string) => text.split("\n").filter((l) => /^\d+\. off_/.test(l));

  it("meals.known false on an offer line and on an order item", () => {
    const offers = render(load("offers-two-hotels-one-unavailable"));
    const line = offerLines(offers).find((l) => l.includes("off_BundNonRefundable000"))!;
    assert.ok(line.includes(MEALS_UNKNOWN), line);
    assert.doesNotMatch(offers, /meals unknown/);
    const orders = render(load("list-orders"));
    const terms = orders.split("\n").find((l) => l.startsWith("Terms:") && l.includes("not stated by the supplier"));
    assert.ok(terms?.includes(MEALS_UNKNOWN), orders);
  });

  it("a fee's collection: 'at the property' only when stated, never assumed", () => {
    const text = render(load("offers-two-hotels-one-unavailable"));
    const line = offerLines(text).find((l) => l.includes("off_BundNonRefundable000"))!;
    assert.ok(line.includes("City tax CNY 15.00, basis unknown, mandatory, at the property"), line);
    assert.ok(
      line.includes(
        "unnamed fee amount not stated, basis unknown, optional, collection not stated (could be prepaid or at the property)",
      ),
      line,
    );
    assert.doesNotMatch(line, /pay at the property:/);
  });

  it("offers cut by limitPerHotel are said to exist", () => {
    const text = render(load("offers-two-hotels-one-unavailable"));
    assert.ok(
      text.includes(
        "2 more offers not shown (limitPerHotel); a filtered request (requireBreakfast / requireFreeCancellation) or a higher limitPerHotel may show them — don't conclude they don't exist",
      ),
      text,
    );
    const fixture = copy(load("offers-two-hotels-one-unavailable")) as ToolFixture;
    (fixture.data.hotels as { omitted: { byLimit: number } }[])[0]!.omitted.byLimit = 0;
    assert.doesNotMatch(render(fixture), /limitPerHotel/);
  });

  it("an offer's room size that is not stated says so", () => {
    const text = render(load("offers-two-hotels-one-unavailable"));
    const lines = offerLines(text);
    assert.match(lines.find((l) => l.includes("off_BundNonRefundable000"))!, /size not stated/);
    assert.match(lines.find((l) => l.includes("off_BundKingBreakfast000"))!, /35 m²/);
  });
});

describe("meals", () => {
  it("does not read unnamed main meals that are not stated as room only", () => {
    const fixture = copy(load("offers-two-hotels-one-unavailable")) as ToolFixture;
    const offer = (fixture.data.hotels as { offers: Record<string, any>[] }[])[0]!.offers[1]!;
    offer.hotel.meals = { ...offer.hotel.meals, included: [], unspecifiedMainMeals: null, label: null };
    let line = render(fixture).split("\n").find((l) => l.includes(offer.offerId))!;
    assert.doesNotMatch(line, /room only/);
    assert.match(line, /no meals named; other main meals not stated/);
    offer.hotel.meals.included = ["breakfast"];
    line = render(fixture).split("\n").find((l) => l.includes(offer.offerId))!;
    assert.match(line, /breakfast; other main meals not stated for 2 guests per room/);
  });
});

describe("orders and the consent rule", () => {
  it("ends with ORDER_NEXT_STEP when payment.url is set", () => {
    for (const name of ["order-awaiting-payment", "list-orders"] as const) {
      const text = render(load(name));
      assert.ok(text.endsWith(`\n\n${ORDER_NEXT_STEP}`), name);
      assert.equal(text.split(ORDER_NEXT_STEP).length, 2, name);
    }
  });

  it("leaves ORDER_NEXT_STEP out when no payment.url is set", () => {
    const text = render(load("order-confirmed"));
    assert.ok(!text.includes(ORDER_NEXT_STEP));
    assert.match(text, /LGR-449120/);
  });

  it("an awaiting_payment order without a link says to read it again", () => {
    const fixture = copy(load("order-awaiting-payment")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    data.payment.url = null;
    const text = renderToolResult("get_order", data);
    assert.match(text, /read this order again/);
    assert.ok(!text.includes(ORDER_NEXT_STEP));
  });

  it("renders an unknown status and an unknown item type", () => {
    const fixture = copy(load("order-confirmed")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    data.status = "teleported";
    data.items.push({ type: "car", car: { model: "x" } });
    const text = renderToolResult("get_order", data);
    assert.match(text, /teleported/);
    assert.match(text, /car/);
    assertClean(text);
  });
});

describe("renderToolResult on malformed data", () => {
  it("never throws, and shows the raw value", () => {
    for (const tool of ["search_hotels", "get_hotel", "get_hotel_offers", "book_hotel", "get_order", "list_orders"] as const) {
      for (const value of [undefined, null, 1, "x", { data: "nope" }]) {
        const text = renderToolResult(tool, value);
        assert.equal(typeof text, "string");
        assert.doesNotMatch(text, /\[object/);
      }
    }
  });

  it("keeps the consent rule when a result with a payment.url does not parse", () => {
    const order = copy(load("order-awaiting-payment")) as ToolFixture;
    (order.data as Record<string, any>).createdAt = "2026-11-01 09:05";
    for (const tool of ["book_hotel", "get_order"] as const) {
      const text = renderToolResult(tool, order.data);
      assert.match(text, /not in the expected shape/);
      assert.ok(text.includes("booking-status?session_id="));
      assert.ok(text.endsWith(`\n\n${ORDER_NEXT_STEP}`), tool);
    }
    const list = copy(load("list-orders")) as ToolFixture;
    (list.data.data as Record<string, any>[])[3]!.createdAt = "yesterday";
    assert.ok(renderToolResult("list_orders", list.data).endsWith(`\n\n${ORDER_NEXT_STEP}`));
  });

  it("adds no consent rule to a malformed result without a payment.url", () => {
    const order = copy(load("order-confirmed")) as ToolFixture;
    (order.data as Record<string, any>).createdAt = "yesterday";
    assert.ok(!renderToolResult("get_order", order.data).includes(ORDER_NEXT_STEP));
    const search = copy(load("search-shanghai-area")) as ToolFixture;
    (search.data as Record<string, any>).sort = 7;
    (search.data as Record<string, any>).payment = { url: "https://example.com" };
    assert.ok(!renderToolResult("search_hotels", search.data).includes(ORDER_NEXT_STEP));
  });

  it("keeps ids of a malformed result visible", () => {
    const fixture = copy(load("order-confirmed")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    data.createdAt = "yesterday";
    const text = renderToolResult("get_order", data);
    for (const id of stringsAt(data, "orderId")) assert.ok(text.includes(id));
  });
});
