import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import { strictOutput } from "../src/conventions/open.ts";
import { errorEnvelope } from "../src/outputs/error-details.ts";
import { renderError, renderToolResult } from "../src/render/index.ts";
import { CANCEL_REASONS } from "../src/outputs/order.ts";
import {
  CANCEL_NEXT_STEP,
  cancelNextStep,
  ORDER_NEXT_STEP,
  PAY_NEXT_STEP,
  payNextStep,
  WALLET_NEXT_STEP,
  walletNextStep,
  TOOLS,
  type ToolName,
} from "../src/tools.ts";

/*
 * Goldens: each fixture in fixtures/v1 is synthetic (no supplier names or
 * ids) and valid under the strict schema; its rendering must equal the
 * `.txt` next to it. UPDATE_GOLDENS=1 rewrites the `.txt` files.
 */

type ToolFixture = { tool: ToolName; data: Record<string, unknown> };
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
  "order-wallets-open",
  "list-orders",
  "cancel-order",
] as const;
type Golden = (typeof GOLDENS)[number];

function load(name: Golden): Fixture {
  return JSON.parse(readFileSync(new URL(`${name}.json`, DIR), "utf8")) as Fixture;
}

/** A deep copy to change in a test. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

/** The order awaiting payment, payable by token: its methods hold the token entry. */
function withToken(): Record<string, any> {
  const data = copy((load("order-awaiting-payment") as ToolFixture).data) as Record<string, any>;
  data.payment.methods = [
    {
      id: "stripe_shared_payment_token",
      handler: {
        id: "stripe_payments",
        type: "com.stripe.payments",
        version: "2026-06-25",
        spec: "https://docs.stripe.com/agentic-commerce/ucp/stripe-payments-handler",
        schema: "https://ucp.stripe.com/payments/2026-06-25/schema.json",
        available_instruments: [{ type: "card" }],
        config: { environment: "testmode", business_profile: "profile_test_1" },
      },
      limits: { maxAmount: 36600, currency: "usd", expiresAt: data.payment.expiresAt },
    },
  ];
  return data;
}

/** The order awaiting payment with the Alipay or WeChat Pay entry, offered or open. */
function withWallet(open: boolean): Record<string, any> {
  const data = copy((load("order-awaiting-payment") as ToolFixture).data) as Record<string, any>;
  data.payment.methods = [
    open
      ? (copy(load("order-wallets-open") as ToolFixture).data as Record<string, any>).payment.methods[0]
      : { id: "stripe_alipay_wechat_pay", open: false, current: null, wechatPay: null, alipay: null },
  ];
  return data;
}

/** The order awaiting payment, made through the API, that the user can close. */
function unpaidOrder(): Record<string, any> {
  const data = copy((load("order-awaiting-payment") as ToolFixture).data) as Record<string, any>;
  data.cancel = { available: true, reason: "unpaid", penalty: null, refund: null };
  return data;
}

function render(fixture: Fixture): string {
  return "tool" in fixture
    ? renderToolResult(fixture.tool, fixture.data)
    : renderError(fixture.envelope, fixture.status);
}

function outputOf(tool: ToolName) {
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
          strictOutput(errorEnvelope).parse(fixture.envelope);
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

describe("one currency", () => {
  /** Money of a fixture, every amount in CNY. */
  function inCny(value: unknown): void {
    if (Array.isArray(value)) value.forEach(inCny);
    else if (value && typeof value === "object") {
      const money = value as Record<string, unknown>;
      if (typeof money.amount === "string" && money.currency === "USD") money.currency = "CNY";
      Object.values(money).forEach(inCny);
    }
  }

  it("a CNY search and offers fixture renders CNY amounts and no approximate line", () => {
    for (const name of ["search-shanghai-area", "offers-two-hotels-one-unavailable"] as const) {
      const fixture = copy(load(name)) as ToolFixture;
      inCny(fixture.data);
      if ("notes" in fixture.data) fixture.data.notes = []; // service prose about the price, not a rendered amount
      strictOutput(outputOf(fixture.tool)).parse(fixture.data);
      const text = render(fixture);
      assert.match(text, /CNY|¥/, name);
      assert.doesNotMatch(text, /USD|\$|≈|exchange rate|approx/i, name);
    }
  });
});

describe("search results", () => {
  it("ends with the currency hint only when the search carries one", () => {
    const fixture = copy(load("search-locality-phuket")) as ToolFixture;
    assert.doesNotMatch(render(fixture), /^Currency:/m);
    const data = fixture.data as Record<string, unknown>;
    data.currencyHint = { currency: "CNY", reason: "request_location" };
    const mcp = renderToolResult("search_hotels", data);
    assert.ok(
      mcp.endsWith(
        "\n\nCurrency: this request comes from mainland China. Prices are also available in CNY, paid through payment channels in mainland China; if the user may pay that way, offer them CNY prices: search again with currency CNY.",
      ),
      mcp,
    );
    data.currencyHint = { currency: "CNY", reason: "sign_in_location" };
    const cli = renderToolResult("search_hotels", data, "cli");
    assert.match(cli, /\n\nCurrency: the user's latest sign-in to Fortrip was from mainland China\. [^\n]*: run the search again with --currency CNY\.$/);
    // An unknown reason still offers CNY, without a reason; another currency, nothing.
    data.currencyHint = { currency: "CNY", reason: "something_new" };
    assert.match(renderToolResult("search_hotels", data), /\n\nCurrency: Prices are also available in CNY/);
    data.currencyHint = { currency: "EUR", reason: "request_location" };
    assert.doesNotMatch(renderToolResult("search_hotels", data), /^Currency:/m);
  });

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

  it("shows a hotel's cover URL on its line, and nothing without one", () => {
    const fixture = copy(load("search-shanghai-area")) as ToolFixture;
    const hotels = (fixture.data as Record<string, any>).data as Record<string, any>[];
    hotels[0]!.photo = { url: "https://fortrip.ai/hotel-photos/hotels/imgs/1/a.webp", caption: null };
    hotels[1]!.photo = null;
    const lines = render(fixture).split("\n");
    const first = lines.find((l) => l.startsWith("1. "))!;
    const second = lines.find((l) => l.startsWith("2. "))!;
    assert.ok(first.includes("photo https://fortrip.ai/hotel-photos/hotels/imgs/1/a.webp"), first);
    assert.ok(!second.includes("photo "), second);
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

  it("currency_unavailable says to tell the user and offer USD", () => {
    const text = renderError(
      envelope({ code: "currency_unavailable", retryable: false, details: { currency: "CNY" } }),
      422,
    );
    assert.match(
      text,
      /^Prices in CNY aren't available yet\. Tell the user, and ask whether to see USD prices\.$/m,
    );
    assertClean(text);
  });

  it("order_not_cancellable words its reason as the order's Cancel line does", () => {
    const envelope = {
      error: {
        code: "order_not_cancellable",
        message: "This order can't be cancelled now.",
        retryable: false,
        details: { reason: "refused" },
        requestId: "req_1",
      },
    };
    const text = renderError(envelope, 409);
    assert.match(text, /^Not cancellable: the hotel refused the cancellation; the booking stands\.$/m);
    envelope.error.details.reason = "later";
    assert.match(renderError(envelope, 409), /^Not cancellable: later\.$/m);
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
    assert.ok(text.includes("Show the user these changes and ask again before ordering the new offer."));
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

  it("shows the first 4 photo URLs and counts the rest", () => {
    const fixture = copy(load("hotel-long-description")) as ToolFixture;
    const url = (i: number) => `https://fortrip.ai/hotel-photos/hotels/imgs/1/${i}.webp`;
    (fixture.data as Record<string, any>).photos = [1, 2, 3, 4, 5, 6].map((i) => ({ url: url(i), caption: null }));
    const text = render(fixture);
    assert.ok(text.includes(`Photos: ${[1, 2, 3, 4].map(url).join(" · ")} (+2 more)`), text);
    (fixture.data as Record<string, any>).photos = null;
    assert.ok(!render(fixture).includes("Photos:"));
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
      "fees not fully disclosed (amounts or how they are collected may be missing)",
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
    // Incomplete disclosure names no collection place either.
    assert.ok(line.endsWith("; fees not fully disclosed (amounts or how they are collected may be missing) · offer expires 2026-11-01 09:30 UTC"), line);
    assert.doesNotMatch(render(load("list-orders")), /fees at the property/);
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
    const text = render(load("order-awaiting-payment"));
    assert.ok(text.endsWith(`\n\n${ORDER_NEXT_STEP}`));
    assert.equal(text.split(ORDER_NEXT_STEP).length, 2);
  });

  it("puts CANCEL_NEXT_STEP after ORDER_NEXT_STEP when both apply, each once", () => {
    const text = render(load("list-orders"));
    assert.ok(text.endsWith(`\n\n${ORDER_NEXT_STEP}\n\n${CANCEL_NEXT_STEP}`));
    assert.equal(text.split(ORDER_NEXT_STEP).length, 2);
    assert.equal(text.split(CANCEL_NEXT_STEP).length, 2);
  });

  it("ends with CANCEL_NEXT_STEP when the order can be cancelled now, with the penalty and refund", () => {
    const text = render(load("order-confirmed"));
    assert.ok(text.endsWith(`\n\n${CANCEL_NEXT_STEP}`));
    assert.equal(text.split(CANCEL_NEXT_STEP).length, 2);
    assert.match(text, /^Cancel: can cancel now: penalty USD 120\.00, refund USD 246\.00$/m);
  });

  it("leaves CANCEL_NEXT_STEP out when no order can be cancelled now", () => {
    const fixture = copy(load("order-confirmed")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    data.cancel = { available: false, reason: "stay_started", penalty: null, refund: null };
    for (const tool of ["get_order", "cancel_order"] as const) {
      const text = renderToolResult(tool, data);
      assert.ok(!text.includes(CANCEL_NEXT_STEP), tool);
      assert.match(text, /^Cancel: not available: the stay has started/m, tool);
    }
    const list = copy(load("list-orders")) as ToolFixture;
    for (const o of list.data.data as Record<string, any>[]) o.cancel.available = false;
    assert.ok(!renderToolResult("list_orders", list.data).includes(CANCEL_NEXT_STEP));
  });

  it("cancel_order renders the order with no consent paragraph", () => {
    const fixture = load("cancel-order") as ToolFixture;
    const text = render(fixture);
    assert.match(text.split("\n")[0]!, / · cancelling · /);
    assert.match(text, /^Cancel: not available: the booking is still being confirmed, or a cancellation is under way; read the order again later$/m);
    assert.ok(!text.includes(CANCEL_NEXT_STEP));
    assert.ok(!text.includes(ORDER_NEXT_STEP));
    // Even an answer that could still be cancelled carries no rule: it is
    // the cancellation's own answer.
    const data = copy(load("order-confirmed")) as ToolFixture;
    assert.ok(!renderToolResult("cancel_order", data.data).includes(CANCEL_NEXT_STEP));
  });

  it("an unpaid order that can be closed says so, on its word only, and carries no cancel rule", () => {
    const data = unpaidOrder();
    strictOutput(outputOf("get_order")).parse(data);
    for (const surface of ["mcp", "cli"] as const) {
      const close = surface === "mcp" ? "call cancel_order" : "run `fortrip orders cancel <orderId> --close`";
      const line = `Cancel: can be closed now, nothing is charged; close it only if the user says they no longer want it (${close})`;
      for (const tool of ["get_order", "list_orders"] as const) {
        const text = renderToolResult(tool, tool === "list_orders" ? { data: [data], nextCursor: null } : data, surface);
        assert.ok(text.split("\n").includes(line), `${surface} ${tool}`);
        assert.ok(!text.includes(cancelNextStep(surface)), `${surface} ${tool}`);
      }
      // With a confirmed order that can be cancelled: the rule, once.
      const confirmed = (load("order-confirmed") as ToolFixture).data;
      const both = renderToolResult("list_orders", { data: [data, confirmed], nextCursor: null }, surface);
      assert.equal(both.split(cancelNextStep(surface)).length, 2, surface);
    }
  });

  it("the raw fallback carries no cancel rule for an unpaid order that can be closed", () => {
    const cancel = { available: true, reason: "unpaid", penalty: null, refund: null };
    const text = renderToolResult("get_order", { cancel, junk: 1 });
    assert.match(text, /^This get_order result is not in the expected shape/);
    assert.ok(!text.includes(CANCEL_NEXT_STEP));
    const list = { data: [{ cancel }, { cancel: { ...cancel, reason: "cancellable" } }], junk: 1 };
    assert.equal(renderToolResult("list_orders", list).split(CANCEL_NEXT_STEP).length, 2);
  });

  it("an expired order was not paid: the time ran out or it was closed", () => {
    const data = unpaidOrder();
    data.status = "expired";
    data.payment.url = null;
    data.payment.expiresAt = null;
    data.cancel = { available: false, reason: "not_confirmed", penalty: null, refund: null };
    assert.match(
      renderToolResult("get_order", data).split("\n")[0]!,
      / · not paid: the time ran out or it was closed · /,
    );
  });

  it("an unpaid order that can't be closed: a website order expires unpaid, else a payment is under way", () => {
    const data = unpaidOrder();
    data.cancel = { available: false, reason: "not_confirmed", penalty: null, refund: null };
    data.payment.requiresSignIn = true;
    assert.match(
      renderToolResult("get_order", data),
      /^Cancel: not needed: an unpaid order expires unpaid at 2026-11-01 12:50 UTC$/m,
    );
    data.payment.requiresSignIn = false;
    for (const surface of ["mcp", "cli"] as const) {
      const text = renderToolResult("get_order", data, surface);
      assert.match(text, /^Cancel: not now: a payment is under way; read the order again shortly$/m, surface);
      assert.doesNotMatch(text, /expires unpaid/, surface);
    }
  });

  it("words every reason, and shows an unknown one as it came", () => {
    const fixture = copy(load("order-confirmed")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    const lines = new Set<string>();
    for (const reason of CANCEL_REASONS.filter((r) => r !== "cancellable")) {
      data.cancel = { available: false, reason, penalty: null, refund: null };
      const line = renderToolResult("get_order", data).split("\n").find((l) => l.startsWith("Cancel: "));
      assert.ok(line, reason);
      assert.notEqual(line, `Cancel: not available: ${reason}`, `${reason} is worded`);
      lines.add(line);
    }
    assert.equal(lines.size, CANCEL_REASONS.length - 1);
    data.cancel.reason = "non_refundable";
    assert.match(renderToolResult("get_order", data), /^Cancel: not available: this rate can't be cancelled$/m);
    data.cancel.reason = "refused";
    assert.match(
      renderToolResult("get_order", data),
      /^Cancel: not available: the hotel refused the cancellation; the booking stands$/m,
    );
    data.cancel.reason = "teleported";
    const text = renderToolResult("get_order", data);
    assert.match(text, /^Cancel: not available: teleported$/m);
    assertClean(text);
  });

  it("an order offering Alipay or WeChat Pay shows how to open it, and the wallet rule", () => {
    const data = withWallet(false);
    strictOutput(TOOLS.find((t) => t.name === "get_order")!.output!).parse(data);
    for (const tool of ["book_hotel", "get_order", "list_orders", "pay_order"] as const) {
      const text = renderToolResult(tool, tool === "list_orders" ? { data: [data], nextCursor: null } : data);
      assert.match(
        text,
        /^Pay with Alipay or WeChat Pay: call pay_order with method stripe_alipay_wechat_pay and the order's price\.total\.$/m,
        tool,
      );
      assert.equal(text.split(WALLET_NEXT_STEP).length, tool === "pay_order" ? 1 : 2, tool);
      if (tool !== "pay_order") assert.ok(text.endsWith(`\n\n${ORDER_NEXT_STEP}\n\n${WALLET_NEXT_STEP}`), tool);
      assertClean(text);
    }
    // Both entries: the token's line and the wallet's, then the pay paragraph and the wallet's.
    const both = withToken();
    both.payment.methods.push(...data.payment.methods);
    strictOutput(TOOLS.find((t) => t.name === "get_order")!.output!).parse(both);
    const text = renderToolResult("get_order", both);
    assert.match(text, /^Pay without the link: .*\nPay with Alipay or WeChat Pay: /m);
    assert.ok(text.endsWith(`\n\n${ORDER_NEXT_STEP}\n\n${PAY_NEXT_STEP}\n\n${WALLET_NEXT_STEP}`));
    // In either order of the list.
    both.payment.methods.reverse();
    assert.equal(renderToolResult("get_order", both), text);
    // No methods, or the wallet already open: no rule.
    for (const methods of [[], withWallet(true).payment.methods]) {
      const plain = copy(data);
      plain.payment.methods = methods;
      assert.ok(!renderToolResult("get_order", plain).includes(WALLET_NEXT_STEP));
    }
    // The consent rule is repeated here on purpose: as the result's last
    // paragraph it keeps the model from giving the link early (paired eval, S6).
    assert.match(
      WALLET_NEXT_STEP,
      /^Before you call pay_order with method stripe_alipay_wechat_pay and the order's price\.total, show the user the order's total and currency, the stay \(hotel, room, dates, rooms and guests per room\) and every term \(meals, cancellation, fees payable at the property\), then ask them to confirm, and wait for a clear yes\. /,
    );
    assert.match(WALLET_NEXT_STEP, /Then show the stripe_alipay_wechat_pay entry of payment\.methods: /);
    assert.match(WALLET_NEXT_STEP, /Then poll get_order\.$/);
  });

  it("an open wallet payment shows the code and both links, and no wallet rule", () => {
    const data = withWallet(true);
    strictOutput(TOOLS.find((t) => t.name === "get_order")!.output!).parse(data);
    const { wechatPay, alipay } = data.payment.methods[0];
    for (const tool of ["book_hotel", "get_order", "list_orders", "pay_order"] as const) {
      const text = renderToolResult(tool, tool === "list_orders" ? { data: [data], nextCursor: null } : data);
      assert.ok(
        text.includes(`\nWeChat Pay: ![WeChat Pay QR code](${wechatPay.qrImageUrl}), or a full-size code at ${wechatPay.url}\n`),
        tool,
      );
      assert.ok(text.includes(`\nAlipay: ${alipay.url}\n`), tool);
      assert.ok(
        text.includes(
          "\nShow the user the WeChat Pay code as an image if you can, and both links. They pay once, by either; the code lasts 120 minutes. Then call get_order until the order isn't awaiting_payment.\n",
        ),
        tool,
      );
      assert.ok(!text.includes("Pay with Alipay or WeChat Pay:"), tool);
      assert.ok(!text.includes(WALLET_NEXT_STEP), tool);
      assertClean(text);
    }
    // No live code: only the link.
    data.payment.methods[0].wechatPay.qrData = null;
    data.payment.methods[0].wechatPay.qrImageUrl = null;
    const text = renderToolResult("get_order", data);
    assert.ok(text.includes(`\nWeChat Pay: a new code at ${wechatPay.url}\n`));
    assert.ok(!text.includes("![WeChat Pay QR code]"));
  });

  it("the raw fallback adds the pay and wallet rules for an order whose methods offer them", () => {
    const wallet = (open: boolean) => ({ id: "stripe_alipay_wechat_pay", open });
    const text = renderToolResult("get_order", { payment: { methods: [wallet(false)] }, junk: 1 });
    assert.match(text, /^This get_order result is not in the expected shape/);
    assert.ok(text.endsWith(`\n\n${WALLET_NEXT_STEP}`));
    assert.ok(!text.includes(PAY_NEXT_STEP));
    assert.ok(!renderToolResult("get_order", { payment: { methods: [wallet(true)] } }).includes(WALLET_NEXT_STEP));
    const both = renderToolResult("get_order", {
      payment: { methods: [{ id: "stripe_shared_payment_token" }, wallet(false)] },
    });
    assert.ok(both.endsWith(`\n\n${PAY_NEXT_STEP}\n\n${WALLET_NEXT_STEP}`));
    // A method this contract doesn't know, or none: neither rule.
    for (const methods of [[], [{ id: "other_method", open: false }]]) {
      const plain = renderToolResult("get_order", { payment: { methods }, junk: 1 });
      assert.ok(!plain.includes(PAY_NEXT_STEP) && !plain.includes(WALLET_NEXT_STEP), JSON.stringify(methods));
    }
  });

  it("an order with the token method shows how to pay without the link, and the pay rule", () => {
    const data = withToken();
    data.payment.methods[0].handler.available_instruments.push({
      type: "link",
      config: { business_profile: "profile_test_1" },
    });
    strictOutput(TOOLS.find((t) => t.name === "get_order")!.output!).parse(data);
    for (const tool of ["book_hotel", "get_order", "pay_order"] as const) {
      const text = renderToolResult(tool, data);
      assert.match(
        text,
        /^Pay without the link: pay_order with a shared payment token via com\.stripe\.payments \(handler stripe_payments, business_profile profile_test_1\); token limits: maxAmount 36600 \(cents\), currency usd, expiresAt /m,
        tool,
      );
      assert.equal(text.split(PAY_NEXT_STEP).length, tool === "pay_order" ? 1 : 2, tool);
      assertClean(text);
    }
    assert.match(PAY_NEXT_STEP, /^To pay without the link: only if you have a tool that can request a Stripe shared payment token /);
    assert.match(PAY_NEXT_STEP, /never ask the user to create, type or paste a token\. Before you call pay_order, show the user the order's total and currency, the stay \(hotel, room, dates, rooms and guests per room\) and every term \(meals, cancellation, fees payable at the property\), then end your reply by asking them to confirm, and wait for a clear yes\./);
    assert.match(PAY_NEXT_STEP, /Pay one way only: either give payment\.url or call pay_order\./);
    assert.match(
      PAY_NEXT_STEP,
      /with that entry's handler config\.business_profile and its limits \(maxAmount in cents, currency, expiresAt\)/,
    );
    // An order with no methods: the link alone, and only its rule.
    const unpayable = load("order-awaiting-payment") as ToolFixture;
    assert.deepEqual((unpayable.data as Record<string, any>).payment.methods, []);
    for (const tool of ["book_hotel", "get_order", "list_orders"] as const) {
      const data = tool === "list_orders" ? { data: [unpayable.data], nextCursor: null } : unpayable.data;
      const plain = renderToolResult(tool, data);
      assert.doesNotMatch(plain, /^Pay without the link/m, tool);
      assert.doesNotMatch(plain, /^Pay with Alipay or WeChat Pay/m, tool);
      assert.ok(!plain.includes(PAY_NEXT_STEP), tool);
      assert.ok(!plain.includes(WALLET_NEXT_STEP), tool);
      assert.ok(plain.endsWith(`\n\n${ORDER_NEXT_STEP}`), tool);
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

  it("an awaiting_payment order with a payment held has no link and says none is unreadable", () => {
    const data = copy((load("order-awaiting-payment") as ToolFixture).data) as Record<string, any>;
    data.payment.url = null;
    data.payment.status = "authorized";
    const text = renderToolResult("get_order", data);
    assert.doesNotMatch(text, /^Payment link/m);
    // Held is not "being processed": the line for an unpaid order with no link stays out.
    assert.doesNotMatch(text, /being processed/);
    assert.match(text, /payment authorized \(held, not yet charged\)/);
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
    for (const tool of ["search_hotels", "get_hotel", "get_hotel_offers", "book_hotel", "get_order", "list_orders", "cancel_order"] as const) {
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
    assert.ok(
      renderToolResult("list_orders", list.data).endsWith(`\n\n${ORDER_NEXT_STEP}\n\n${CANCEL_NEXT_STEP}`),
    );
  });

  it("keeps the cancel rule when a cancellable order does not parse, for get_order and list_orders only", () => {
    const order = copy(load("order-confirmed")) as ToolFixture;
    (order.data as Record<string, any>).createdAt = "yesterday";
    const text = renderToolResult("get_order", order.data);
    assert.match(text, /not in the expected shape/);
    assert.ok(text.endsWith(`\n\n${CANCEL_NEXT_STEP}`));
    for (const tool of ["book_hotel", "cancel_order"] as const) {
      assert.ok(!renderToolResult(tool, order.data).includes(CANCEL_NEXT_STEP), tool);
    }
    (order.data as Record<string, any>).cancel.available = false;
    assert.ok(!renderToolResult("get_order", order.data).includes(CANCEL_NEXT_STEP));
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

describe("the CLI surface", () => {
  /** What only an MCP client can call: tool names and JSON arguments. */
  const MCP_ONLY =
    /\b(search_hotels|get_hotel|get_hotel_offers|book_hotel|get_order|list_orders|cancel_order|pay_order|maximumPenalty|radiusMeters|limitPerHotel|requireBreakfast|place_name)\b|\{ (cursor|kind):/;

  function cli(fixture: Fixture): string {
    return "tool" in fixture
      ? renderToolResult(fixture.tool, fixture.data, "cli")
      : renderError(fixture.envelope, fixture.status, "cli");
  }


  it("MCP is the default surface", () => {
    for (const name of GOLDENS) {
      const fixture = load(name);
      const explicit =
        "tool" in fixture
          ? renderToolResult(fixture.tool, fixture.data, "mcp")
          : renderError(fixture.envelope, fixture.status, "mcp");
      assert.equal(explicit, render(fixture), name);
    }
  });

  it("names commands and flags, never a tool or JSON arguments, in every fixture", () => {
    for (const name of GOLDENS) {
      const fixture = load(name);
      // A search note's message is the server's own text.
      const notes = "tool" in fixture ? stringsAt(fixture.data.notes ?? [], "message") : [];
      const text = notes.reduce((t, message) => t.replace(message, ""), cli(fixture));
      assert.doesNotMatch(text, MCP_ONLY, name);
      assertClean(text);
    }
    for (const tool of ["book_hotel", "get_order", "list_orders"] as const) {
      const data = tool === "list_orders" ? { data: [withToken()], nextCursor: "c_2" } : withToken();
      assert.doesNotMatch(renderToolResult(tool, data, "cli"), MCP_ONLY, tool);
    }
    assert.doesNotMatch(renderToolResult("get_order", { unexpected: true }, "cli"), MCP_ONLY);
    assert.match(renderToolResult("get_order", { unexpected: true }, "cli"), /^This fortrip orders get result/);
  });

  it("the pay line and the pay rule run fortrip orders pay", () => {
    const text = renderToolResult("get_order", withToken(), "cli");
    assert.match(
      text,
      /^Pay without the link: `fortrip orders pay ord_BundAwaiting00000000 --token <spt_…> --total 365\.00` with a shared payment token via com\.stripe\.payments/m,
    );
    assert.ok(text.endsWith(`\n\n${ORDER_NEXT_STEP}\n\n${payNextStep("cli")}`));
    assert.match(payNextStep("cli"), /run `fortrip orders pay <orderId> --token <spt_…> --total <total>`/);
    assert.notEqual(payNextStep("cli"), PAY_NEXT_STEP);
    assert.equal(payNextStep("mcp"), PAY_NEXT_STEP);
  });

  it("the wallet lines and rule run fortrip orders pay --method stripe_alipay_wechat_pay", () => {
    const offer = renderToolResult("get_order", withWallet(false), "cli");
    assert.match(
      offer,
      /^Pay with Alipay or WeChat Pay: run `fortrip orders pay <orderId> --method stripe_alipay_wechat_pay --total <total>`\.$/m,
    );
    assert.ok(offer.endsWith(`\n\n${ORDER_NEXT_STEP}\n\n${walletNextStep("cli")}`));
    assert.match(
      walletNextStep("cli"),
      /^Before you run `fortrip orders pay` with --method stripe_alipay_wechat_pay --total <total>, show the user/,
    );
    assert.match(walletNextStep("cli"), /Then poll it with `fortrip orders get <orderId>`\.$/);
    assert.notEqual(walletNextStep("cli"), WALLET_NEXT_STEP);
    assert.equal(walletNextStep("mcp"), WALLET_NEXT_STEP);
    const open = renderToolResult("get_order", withWallet(true), "cli");
    assert.match(open, /^WeChat Pay: open https:\/\/fortrip\.ai\/pay\/ord_BundAwaiting00000000\/wechat$/m);
    assert.doesNotMatch(open, /!\[/);
    assert.match(open, /^Alipay: https:/m);
    assert.match(open, /Then run `fortrip orders get <orderId>` until the order isn't awaiting_payment\.$/m);
    assert.doesNotMatch(offer, MCP_ONLY);
    assert.doesNotMatch(open, MCP_ONLY);
  });

  it("the cancel rule runs fortrip orders cancel with --max-penalty", () => {
    const text = cli(load("order-confirmed"));
    assert.ok(text.endsWith(`\n\n${cancelNextStep("cli")}`));
    assert.match(cancelNextStep("cli"), /^Before you run `fortrip orders cancel <orderId> --max-penalty <amount>`, show the user/);
    assert.equal(cancelNextStep("mcp"), CANCEL_NEXT_STEP);
  });

  it("a next page is --cursor", () => {
    assert.match(cli(load("list-orders")), /^Next page: run again with --cursor c_orders_page_2\.$/m);
    const search = copy(load("search-shanghai-area")) as ToolFixture;
    search.data.nextCursor = "c_search_2";
    assert.match(
      renderToolResult("search_hotels", search.data, "cli"),
      /^Next page: run again with only --cursor c_search_2 and, optionally, --limit\.$/m,
    );
  });

  it("destinations are --locality, --place, --place-name and --radius-meters", () => {
    const broad = cli(load("error-search-too-broad-bali"));
    assert.ok(broad.includes("then search again with --locality <id> and the same text"), broad);
    assert.ok(broad.includes("Localities: pass one back as --locality <placeId>, never the name."), broad);
    assert.ok(broad.includes("name one with --place-name and --country."), broad);
    assert.ok(broad.includes("the same destination with --radius-meters (up to"), broad);
    assert.match(cli(load("error-destination-ambiguous-suzhou")), /then search with --place <id>:/);
    const patong = cli(load("error-not-a-locality-patong"));
    assert.match(patong, /Search --locality plc_\d+ for those, or --place plc_\d+ for an 8 km circle/);
  });

  it("errors that lead to an order read run fortrip orders get", () => {
    const order = "ord_BundAwaiting00000000";
    const error = (code: string, details: unknown) =>
      renderError({ error: { code, message: "m", retryable: false, requestId: "req_1", details } }, undefined, "cli");
    assert.match(error("order_not_payable", { orderId: order, status: "confirmed" }), new RegExp(`read it with \`fortrip orders get ${order}\`; this call charged nothing`));
    assert.match(error("payment_in_progress", { orderId: order }), new RegExp(`read it with \`fortrip orders get ${order}\` in a few seconds`));
    assert.match(error("payment_declined", { declineCode: null }), /read the order with `fortrip orders get <orderId>` and give its payment\.url/);
    assert.match(
      error("payment_total_changed", { orderId: order, total: { amount: "365.00", currency: "USD" } }),
      new RegExp(`confirm this total with the user, then run the same \`fortrip orders pay ${order}\` command again with \`--total 365\\.00\`\\. Nothing was charged\\.`),
    );
  });

  it("offers cut by the limit name the CLI's flags", () => {
    const fixture = copy(load("offers-two-hotels-one-unavailable")) as ToolFixture;
    const hotels = fixture.data.hotels as Record<string, any>[];
    hotels[0]!.omitted.byLimit = 3;
    const text = renderToolResult("get_hotel_offers", fixture.data, "cli");
    assert.match(text, /not shown \(--limit-per-hotel\); a filtered request \(--require-breakfast \/ --require-free-cancellation\)/);
  });
});
