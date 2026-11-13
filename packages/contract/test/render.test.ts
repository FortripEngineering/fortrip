import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import { strictOutput } from "../src/conventions/open.ts";
import { errorEnvelope } from "../src/outputs/error-details.ts";
import { renderError, renderToolResult } from "../src/render/index.ts";
import { renderOrder } from "../src/render/order.ts";
import { CANCEL_BLOCKERS, FAILURE_REASONS, type Order, ORDER_STATUSES, PAYMENT_METHOD_UNAVAILABLE_REASONS } from "../src/outputs/order.ts";
import { SEARCH_NOTE_CODES } from "../src/outputs/search.ts";
import {
  CANCEL_NEXT_STEP,
  cancelNextStep,
  ORDER_NEXT_STEP,
  PAY_NEXT_STEP,
  payNextStep,
  PRESENTATION_HINT,
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
  "hotel-json-policy",
  "offers-two-hotels-one-unavailable",
  "order-awaiting-payment",
  "order-payable-by-token",
  "order-confirmed",
  "order-failed",
  "order-cancelled",
  "order-rooms-differ",
  "order-website-checkout",
  "order-payment-processing",
  "order-free-to-cancel",
  "order-expired",
  "order-closed",
  "order-stay-started",
  "order-needs-attention",
  "order-terms-unknown",
  "order-confirming",
  "list-orders",
  "cancel-order",
  "error-payment-total-mismatch",
  "error-offer-unavailable",
] as const;
type Golden = (typeof GOLDENS)[number];

function load(name: Golden): Fixture {
  return JSON.parse(readFileSync(new URL(`${name}.json`, DIR), "utf8")) as Fixture;
}

/** A deep copy to change in a test. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

/** The order awaiting payment, payable by token: its payment holds the token. */
function withToken(): Record<string, any> {
  const data = copy((load("order-awaiting-payment") as ToolFixture).data) as Record<string, any>;
  data.payment.tokenRequest = {
    handler: {
      id: "stripe_payments",
      type: "com.stripe.payments",
      version: "2026-06-25",
      spec: "https://docs.stripe.com/agentic-commerce/ucp/stripe-payments-handler",
      schema: "https://ucp.stripe.com/payments/2026-06-25/schema.json",
      available_instruments: [{ type: "card" }],
      config: { environment: "testmode", business_profile: "profile_test_1" },
    },
    // 2026-11-01T12:50:00Z, the order's payment.expiresAt.
    usageLimits: { max_amount: 36500, currency: "usd", expires_at: 1793537400 },
  };
  return data;
}

/** The order awaiting payment, made through the API, that the user can close. */
function unpaidOrder(): Record<string, any> {
  return copy((load("order-awaiting-payment") as ToolFixture).data) as Record<string, any>;
}

/** An order's cancel that `blockedBy` blocks. */
function blocked(blockedBy: string) {
  return { action: null, blockedBy, penalty: null, refund: null };
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
    // No hint (null) says nothing: no line at all.
    assert.equal(fixture.data.currencyHint, null);
    assert.doesNotMatch(render(fixture), /^Currency:/m);
    const data = fixture.data as Record<string, unknown>;
    data.currencyHint = { currency: "CNY", reason: "request_location" };
    // The last of the data; on MCP, how to present hotels comes after it.
    const mcp = renderToolResult("search_hotels", data);
    assert.ok(
      mcp.endsWith(
        `\n\nCurrency: this request comes from mainland China. Prices are also available in CNY, paid through payment channels in mainland China; if the user may pay that way, offer them CNY prices: search and get offers with currency CNY.\n\n${PRESENTATION_HINT}`,
      ),
      mcp,
    );
    data.currencyHint = { currency: "CNY", reason: "sign_in_location" };
    const cli = renderToolResult("search_hotels", data, "cli");
    assert.match(cli, /\n\nCurrency: the user's latest sign-in to Fortrip was from mainland China\. [^\n]*: search and get offers with --currency CNY\.$/);
    // An unknown reason still offers CNY, without a reason; another currency, nothing.
    data.currencyHint = { currency: "CNY", reason: "something_new" };
    assert.match(renderToolResult("search_hotels", data), /\n\nCurrency: Prices are also available in CNY/);
    data.currencyHint = { currency: "EUR", reason: "request_location" };
    assert.doesNotMatch(renderToolResult("search_hotels", data), /^Currency:/m);
  });

  // A note's message is written for HTTP readers and names JSON
  // paths, so a note is worded from its code and the search it is on.
  it("words every note from its code, never with the server's message", () => {
    for (const name of GOLDENS.filter((n) => n.startsWith("search-"))) {
      const fixture = load(name) as ToolFixture;
      const text = render(fixture);
      const notes = fixture.data.notes as { code: string; message: string }[];
      assert.ok(notes.length > 0, name);
      for (const note of notes) {
        assert.ok(!text.includes(note.message), `${name}: ${note.code}`);
        assert.match(text, new RegExp(`^- Note ${note.code}: \\S`, "m"), `${name}: ${note.code}`);
      }
    }
  });

  it("has words of its own for every note code there is, on both surfaces, whatever the search holds", () => {
    const MESSAGE = "The server's own words, naming coverage.localities.";
    const worded = new Set<string>();
    for (const name of ["search-shanghai-area", "search-empty", "search-pool-limited"] as const) {
      for (const surface of ["mcp", "cli"] as const) {
        const fixture = copy(load(name)) as ToolFixture;
        fixture.data.notes = SEARCH_NOTE_CODES.map((code) => ({ code, message: MESSAGE }));
        const text = renderToolResult("search_hotels", fixture.data, surface);
        assert.ok(!text.includes(MESSAGE), `${name} ${surface}`);
        const notes = text.split("\n").filter((line) => line.startsWith("- Note "));
        assert.equal(notes.length, SEARCH_NOTE_CODES.length);
        notes.forEach((line, i) => {
          assert.match(line, new RegExp(`^- Note ${SEARCH_NOTE_CODES[i]}: \\S.+\\.$`), line);
          worded.add(line.replace(/^- Note [a-z_]+: /, ""));
        });
        assertClean(text);
        // A destination the build can't read still leaves every note worded.
        fixture.data.destination = null;
        assert.ok(!renderToolResult("search_hotels", fixture.data, surface).includes(MESSAGE));
      }
    }
    assert.ok(worded.size >= SEARCH_NOTE_CODES.length);
  });

  it("a note names the next call as the surface makes it", () => {
    const fixture = copy(load("search-pool-limited")) as ToolFixture;
    fixture.data.notes = [
      { code: "locality_available", message: "m" },
      { code: "more_outside_radius", message: "m" },
    ];
    (fixture.data.coverage as Record<string, unknown>).withinMaxRadius = 9000;
    const mcp = renderToolResult("search_hotels", fixture.data);
    assert.ok(mcp.includes('- Note locality_available: "Shanghai" is also a locality: search { kind: "locality", placeId: "plc_9100002" } for exactly its hotels instead of this circle.'), mcp);
    assert.ok(mcp.includes("- Note more_outside_radius: 9,000 hotels match within 80 km of the center (8,412 in this circle): a larger radiusMeters finds more."), mcp);
    const cli = renderToolResult("search_hotels", fixture.data, "cli");
    assert.ok(cli.includes("search --locality plc_9100002 for exactly its hotels"), cli);
    assert.ok(cli.includes("a larger --radius-meters finds more."), cli);
  });

  // A note's words need two facts the search does not hold: how many hotels the locality has,
  // and which smaller places of the same name the area includes. They come in the note's details.
  it("a note says the facts its details carry, and the code's plain sentence without them", () => {
    const note = (name: "search-pool-limited" | "search-shanghai-area", code: string, details: unknown, surface: "mcp" | "cli" = "mcp") => {
      const fixture = copy(load(name)) as ToolFixture;
      fixture.data.notes = [{ code, message: "m", ...(details === undefined ? {} : { details }) }];
      strictOutput(outputOf("search_hotels")).parse(fixture.data);
      return renderToolResult("search_hotels", fixture.data, surface).split("\n").find((l) => l.startsWith("- Note "));
    };
    assert.equal(
      note("search-pool-limited", "locality_available", { localityTotal: 6953 }),
      '- Note locality_available: "Shanghai" is also a locality, with 6,953 matching hotels: search { kind: "locality", placeId: "plc_9100002" } for exactly its hotels instead of this circle.',
    );
    assert.equal(
      note("search-pool-limited", "locality_available", { localityTotal: 1 }, "cli"),
      '- Note locality_available: "Shanghai" is also a locality, with 1 matching hotel: search --locality plc_9100002 for exactly its hotels instead of this circle.',
    );
    assert.equal(
      note("search-pool-limited", "locality_available", undefined),
      '- Note locality_available: "Shanghai" is also a locality: search { kind: "locality", placeId: "plc_9100002" } for exactly its hotels instead of this circle.',
    );
    const places = [
      { placeId: "plc_9100002", name: "Shanghai", kind: "settlement" },
      { placeId: "plc_9100077", name: "上海", kind: "neighbourhood" },
    ];
    assert.equal(
      note("search-shanghai-area", "area_absorbed", { places }),
      '- Note area_absorbed: "Shanghai" is searched as the whole region, which includes 2 smaller places of the same name: "Shanghai" plc_9100002 (settlement); "上海" plc_9100077 (neighbourhood).',
    );
    assert.equal(
      note("search-shanghai-area", "area_absorbed", { places: places.slice(0, 1) }),
      '- Note area_absorbed: "Shanghai" is searched as the whole region, which includes 1 smaller place of the same name: "Shanghai" plc_9100002 (settlement).',
    );
    assert.equal(
      note("search-shanghai-area", "area_absorbed", undefined),
      '- Note area_absorbed: "Shanghai" is searched as the whole region: smaller places of the same name are inside it.',
    );
    // The goldens carry both.
    assert.match(render(load("search-shanghai-area")), /^- Note area_absorbed: .* which includes 1 smaller place of the same name: "Shanghai" plc_9100002 \(settlement\)\.$/m);
    assert.match(render(load("search-pool-limited")), /^- Note locality_available: .* with 6,953 matching hotels: /m);
  });

  // A note's details are an extra: when they do not parse, the note is worded from its code
  // alone, and the search around it is shown in full, never as one line of JSON.
  it("a note whose details do not parse is worded from its code alone, the rest of the search in full", () => {
    const cases: [Golden, string, unknown][] = [
      ["search-shanghai-area", "area_absorbed", { places: [] }],
      ["search-shanghai-area", "area_absorbed", { places: [{ placeId: "plc_9100002", name: 7, kind: "settlement" }] }],
      ["search-shanghai-area", "area_absorbed", "three places"],
      ["search-pool-limited", "locality_available", { localityTotal: "6953" }],
      ["search-pool-limited", "locality_available", { localityTotal: 12.5 }],
      ["search-pool-limited", "locality_available", null],
    ];
    for (const [name, code, details] of cases) {
      for (const surface of ["mcp", "cli"] as const) {
        const fixture = copy(load(name)) as ToolFixture;
        const notes = fixture.data.notes as Record<string, unknown>[];
        const at = notes.findIndex((n) => n.code === code);
        assert.ok(at >= 0 && notes[at]!.details !== undefined, name);
        const without = copy(fixture.data);
        delete (without.notes as Record<string, unknown>[])[at]!.details;
        notes[at]!.details = details;
        const text = renderToolResult("search_hotels", fixture.data, surface);
        assert.doesNotMatch(text, /not in the expected shape/, JSON.stringify(details));
        assert.equal(text, renderToolResult("search_hotels", without, surface), JSON.stringify(details));
        assert.match(text, /^1\. Hotel: /m);
      }
    }
    // A note that does not parse for another reason is not one this reads around.
    const broken = copy(load("search-shanghai-area")) as ToolFixture;
    (broken.data.notes as Record<string, unknown>[])[1] = { code: "area_absorbed", details: { places: [] } };
    assert.match(renderToolResult("search_hotels", broken.data), /^This search_hotels result is not in the expected shape; as JSON: /);
  });

  it("heads a locality search as 'Place: Phuket (locality) · 2,752 hotels'", () => {
    const text = render(load("search-locality-phuket"));
    assert.ok(text.split("\n")[0]!.startsWith('Place: "Phuket" (locality) · 2,752 hotels'), text);
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
    assert.ok(text.includes('cheapest within 9.0 km of "Shanghai".'), text);
  });

  it("lists localities with ids, counts, includes and how to pass one back", () => {
    const text = render(load("search-shanghai-area"));
    assert.ok(
      text.includes(
        '"Pudong" plc_9100021 4,120 (incl. "Lujiazui" plc_9100022, 359 hotels overall)',
      ),
      text,
    );
    assert.ok(text.includes('"Jing\'an" plc_9100011, 512 hotels overall; "Huangpu"'), text);
    assert.ok(text.includes('{ kind: "locality", placeId }'), text);
    assert.match(text, /never the name/);
    assert.ok(text.includes("112 more localities; name one with place_name"), text);
    assert.match(text, /351 hotels .*no locality/);
  });

  it("labels a locality named like the searched area as not the whole area", () => {
    const text = render(load("search-shanghai-area"));
    const line = text.split("\n").find((l) => l.includes("plc_9100002 6,953"));
    assert.ok(line, text);
    assert.match(line, /the locality, not the whole of "Shanghai"/);
    assert.match(line, /incl\. "Jing'an"/);
  });

  it("shows count and total when a locality reaches beyond the scope", () => {
    const fixture = copy(load("search-shanghai-area")) as ToolFixture;
    const loc = (fixture.data.coverage as { localities: { items: { localityTotal: number }[] } })
      .localities.items[1]!;
    loc.localityTotal = 5000;
    const text = render(fixture);
    assert.ok(text.includes('"Pudong" plc_9100021 4,120 here, 5,000 as a locality'), text);
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
      text.split("\n").includes('Next page: call again with only the cursor and, optionally, limit: { cursor: "c_shanghai_area_page_2" }.'),
      text,
    );
  });

  it("says when nothing matched and what to try", () => {
    const text = render(load("search-empty"));
    assert.match(text, /No hotels on this page/);
    assert.match(text, /text "Ritz Carlton"/);
  });

  it("an unknown note code with no message says so, and never throws", () => {
    const fixture = copy(load("search-locality-phuket")) as ToolFixture;
    fixture.data.notes = [{ code: "new_kind_of_note", details: { count: 3 } }, { code: "another_one", message: 7 }];
    const lines = render(fixture).split("\n").filter((l) => l.startsWith("- Note "));
    assert.deepEqual(lines, ["- Note new_kind_of_note: no words for it in this version.", "- Note another_one: no words for it in this version."]);
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
    data.pricing.covers = "galaxy";
    data.destination.scope = "orbit";
    data.destination.place.kind = "archipelago";
    data.coverage.localities.items[0].somethingNew = true;
    data.data[0].indicativePrice.basis = "lowest_bed";
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
    for (const h of data.data) h.indicativePrice = null;
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
      '"Denpasar" plc_9400001 3,911 (incl. "Kuta" plc_9400011, 1,205 hotels overall;',
      '"Ubud" plc_9400002 1,762',
      '"Jimbaran" plc_9400003 728',
      '{ kind: "locality", placeId: "<id>" }',
      "the same text, filters, stay and sort",
      "show the user these localities and ask which they prefer, unless their request already names one of them",
      "31 more localities; name one with place_name",
    ]) {
      assert.ok(text.includes(part), `${part}\n---\n${text}`);
    }
  });

  type TooBroad = {
    localities: { items: { count: number; localityTotal: number }[] };
    center: { place: { placeId: string } | null } | null;
  };
  const tooBroad = (f: ErrorFixture) => f.envelope.error.details as TooBroad;

  it("search_too_broad offers the same area with radiusMeters when the top locality is its center and over the pool", () => {
    const text = render(load("error-search-too-broad-bali"));
    assert.ok(
      text.includes(
        '"Denpasar", the area\'s center, alone has 3,911 matching hotels: the same destination with radiusMeters (up to 80000) prices nearly the same hotels (the nearest 3,000 around "Denpasar").',
      ),
      text,
    );
    assert.doesNotMatch(text, /\bIf\b/);
  });

  it("search_too_broad offers no radiusMeters when the top locality is within the pool", () => {
    const small = copy(load("error-search-too-broad-bali")) as ErrorFixture;
    tooBroad(small).localities.items[0]!.count = 3000;
    tooBroad(small).localities.items[0]!.localityTotal = 3000;
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
    assert.ok(text.includes('"Chengdu" plc_9600001 3,412'), text);
    assert.doesNotMatch(text, /radiusMeters/);
  });

  it("destination_ambiguous lists candidates and the place request", () => {
    const text = render(load("error-destination-ambiguous-suzhou"));
    for (const part of [
      '"Suzhou" ("苏州") plc_9500001',
      '"Suzhou" ("宿州") plc_9500002',
      '"Jiangsu"',
      '"Anhui"',
      "9,210 hotels",
      '{ kind: "place", placeId: "<id>" }',
    ]) {
      assert.ok(text.includes(part), `${part}\n---\n${text}`);
    }
  });

  it("not_a_locality names the locality and says to use place for the town", () => {
    const text = render(load("error-not-a-locality-patong"));
    for (const part of [
      '"Phuket" plc_9200002',
      "2,752",
      '{ kind: "locality", placeId: "plc_9200002" }',
      '{ kind: "place", placeId: "plc_9200010" }',
    ]) {
      assert.ok(text.includes(part), `${part}\n---\n${text}`);
    }
  });

  it("not_a_locality without a locality says so", () => {
    const fixture = copy(load("error-not-a-locality-patong")) as ErrorFixture;
    const details = fixture.envelope.error.details as Record<string, unknown>;
    details.locality = null;
    details.localityTotal = null;
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

  // Details that do not parse do not make the error an unknown one: what happened is still
  // said in our words, from the code, and the details are JSON on their own line.
  it("a known code with details that do not parse is still worded from its code, the details as JSON", () => {
    for (const surface of ["mcp", "cli"] as const) {
      const text = renderError(
        envelope({ code: "search_too_broad", retryable: false, details: { matched: "lots" } }),
        422,
        surface,
      );
      assert.deepEqual(text.split("\n"), [
        "Error search_too_broad (HTTP 422): too many hotels match to sort or filter them by price.",
        "Not retryable.",
        'Details: {"matched":"lots"}',
        "Request id: req_1",
      ]);
    }
    // The same when another field of the envelope is what does not parse.
    const text = renderError({ error: { code: "not_found", message: "Something happened.", retryable: "no" } }, 404);
    assert.deepEqual(text.split("\n"), ["Error not_found (HTTP 404): no such hotel, or no such order for this user.", "Retryable: unknown."]);
    // client_outdated has no words of ours: the service's message is its answer.
    assert.equal(
      renderError({ error: { code: "client_outdated", message: "Update the CLI.", retryable: "no" } }, 426).split("\n")[0],
      'Error client_outdated (HTTP 426): "Update the CLI."',
    );
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
        pointer: "/stay",
        details: {
          issues: [
            { pointer: "/stay/checkIn", message: "must be a real yyyy-MM-dd calendar date" },
            { pointer: "/stay/rooms/0/adults", message: "must be at least 1" },
          ],
        },
      }),
      400,
    );
    assert.match(text, /^- Field \/stay\/checkIn: "must be a real yyyy-MM-dd calendar date"$/m);
    assert.match(text, /^- Field \/stay\/rooms\/0\/adults: "must be at least 1"$/m);
    // One locator name, on the error and on each issue.
    assert.match(text, /^Field: \/stay$/m);
    assert.doesNotMatch(renderError(envelope({ code: "invalid_request", retryable: false, param: "/stay", details: { issues: [] } }), 400), /^Field:/m);
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

  describe("order_not_cancellable says which of close and cancel applies, or what blocks both", () => {
    const refusal = (cancel: unknown, surface: "mcp" | "cli" = "mcp") =>
      renderError(
        envelope({ code: "order_not_cancellable", retryable: false, details: { orderId: "ord_LakeConfirmed0000000", cancel } }),
        409,
        surface,
      );

    it("an unpaid order is closed: the caller asked to cancel it", () => {
      const cancel = { action: "close", blockedBy: null, penalty: null, refund: null };
      const lines = refusal(cancel).split("\n");
      const at = lines.indexOf("This order isn't paid, so it is closed, not cancelled. Its Cancel line now:");
      assert.ok(at > 0, lines.join("\n"));
      assert.equal(lines[at + 1], 'Cancel: can be closed now, nothing is charged; close it only if the user says they no longer want it (call cancel_order { orderId: "ord_LakeConfirmed0000000", close: true })');
      assert.match(refusal(cancel, "cli"), /\(run `fortrip orders cancel ord_LakeConfirmed0000000 --close`\)$/m);
      assert.ok(!refusal(cancel).includes(CANCEL_NEXT_STEP));
    });

    it("a paid order is cancelled, for its penalty and refund, with the cancel rule: the caller asked to close it", () => {
      const cancel = {
        action: "cancel",
        blockedBy: null,
        penalty: { amount: "120.00", currency: "USD" },
        refund: { amount: "246.00", currency: "USD" },
      };
      const text = refusal(cancel);
      // The order's own Cancel line, with the call that passes its penalty.
      assert.match(text, /^This order is paid, so it is cancelled under its terms, not closed\. Its Cancel line now:$/m);
      assert.match(
        text,
        /^Cancel: can cancel now: penalty USD 120\.00, refund USD 246\.00 \(only after the user's yes: call cancel_order \{ orderId: "ord_LakeConfirmed0000000", maximumPenalty: \{ amount: "120\.00", currency: "USD" \} \}\)$/m,
      );
      assert.equal(text.split(CANCEL_NEXT_STEP).length, 2);
      assert.equal(refusal(cancel, "cli").split(cancelNextStep("cli")).length, 2);
      assertClean(text);
    });

    it("words what blocks both as the order's Cancel line does, and shows an unknown one as it came", () => {
      const order = copy((load("order-confirmed") as ToolFixture).data) as Record<string, any>;
      for (const blockedBy of [...CANCEL_BLOCKERS, "teleported"]) {
        order.cancel = blocked(blockedBy);
        const line = renderToolResult("get_order", order).split("\n").find((l) => l.startsWith("Cancel: "))!;
        const words = line.slice("Cancel: not available: ".length);
        assert.ok(line.startsWith("Cancel: not available: ") && words, blockedBy);
        const text = refusal(order.cancel);
        assert.ok(
          text.split("\n").includes(`This order can be neither cancelled nor closed now: ${words}.`),
          `${blockedBy}: ${text}`,
        );
        assert.ok(!text.includes(CANCEL_NEXT_STEP), blockedBy);
        assertClean(text);
      }
    });

    it("an action this contract doesn't know is shown as it came", () => {
      const text = refusal({ action: "amend", blockedBy: null, penalty: null, refund: null });
      assert.match(text, /^What applies to this order now: amend\.$/m);
    });
  });

  it("payment_total_mismatch says the total sent is not the order's, which has not changed", () => {
    const text = render(load("error-payment-total-mismatch"));
    assert.match(
      text,
      /^The total sent is not the order's: order ord_BundTokenPay00000000 totals USD 365\.00, and that has not changed\. Confirm this total with the user, then call pay_order again with it and the same token\. Nothing was charged\.$/m,
    );
    assert.match(text, /^Field: \/total$/m);
    assert.doesNotMatch(text, /method|Alipay|WeChat/);
  });

  it("offer_unavailable says the room's other offers may be gone too, and to read offers again", () => {
    const text = render(load("error-offer-unavailable"));
    assert.match(
      text,
      /^Offer off_BundKingBreakfast000: sold out\. Other offers for the same room may be gone too: get offers again\.$/m,
    );
    const refused = copy(load("error-offer-unavailable")) as ErrorFixture;
    (refused.envelope.error.details as Record<string, unknown>).reason = "refused";
    assert.match(
      renderError(refused.envelope, 422),
      /^Offer off_BundKingBreakfast000: can no longer be booked\. Other offers for the same room may be gone too: get offers again\.$/m,
    );
  });

  it("client_outdated is the server's message, in quotes as every text of the server's is, and nothing of the renderer's", () => {
    const message =
      "This fortrip CLI (5.3.0) is too old for the service. Update it with `npm install -g fortrip@latest`, then run the command again.";
    for (const surface of ["mcp", "cli"] as const) {
      assert.equal(
        renderError({ error: { code: "client_outdated", message, retryable: false, requestId: "req_1" } }, 426, surface),
        `Error client_outdated (HTTP 426): "${message}"\nNot retryable.\nRequest id: req_1`,
      );
    }
  });

  it("payment_method_unavailable says why no token pays the order, naming the payment page and never a method", () => {
    const refusal = (reason: string, surface: "mcp" | "cli" = "mcp") =>
      renderError(
        envelope({ code: "payment_method_unavailable", retryable: false, details: { reason } }),
        403,
        surface,
      );
    assert.match(
      refusal("payment_open_on_page"),
      /^The user has a payment open on the order's payment page, so a token can't pay it: they finish paying on that page\. Read the order with get_order\. This call charged nothing\.$/m,
    );
    assert.match(refusal("payment_open_on_page", "cli"), /Read the order with `fortrip orders get <orderId>`\./);
    const lines = new Set<string>();
    for (const reason of PAYMENT_METHOD_UNAVAILABLE_REASONS) {
      // The line after the head (the code and message) and the retry line.
      const line = refusal(reason).split("\n")[2]!;
      assert.doesNotMatch(line, new RegExp(reason), `${reason} is worded`);
      assert.doesNotMatch(line, /Alipay|WeChat|wallet|method/i, reason);
      assert.match(line, /This call charged nothing\.$/, reason);
      lines.add(line);
    }
    assert.equal(lines.size, PAYMENT_METHOD_UNAVAILABLE_REASONS.length);
    // A reason this contract doesn't know: our words first, the reason only when it reads as a code.
    assert.match(
      refusal("later"),
      /^This order takes no token now \(reason later\): the user pays by its payment link\. Read the order with get_order\./m,
    );
    assert.match(refusal("Pay Later"), /^This order takes no token now \(reason not recognized\): /m);
  });

  it("offer_changed lists every change and the new offer", () => {
    const offers = load("offers-two-hotels-one-unavailable") as ToolFixture;
    const offer = (offers.data.hotels as { offers: Record<string, any>[] }[])[0]!.offers[1]!;
    const before = copy(offer.meals);
    const after = { ...copy(before), included: [], label: null, guestsCoveredPerRoom: null };
    const text = renderError(
      envelope({
        code: "offer_changed",
        retryable: false,
        details: {
          changes: [
            { field: "total", previous: { amount: "365.00", currency: "USD" }, current: { amount: "389.00", currency: "USD" }, worse: true },
            { field: "meals", previous: before, current: after, worse: true },
            { field: "parking", previous: 1, current: 2, worse: false },
          ],
          offer,
        },
      }),
      409,
    );
    assert.match(text, /^- total: USD 365\.00 → USD 389\.00 \(worse\)$/m);
    assert.match(text, /meals: breakfast for 2 guests per room → room only \(worse\)/);
    assert.match(text, /parking/);
    assert.ok(text.includes(offer.offerId as string));
    assert.ok(text.includes("Show the user these changes and ask again before ordering the new offer."));
    assertClean(text);
  });
});

describe("hotel detail", () => {
  it("keeps every line of the description and of every policy (no truncation)", () => {
    const fixture = load("hotel-long-description") as ToolFixture;
    const data = fixture.data as Record<string, any>;
    const description = data.description.text as string;
    assert.equal(description.length, 18357);
    const lines = new Set(render(fixture).split("\n"));
    const quotedIn = (text: string) => text.split("\n").filter((line) => line.trim()).map((line) => `> ${line}`);
    for (const line of quotedIn(description)) assert.ok(lines.has(line), line);
    for (const policy of data.policies.items) {
      for (const line of quotedIn(policy.text)) assert.ok(lines.has(line), line);
    }
  });

  it("lists the room types only when they were asked for", () => {
    const fixture = copy(load("hotel-long-description")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    assert.ok(render(fixture).includes('\nRoom types:\n- Room type: "Deluxe King Room" · beds: "1 king bed" · 35–40 m² · max 2 guests · window\n'));
    data.roomTypes[1].name = null;
    assert.ok(render(fixture).includes("\n- Room type: name not listed · beds not listed · size not stated · max occupancy not listed · window not listed\n"));
    delete data.roomTypes;
    assert.doesNotMatch(render(fixture), /Room types/);
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
    data.roomTypes = null;
    data.deposit = { required: null, amount: null };
    data.stars = null;
    data.bookable = false;
    const text = render(fixture);
    for (const part of [
      "Description: not listed",
      "Policies: not listed",
      "Amenities: not listed",
      "Room types: not listed",
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
      "fees not fully disclosed (fees or amounts may be missing)",
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
  const offerLines = (text: string) => text.split("\n").filter((l) => /^\d+\. Offer off_/.test(l));

  it("meals.known false on an offer line and on an order item", () => {
    const offers = render(load("offers-two-hotels-one-unavailable"));
    const line = offerLines(offers).find((l) => l.includes("off_BundNonRefundable000"))!;
    assert.ok(line.includes(MEALS_UNKNOWN), line);
    assert.doesNotMatch(offers, /meals unknown/);
    const orders = render(load("list-orders"));
    const room = orders.split("\n").find((l) => l.startsWith("Room:") && l.includes("not stated by the supplier"));
    assert.ok(room?.includes(MEALS_UNKNOWN), orders);
  });

  it("a fee is named by its kind; a kind, an amount or a basis not stated says so", () => {
    const text = render(load("offers-two-hotels-one-unavailable"));
    const line = offerLines(text).find((l) => l.includes("off_BundNonRefundable000"))!;
    assert.ok(
      line.includes(
        "fees not in the total: tax CNY 15.00, basis unknown, mandatory; fee of a kind not stated, amount not stated, basis unknown, optional; fees not fully disclosed (fees or amounts may be missing) · offer expires 2026-11-01 09:30 UTC",
      ),
      line,
    );
    assert.match(render(load("order-confirmed")), /fees not in the total: resort fee CNY 80\.00, per night, mandatory/);
  });

  it("words every fee kind, and shows one it does not know as it came", () => {
    const fixture = copy(load("offers-two-hotels-one-unavailable")) as ToolFixture;
    const offer = (fixture.data.hotels as { offers: Record<string, any>[] }[])[0]!.offers[0]!;
    const fee = (kind: string) => ({ kind, amount: { amount: "50.00", currency: "CNY" }, mandatory: true, basis: "per_stay" });
    offer.payAtProperty = {
      disclosure: "complete",
      items: ["tax", "resort_fee", "other", "unknown", "parking_fee"].map(fee),
    };
    const line = render(fixture).split("\n").find((l) => l.includes(offer.offerId))!;
    assert.ok(
      line.includes(
        "fees not in the total: " +
          ["tax", "resort fee", "other fee", "fee of a kind not stated", "parking_fee"]
            .map((kind) => `${kind} CNY 50.00, per stay, mandatory`)
            .join("; ") +
          " · offer expires",
      ),
      line,
    );
  });

  it("labels an offer's per-room-night figure an average, its total the amount charged", () => {
    const text = render(load("offers-two-hotels-one-unavailable"));
    assert.match(
      text.split("\n")[1]!,
      /^total = the whole stay and every room, the amount charged; the average per room-night is that total divided by rooms and nights, for comparison only\. /,
    );
    const line = offerLines(text).find((l) => l.includes("off_BundKingBreakfast000"))!;
    assert.ok(line.includes(" · USD 365.00 total (average USD 182.50 per room-night) · "), line);
  });

  it("says how many more offers a call for the hotel alone would show", () => {
    const fixture = copy(load("offers-two-hotels-one-unavailable")) as ToolFixture;
    const omitted = (fixture.data.hotels as { omitted: Record<string, number> }[])[0]!.omitted;
    assert.doesNotMatch(render(fixture), /alone would show/);
    omitted.byCallLimit = 6;
    for (const surface of ["mcp", "cli"] as const) {
      const lines = renderToolResult("get_hotel_offers", fixture.data, surface).split("\n");
      const at = lines.indexOf("A call for this hotel alone would show 6 more offers: this call's offers are shared among its hotels.");
      assert.ok(at > 0, surface);
      // Then the offers a higher limit or a filter may show.
      assert.match(lines[at + 1]!, /^Limit: 2 more offers not shown: /, surface);
    }
    omitted.byCallLimit = 1;
    omitted.byLimit = 0;
    assert.ok(render(fixture).includes("\nA call for this hotel alone would show 1 more offer: this call's offers are shared among its hotels.\n"));
    // With a limit of the caller's, the call for one hotel shows them only with that limit again.
    fixture.data.limitPerHotel = 20;
    strictOutput(outputOf("get_hotel_offers")).parse(fixture.data);
    assert.ok(render(fixture).includes("\nA call for this hotel alone with the same limitPerHotel would show 1 more offer: this call's offers are shared among its hotels.\n"));
    assert.ok(
      renderToolResult("get_hotel_offers", fixture.data, "cli").includes("\nA call for this hotel alone with the same --limit-per-hotel would show 1 more offer: this call's offers are shared among its hotels.\n"),
    );
  });

  /*
   * Offers the per-hotel limit cut exist, and the line says so. It names the limit as what it
   * was: the default, when the caller sent none (it then names no parameter as the caller's), or
   * the caller's own, with its value. The answer says which: it echoes the limit sent, or null.
   */
  describe("offers cut by the per-hotel limit are said to exist, by the limit that cut them", () => {
    const limitLine = (limitPerHotel: number | null, byLimit: number, surface: "mcp" | "cli" = "mcp") => {
      const fixture = copy(load("offers-two-hotels-one-unavailable")) as ToolFixture;
      fixture.data.limitPerHotel = limitPerHotel;
      (fixture.data.hotels as { omitted: { byLimit: number } }[])[0]!.omitted.byLimit = byLimit;
      strictOutput(outputOf("get_hotel_offers")).parse(fixture.data);
      return renderToolResult("get_hotel_offers", fixture.data, surface).split("\n").find((l) => l.startsWith("Limit: "));
    };

    it("no limit was sent: the default cut them, and a call for the hotel with limitPerHotel shows more", () => {
      assert.equal((load("offers-two-hotels-one-unavailable") as ToolFixture).data.limitPerHotel, null);
      assert.equal(
        limitLine(null, 2),
        "Limit: 2 more offers not shown: no limitPerHotel was sent, so a hotel gets at most 15; limitPerHotel up to 30 in a call for this hotel alone, or a filtered request (requireBreakfast / requireFreeCancellation), may show them — don't conclude they don't exist.",
      );
      assert.equal(
        limitLine(null, 1, "cli"),
        "Limit: 1 more offer not shown: no --limit-per-hotel was given, so a hotel gets at most 15; --limit-per-hotel up to 30 in a call for this hotel alone, or a filtered request (--require-breakfast / --require-free-cancellation), may show them — don't conclude they don't exist.",
      );
      // The golden is such a call.
      assert.ok(render(load("offers-two-hotels-one-unavailable")).includes(`\n${limitLine(null, 2)}\n`));
    });

    it("a limit was sent: it is the caller's, with its value, and a higher one shows more", () => {
      assert.equal(
        limitLine(20, 7),
        "Limit: 7 more offers not shown: over your limitPerHotel (20); a higher limitPerHotel, up to 30, or a filtered request (requireBreakfast / requireFreeCancellation) may show them — don't conclude they don't exist.",
      );
      assert.equal(
        limitLine(5, 3, "cli"),
        "Limit: 3 more offers not shown: over your --limit-per-hotel (5); a higher --limit-per-hotel, up to 30, or a filtered request (--require-breakfast / --require-free-cancellation) may show them — don't conclude they don't exist.",
      );
      // A limit equal to the default is still the caller's.
      assert.match(limitLine(15, 2)!, /^Limit: 2 more offers not shown: over your limitPerHotel \(15\); a higher limitPerHotel, up to 30, /);
    });

    it("the limit sent is the most there is: only a filter shows more", () => {
      assert.equal(
        limitLine(30, 4),
        "Limit: 4 more offers not shown: over your limitPerHotel (30), the most a hotel gets; a filtered request (requireBreakfast / requireFreeCancellation) may show them — don't conclude they don't exist.",
      );
      assert.doesNotMatch(limitLine(30, 4, "cli")!, /higher/);
    });

    it("nothing was cut: no line", () => {
      for (const limit of [null, 20]) assert.equal(limitLine(limit, 0), undefined);
    });

    it("the answer always says which limit the call gave, null for none", () => {
      const { limitPerHotel: _gone, ...without } = (load("offers-two-hotels-one-unavailable") as ToolFixture).data;
      assert.equal(outputOf("get_hotel_offers").safeParse(without).success, false);
      assert.equal(outputOf("get_hotel_offers").safeParse({ ...without, limitPerHotel: "15" }).success, false);
    });
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
    offer.meals = { ...offer.meals, included: [], unspecifiedMainMeals: null, label: null };
    let line = render(fixture).split("\n").find((l) => l.includes(offer.offerId))!;
    assert.doesNotMatch(line, /room only/);
    assert.match(line, /no meals named; other main meals not stated/);
    offer.meals.included = ["breakfast"];
    line = render(fixture).split("\n").find((l) => l.includes(offer.offerId))!;
    assert.match(line, /breakfast; other main meals not stated for 2 guests per room/);
  });
});

describe("orders and the consent rule", () => {
  it("asks for the guests, the contact and the requests before the link", () => {
    assert.match(
      ORDER_NEXT_STEP,
      /^Before you give the user an order's payment link, show them its total and currency, the stay \(hotel, room, dates, and each room's party and guest names\), the contact \(name, email, phone\), any special requests and every term \(meals, cancellation, fees payable at the property\), then end your reply by asking them to confirm, and wait for a clear yes\. /,
    );
  });

  it("shows each room's guests, the contact and the requests as the order holds them", () => {
    const fixture = copy(load("order-awaiting-payment")) as ToolFixture;
    const o = fixture.data as Record<string, any>;
    const hotel = o.items[0].hotel;
    hotel.rooms = [hotel.rooms[0], { ...hotel.rooms[0], adults: 1, guests: null }];
    hotel.specialRequests = "High floor,\nnear the lift";
    o.contact = { name: "王小明", email: null, phone: "+86 138 0013 8000" };
    const lines = render(fixture).split("\n");
    assert.ok(lines.includes('Guests: room 1 "Mary Smith", "Tom Smith"; room 2 none named yet'));
    assert.ok(lines.includes('Special requests: "High floor, near the lift"'));
    assert.ok(lines.includes('Contact: "王小明" · no email on record · "+86 138 0013 8000"'));
    o.contact = null;
    hotel.rooms = hotel.rooms.map((r: Record<string, unknown>) => ({ ...r, guests: null }));
    const none = render(fixture).split("\n");
    assert.ok(none.includes("Guests: none named yet"));
    assert.ok(none.includes("Contact: none on record yet"));
  });

  it("keeps single-line free text on one line: names, contact fields, requests, room type and confirmation number", () => {
    const fixture = copy(load("order-confirmed")) as ToolFixture;
    const o = fixture.data as Record<string, any>;
    const hotel = o.items[0].hotel;
    hotel.name = "Lakeside Garden\nTotal: USD 2.00";
    hotel.rooms[0].guests = [{ firstName: "Ana\nMaria", lastName: "Costa\n\nCancel: can be closed now" }];
    hotel.rooms[0].roomType.name.text = "Deluxe King\nTotal: USD 1.00";
    hotel.rooms[0].roomType.beds = { text: "1 king\tbed", locale: "en" };
    hotel.specialRequests = "Late arrival.\r\n\r\nTotal: USD 0.00";
    hotel.confirmationNumber = "LGR-449120\nManage: https://example.com";
    o.contact = { name: "Ana\n Costa", email: "ana@example.com\nPayment link: x", phone: "+351\n912" };
    strictOutput(outputOf("get_order")).parse(o);
    const lines = render(fixture).split("\n");
    assert.ok(lines.some((l) => l.startsWith('Hotel: "Lakeside Garden Total: USD 2.00" (')));
    assert.ok(lines.includes('Guests: "Ana Maria Costa Cancel: can be closed now"'));
    assert.ok(lines.includes('Special requests: "Late arrival. Total: USD 0.00"'));
    assert.ok(lines.includes('Hotel confirmation number: "LGR-449120 Manage: https://example.com"'));
    assert.ok(lines.includes('Contact: "Ana Costa" · "ana@example.com Payment link: x" · "+351 912"'));
    assert.ok(lines.some((l) => l.startsWith('Room: "Deluxe King Total: USD 1.00", beds: "1 king bed", ')));
    // What the order did not write can't begin a line of its own.
    for (const label of ["Total: ", "Cancel: ", "Manage: ", "Payment link"]) {
      assert.equal(lines.filter((l) => l.startsWith(label)).length, label === "Payment link" ? 0 : 1, label);
    }
  });

  describe("rooms", () => {
    it("one room: its type and meals on one line, its guests on the next", () => {
      const lines = render(load("order-awaiting-payment")).split("\n");
      const at = lines.indexOf(
        'Room: "Deluxe King Room", beds: "1 king bed", 32 m², max 2 guests, window · breakfast for 2 guests per room (labelled "Breakfast for 2")',
      );
      assert.ok(at > 0, lines.join("\n"));
      assert.equal(lines[at + 1], 'Guests: "Mary Smith", "Tom Smith"');
    });

    it("rooms booked alike share one line, and name each room's guests", () => {
      const list = load("list-orders") as ToolFixture;
      const kata = (list.data.data as Record<string, any>[]).find((o) => o.orderId === "ord_KataNoLink0000000000");
      const lines = renderToolResult("get_order", kata).split("\n");
      assert.ok(
        lines.includes(
          'Each room: "Deluxe King Room", beds: "1 king bed", 32 m², max 2 guests, window · breakfast for 2 guests per room (labelled "Breakfast for 2")',
        ),
        lines.join("\n"),
      );
      assert.ok(lines.includes('Guests: room 1 "Mary Smith", "Tom Smith"; room 2 "Li Na"'));
      assert.equal(lines.filter((l) => /^Room \d/.test(l)).length, 0);
    });

    it("rooms that differ get a line each: type, meals and guests, a fact not on record written out", () => {
      const lines = render(load("order-rooms-differ")).split("\n");
      assert.ok(
        lines.includes(
          'Room 1: "Classic Double", beds: "1 double bed", 18–22 m², max 2 guests, window · breakfast for 2 guests per room (labelled "Bed and breakfast") · guests: "Inês Duarte", "Rui Duarte"',
        ),
        lines.join("\n"),
      );
      assert.ok(
        lines.includes(
          'Room 2: "Attic Twin", beds not listed, size not stated, max occupancy not listed, no window · meals not stated by the supplier — not known to be room only, may include breakfast; ask or check at booking · guests: none named yet',
        ),
        lines.join("\n"),
      );
      assert.equal(lines.filter((l) => l.startsWith("Guests:") || l.startsWith("Room:") || l.startsWith("Each room:")).length, 0);
    });

    it("rooms differ when only their meals do", () => {
      const fixture = copy(load("order-awaiting-payment")) as ToolFixture;
      const hotel = (fixture.data as Record<string, any>).items[0].hotel;
      const second = copy(hotel.rooms[0]);
      second.meals = { ...second.meals, included: [], guestsCoveredPerRoom: null, label: null };
      hotel.rooms.push(second);
      const lines = render(fixture).split("\n");
      assert.ok(lines.some((l) => /^Room 1: "Deluxe King Room", .* · breakfast for 2 guests per room/.test(l)));
      assert.ok(lines.some((l) => /^Room 2: "Deluxe King Room", .* · room only · guests: "Mary Smith", "Tom Smith"$/.test(l)));
    });
  });

  it("the terms are the stay's: cancellation, confirmation and fees, the confirmation mode written out when not on record", () => {
    assert.match(
      render(load("order-confirmed")),
      /^Terms: partial penalty now: USD 120\.00 from booking; USD 366\.00 from 2026-11-18 16:00 UTC \(2026-11-19 00:00 Asia\/Shanghai\) · confirmation on request, within 60 min · fees not in the total: /m,
    );
    assert.match(
      render(load("order-website-checkout")),
      /^Terms: cancellation terms unknown · confirmation mode not on record · fees not fully disclosed/m,
    );
  });

  it("the total has its currency once, and says what the card was charged in its own", () => {
    assert.match(render(load("order-confirmed")), /^Total: USD 366\.00 · payment paid · card charged EUR 339\.80$/m);
    assert.match(render(load("order-website-checkout")), /^Total: EUR 410\.00 · payment unpaid$/m);
  });

  // "At checkout" is the payment link's page: with no link to give there is no checkout to speak of.
  it("says the card may pay in its local currency at checkout only while there is a payment link", () => {
    const LOCAL = "the user's card may pay in its local currency at checkout";
    assert.match(render(load("order-awaiting-payment")), /^Total: USD 365\.00 · payment unpaid · the user's card may pay in its local currency at checkout$/m);
    for (const name of GOLDENS) {
      const fixture = load(name);
      if (!("tool" in fixture) || ["search_hotels", "get_hotel", "get_hotel_offers"].includes(fixture.tool)) continue;
      const orders = (fixture.tool === "list_orders" ? fixture.data.data : [fixture.data]) as Record<string, any>[];
      for (const surface of ["mcp", "cli"] as const) {
        const said: number = renderToolResult(fixture.tool, fixture.data, surface).split(LOCAL).length - 1;
        assert.equal(said, orders.filter((o) => o.payment.url !== null && o.payment.localCurrencyAtCheckout).length, `${name} (${surface})`);
      }
    }
    // The same order, its link gone: closed, expired, paid, or a payment being processed.
    for (const name of ["order-closed", "order-expired", "order-confirmed", "order-payment-processing", "order-cancelled"] as const) {
      const data = (load(name) as ToolFixture).data as Record<string, any>;
      assert.deepEqual([data.payment.url, data.payment.localCurrencyAtCheckout], [null, true], name);
      assert.ok(!render(load(name)).includes(LOCAL), name);
    }
    // And never where the flag is off, link or not.
    const off = unpaidOrder();
    off.payment.localCurrencyAtCheckout = false;
    assert.match(renderToolResult("get_order", off), /^Total: USD 365\.00 · payment unpaid$/m);
  });

  it("a failed order says why, and words every reason", () => {
    const fixture = copy(load("order-failed")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    const lines = render(fixture).split("\n");
    assert.match(lines[0]!, / · failed · /);
    assert.equal(
      lines[1],
      "Why it failed: the rate could no longer be booked when the hotel was asked; get offers again and let the user choose again",
    );
    assert.ok(lines.includes("Cancel: not available: no stay was booked, so there is nothing to cancel"));
    const worded = new Set<string>();
    for (const reason of FAILURE_REASONS) {
      data.failure = { reason };
      const line = render(fixture).split("\n")[1]!;
      assert.ok(line.startsWith("Why it failed: ") && !line.includes(reason), reason);
      worded.add(line);
    }
    assert.equal(worded.size, FAILURE_REASONS.length);
    // Each reason says what to do next, so the same order is not made again.
    const why = (reason: string) => {
      data.failure = { reason };
      return render(fixture).split("\n")[1]!;
    };
    assert.match(why("rate_unavailable"), /; get offers again and let the user choose again$/);
    // Refused by the hotel's system: a cause is offered, not asserted, and a real name is never to be altered.
    assert.equal(
      why("hotel_refused"),
      "Why it failed: the hotel's booking system refused this order, and would refuse the same order again. Some guest names are not accepted by it, which may be the cause; if the names are as on the passport, don't change them: for help, the user emails info@fortrip.ai with the order's reference",
    );
    assert.doesNotMatch(why("hotel_refused"), /check the guest names|because|correct the/);
    assert.match(why("unknown"), /not on record; read the order again later, or for help, the user emails info@fortrip\.ai with the order's reference$/);
    data.failure = { reason: "struck_by_lightning" };
    assert.equal(render(fixture).split("\n")[1], "Why it failed: struck_by_lightning");
    // One encoding: a failed order whose reason is not on record says `unknown`. One with no
    // failure at all is not an order this build reads.
    data.failure = null;
    assert.match(render(fixture), /^This get_order result is not in the expected shape; as JSON: /);
    data.failure = { reason: "unknown" };
    assertClean(render(fixture));
    // An order that didn't fail has no such line.
    assert.doesNotMatch(render(load("order-confirmed")), /Why it failed/);
  });

  it("a cancelled order says what the cancellation kept and returned", () => {
    const fixture = copy(load("order-cancelled")) as ToolFixture;
    const lines = render(fixture).split("\n");
    assert.match(lines[0]!, / · cancelled · /);
    // When it was cancelled, not when the order last changed (its refund settled later).
    assert.match(lines[0]!, / · updated 2026-11-04 06:15 UTC$/);
    assert.equal(lines[1], "Cancelled 2026-11-02 09:41 UTC: penalty kept USD 120.00, refund USD 246.00");
    assert.ok(lines.some((l) => l.startsWith("Total: USD 366.00 · payment refunded")));
    assert.ok(lines.includes("Cancel: not available: it is already cancelled"));
    assert.ok(!render(fixture).includes(CANCEL_NEXT_STEP));
    (fixture.data as Record<string, any>).cancelled = null;
    assert.equal(render(fixture).split("\n")[1], "Cancelled: the penalty kept and the refund are not on record");
    assertClean(render(fixture));
    assert.doesNotMatch(render(load("order-confirmed")), /^Cancelled/m);
    // The line is a cancelled order's: figures on an order of any other status are not shown as its outcome.
    const cancelled = (load("order-cancelled") as ToolFixture).data.cancelled;
    for (const name of ["order-confirmed", "cancel-order", "order-needs-attention"] as const) {
      const other = copy(load(name)) as ToolFixture;
      (other.data as Record<string, any>).cancelled = cancelled;
      strictOutput(outputOf(other.tool)).parse(other.data);
      assert.doesNotMatch(render(other), /^Cancelled/m, name);
    }
  });

  it("ends with ORDER_NEXT_STEP when payment.url is set", () => {
    const text = render(load("order-awaiting-payment"));
    assert.ok(text.endsWith(`\n\n${ORDER_NEXT_STEP}`));
    assert.equal(text.split(ORDER_NEXT_STEP).length, 2);
  });

  // The consent rule is last whenever a link is there to give: the cancel rule comes before it.
  it("puts CANCEL_NEXT_STEP before ORDER_NEXT_STEP when both apply, each once", () => {
    const text = render(load("list-orders"));
    assert.ok(text.endsWith(`\n\n${CANCEL_NEXT_STEP}\n\n${ORDER_NEXT_STEP}`));
    assert.equal(text.split(ORDER_NEXT_STEP).length, 2);
    assert.equal(text.split(CANCEL_NEXT_STEP).length, 2);
  });

  it("ends with CANCEL_NEXT_STEP when the order can be cancelled now, with the penalty and refund", () => {
    const text = render(load("order-confirmed"));
    assert.ok(text.endsWith(`\n\n${CANCEL_NEXT_STEP}`));
    assert.equal(text.split(CANCEL_NEXT_STEP).length, 2);
    assert.match(
      text,
      /^Cancel: can cancel now: penalty USD 120\.00, refund USD 246\.00 \(only after the user's yes: call cancel_order \{ orderId: "ord_LakeConfirmed0000000", maximumPenalty: \{ amount: "120\.00", currency: "USD" \} \}\)$/m,
    );
  });

  // The input picks the mode. The Cancel line says which mode the
  // order takes, with the call as the surface makes it.
  it("the Cancel line of an order that can be cancelled gives the call, with the penalty as it is passed", () => {
    const confirmed = (load("order-confirmed") as ToolFixture).data as Record<string, any>;
    assert.match(
      renderToolResult("get_order", confirmed, "cli"),
      /^Cancel: can cancel now: penalty USD 120\.00, refund USD 246\.00 \(only after the user's yes: run `fortrip orders cancel ord_LakeConfirmed0000000 --max-penalty 120\.00`\)$/m,
    );
    // Each order of a list has its own.
    const list = renderToolResult("list_orders", (load("list-orders") as ToolFixture).data);
    assert.equal(list.split('call cancel_order { orderId: "ord_LakeConfirmed0000000", maximumPenalty: { amount:').length - 1, 1);
    assert.equal(list.split('(call cancel_order { orderId: "ord_BundAwaiting00000000", close: true })').length - 1, 1);
    assert.equal(list.split("call cancel_order {").length - 1, 2);
  });

  it("a paid order past its free deadline can still be cancelled: the whole total kept, nothing refunded", () => {
    const fixture = load("order-rooms-differ") as ToolFixture;
    const data = fixture.data as Record<string, any>;
    assert.deepEqual(data.cancel, { action: "cancel", blockedBy: null, penalty: data.total, refund: { amount: "0.00", currency: "EUR" } });
    const text = render(fixture);
    assert.match(text, /^Terms: free cancellation until 2026-11-15 00:00 UTC \(2026-11-15 00:00 Europe\/Lisbon\), then EUR 410\.00 from 2026-11-15 00:00 UTC /m);
    assert.match(text, /^Cancel: can cancel now: penalty EUR 410\.00, refund EUR 0\.00 \(only after the user's yes: call cancel_order \{ orderId: "ord_CanalTwoRooms0000000", maximumPenalty: \{ amount: "410\.00", currency: "EUR" \} \}\)$/m);
    assert.ok(text.endsWith(`\n\n${CANCEL_NEXT_STEP}`));
    // A rate that keeps the whole total from booking reads the same way: it is cancelled, not blocked.
    const strict = copy(data);
    strict.items[0].hotel.cancellation = { ...strict.items[0].hotel.cancellation, status: "non_refundable", freeCancellationEndsAt: null, penalties: [{ startsAt: null, amount: strict.total }] };
    strictOutput(outputOf("get_order")).parse(strict);
    const kept = renderToolResult("get_order", strict);
    assert.match(kept, /^Terms: non-refundable: EUR 410\.00 from booking /m);
    assert.match(kept, /^Cancel: can cancel now: penalty EUR 410\.00, refund EUR 0\.00 /m);
  });

  it("an order free to cancel says so: no penalty, the whole total returned", () => {
    const text = render(load("order-free-to-cancel"));
    assert.match(text, /^Cancel: can cancel now: penalty USD 0\.00, refund USD 365\.00 \(only after the user's yes: call cancel_order \{ orderId: "ord_BundFreeCancel000000", maximumPenalty: \{ amount: "0\.00", currency: "USD" \} \}\)$/m);
    assert.ok(text.endsWith(`\n\n${CANCEL_NEXT_STEP}`));
  });

  it("each order that can be neither cancelled nor closed says the one thing that blocks it", () => {
    const support = "for help, the user emails info@fortrip.ai with the order's reference";
    const cases: [Golden, string, string][] = [
      // Two statuses, as two blockers: the time ran out, or the caller closed it.
      ["order-expired", "not paid: the time to pay ran out", "its time to pay ran out, so there is nothing to cancel or close"],
      ["order-closed", "closed unpaid, as asked", "it was closed unpaid, as asked, so there is nothing to cancel or close"],
      ["order-stay-started", "confirmed", `the stay has started; ${support}`],
      ["order-needs-attention", "needs attention from Fortrip", `Fortrip is looking into this order; ${support}`],
      ["order-terms-unknown", "confirmed", `its cancellation terms are not on record; ${support}`],
      ["order-confirming", "confirming with the hotel", "the booking is still being confirmed with the hotel; read the order again later"],
    ];
    for (const [name, status, why] of cases) {
      const text = render(load(name));
      const lines = text.split("\n");
      assert.ok(lines[0]!.includes(` · ${status} · created `), `${name}: ${lines[0]}`);
      assert.ok(lines.includes(`Cancel: not available: ${why}`), `${name}: ${text}`);
      for (const rule of [CANCEL_NEXT_STEP, ORDER_NEXT_STEP, PAY_NEXT_STEP]) assert.ok(!text.includes(rule), name);
      assert.doesNotMatch(text, /^Payment link|^Pay without the link/m, name);
    }
  });

  it("leaves CANCEL_NEXT_STEP out when no order can be cancelled now", () => {
    const fixture = copy(load("order-confirmed")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    data.cancel = blocked("stay_started");
    for (const tool of ["get_order", "cancel_order"] as const) {
      const text = renderToolResult(tool, data);
      assert.ok(!text.includes(CANCEL_NEXT_STEP), tool);
      assert.match(text, /^Cancel: not available: the stay has started/m, tool);
    }
    const list = copy(load("list-orders")) as ToolFixture;
    for (const o of list.data.data as Record<string, any>[]) {
      if (o.cancel.action === "cancel") o.cancel = blocked("stay_started");
    }
    assert.ok(!renderToolResult("list_orders", list.data).includes(CANCEL_NEXT_STEP));
  });

  it("cancel_order's answer of an order that is cancelling holds nothing a rule governs, and carries none", () => {
    const fixture = load("cancel-order") as ToolFixture;
    const text = render(fixture);
    assert.match(text.split("\n")[0]!, / · cancelling · /);
    assert.match(text, /^Cancel: not available: a cancellation is already under way; read the order again later$/m);
    assert.ok(!text.includes(CANCEL_NEXT_STEP));
    assert.ok(!text.includes(ORDER_NEXT_STEP));
  });

  // The rules follow what a text holds, not which of these two tools answered: a payment link
  // ends with the consent rule, a line to pay without it with the pay rule, and an order that
  // can be cancelled now with the cancel rule, as in a read of the same order.
  it("cancel_order and pay_order answers carry the rules of what they hold, as get_order does", () => {
    const cases: [string, Record<string, any>][] = [
      ["a payment link", unpaidOrder()],
      ["a payment link and a token request", withToken()],
      ["an order that can be cancelled", (load("order-confirmed") as ToolFixture).data as Record<string, any>],
      ["nothing a rule governs", (load("order-expired") as ToolFixture).data as Record<string, any>],
    ];
    for (const [what, data] of cases) {
      for (const surface of ["mcp", "cli"] as const) {
        const read = renderToolResult("get_order", data, surface);
        for (const tool of ["cancel_order", "pay_order"] as const) {
          assert.equal(renderToolResult(tool, data, surface), read, `${tool} (${surface}): ${what}`);
        }
      }
    }
    const rulesOf = (text: string) => [CANCEL_NEXT_STEP, ORDER_NEXT_STEP, PAY_NEXT_STEP].filter((rule) => text.includes(rule));
    assert.deepEqual(rulesOf(renderToolResult("cancel_order", cases[0]![1])), [ORDER_NEXT_STEP]);
    assert.deepEqual(rulesOf(renderToolResult("pay_order", cases[1]![1])), [ORDER_NEXT_STEP, PAY_NEXT_STEP]);
    assert.deepEqual(rulesOf(renderToolResult("cancel_order", cases[2]![1])), [CANCEL_NEXT_STEP]);
    assert.deepEqual(rulesOf(renderToolResult("pay_order", cases[3]![1])), []);
    // And when the answer does not parse, from what its JSON holds.
    const junk = { junk: 1, payment: { url: "https://fortrip.ai/pay/x", tokenRequest: { handler: {} } }, cancel: { action: "cancel" } };
    for (const tool of ["cancel_order", "pay_order"] as const) {
      assert.ok(renderToolResult(tool, junk).endsWith(`\n\n${CANCEL_NEXT_STEP}\n\n${ORDER_NEXT_STEP}\n\n${PAY_NEXT_STEP}`), tool);
    }
  });

  it("an unpaid order that can be closed says so, on its word only, and carries no cancel rule", () => {
    const data = unpaidOrder();
    assert.deepEqual(data.cancel, { action: "close", blockedBy: null, penalty: null, refund: null });
    strictOutput(outputOf("get_order")).parse(data);
    for (const surface of ["mcp", "cli"] as const) {
      const close = surface === "mcp" ? `call cancel_order { orderId: "${data.orderId}", close: true }` : `run \`fortrip orders cancel ${data.orderId} --close\``;
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

  it("the raw fallback carries the cancel rule only for an order that can be cancelled, not one that can be closed", () => {
    const close = { action: "close", blockedBy: null, penalty: null, refund: null };
    const text = renderToolResult("get_order", { cancel: close, junk: 1 });
    assert.match(text, /^This get_order result is not in the expected shape/);
    assert.ok(!text.includes(CANCEL_NEXT_STEP));
    assert.ok(!renderToolResult("get_order", { cancel: blocked("confirming"), junk: 1 }).includes(CANCEL_NEXT_STEP));
    const list = { data: [{ cancel: close }, { cancel: { ...close, action: "cancel" } }], junk: 1 };
    assert.equal(renderToolResult("list_orders", list).split(CANCEL_NEXT_STEP).length, 2);
  });

  it("an unpaid order that can't be closed says which: on the website's checkout, or a payment under way", () => {
    assert.match(
      render(load("order-website-checkout")),
      /^Cancel: not available: it was started on the Fortrip website and isn't paid; it expires unpaid unless the user pays there$/m,
    );
    const data = unpaidOrder();
    data.cancel = blocked("payment_in_progress");
    for (const surface of ["mcp", "cli"] as const) {
      const text = renderToolResult("get_order", data, surface);
      assert.match(text, /^Cancel: not available: a payment is under way; read the order again shortly$/m, surface);
      assert.doesNotMatch(text, /expires unpaid/, surface);
    }
  });

  // One status each for the two ways an unpaid order ends: its time ran out, or the caller closed it.
  it("words every order status, each its own: an expired order is not a closed one", () => {
    assert.deepEqual([...ORDER_STATUSES], ["awaiting_payment", "expired", "closed", "confirming", "confirmed", "failed", "cancelling", "cancelled", "needs_attention"]);
    const head = (status: string) => {
      const data = copy((load("order-expired") as ToolFixture).data) as Record<string, any>;
      data.status = status;
      return renderOrder(data as Order).split("\n")[0]!.split(" · ")[2]!;
    };
    assert.equal(new Set(ORDER_STATUSES.map(head)).size, ORDER_STATUSES.length);
    for (const status of ORDER_STATUSES) assert.notEqual(head(status), "status not recognized", status);
    assert.equal(head("expired"), "not paid: the time to pay ran out");
    assert.equal(head("closed"), "closed unpaid, as asked");
    assert.equal(head("teleported"), "teleported");
    // The fixtures say each in both places: the status, and what blocks a cancellation.
    for (const way of ["expired", "closed"] as const) {
      const data = (load(`order-${way}`) as ToolFixture).data as Record<string, any>;
      assert.deepEqual([data.status, data.cancel.blockedBy], [way, way]);
    }
  });

  it("words everything that blocks a cancellation, one situation each, and shows an unknown one as it came", () => {
    const fixture = copy(load("order-confirmed")) as ToolFixture;
    const data = fixture.data as Record<string, any>;
    const lines = new Set<string>();
    for (const blockedBy of CANCEL_BLOCKERS) {
      data.cancel = blocked(blockedBy);
      strictOutput(outputOf("get_order")).parse(data);
      const line = renderToolResult("get_order", data).split("\n").find((l) => l.startsWith("Cancel: "));
      assert.ok(line, blockedBy);
      assert.notEqual(line, `Cancel: not available: ${blockedBy}`, `${blockedBy} is worded`);
      lines.add(line);
    }
    assert.equal(lines.size, CANCEL_BLOCKERS.length);
    const line = (blockedBy: string) => {
      data.cancel = blocked(blockedBy);
      return renderToolResult("get_order", data).split("\n").find((l) => l.startsWith("Cancel: "));
    };
    // No cancellation at all, which is not a cancellation that keeps the whole total.
    assert.equal(
      line("cancellation_not_allowed"),
      "Cancel: not available: the hotel takes no cancellation for this order, even one that keeps the whole total; the booking stands",
    );
    // A sound booking only support can cancel is not an order Fortrip is looking into.
    assert.equal(
      line("support_only"),
      "Cancel: not available: the booking stands, and it can't be cancelled here; to cancel it, the user emails info@fortrip.ai with the order's reference",
    );
    assert.equal(
      line("needs_attention"),
      "Cancel: not available: Fortrip is looking into this order; for help, the user emails info@fortrip.ai with the order's reference",
    );
    assert.equal(line("cancellation_refused"), "Cancel: not available: the hotel refused the cancellation; the booking stands");
    assert.equal(
      line("confirming"),
      "Cancel: not available: the booking is still being confirmed with the hotel; read the order again later",
    );
    assert.equal(line("teleported"), "Cancel: not available: teleported");
    assertClean(renderToolResult("get_order", data));
    // An action this contract doesn't know is shown as it came, with no rule of ours.
    data.cancel = { action: "amend", blockedBy: null, penalty: null, refund: null };
    const text = renderToolResult("get_order", data);
    assert.match(text, /^Cancel: amend$/m);
    assert.ok(!text.includes(CANCEL_NEXT_STEP));
  });

  it("the raw fallback adds the pay rule for an order that holds a token", () => {
    const text = renderToolResult("get_order", { payment: { tokenRequest: { handler: {} } }, junk: 1 });
    assert.match(text, /^This get_order result is not in the expected shape/);
    assert.ok(text.endsWith(`\n\n${PAY_NEXT_STEP}`));
    const list = renderToolResult("list_orders", { data: [{ payment: { tokenRequest: null } }, { payment: { tokenRequest: {} } }] });
    assert.equal(list.split(PAY_NEXT_STEP).length, 2);
    // No token, or none at all: no rule.
    for (const payment of [{ tokenRequest: null }, {}, { tokenRequest: "spt_1" }, { token: {} }]) {
      assert.ok(!renderToolResult("get_order", { payment, junk: 1 }).includes(PAY_NEXT_STEP), JSON.stringify(payment));
    }
    // Whatever the tool: pay_order's own answer too.
    assert.ok(renderToolResult("pay_order", { payment: { tokenRequest: {} }, junk: 1 }).endsWith(`\n\n${PAY_NEXT_STEP}`));
  });

  // In the JSON a result falls back to, a link is a non-empty string: an empty one is no link
  // to give, and carries no rule about giving it.
  it("the raw fallback takes only a non-empty payment.url for a link", () => {
    for (const tool of ["create_order", "get_order", "cancel_order", "pay_order"] as const) {
      for (const url of ["", null, 7, {}, undefined]) {
        assert.ok(!renderToolResult(tool, { junk: 1, payment: { url } }).includes(ORDER_NEXT_STEP), `${tool} ${JSON.stringify(url)}`);
      }
      assert.ok(renderToolResult(tool, { junk: 1, payment: { url: "https://fortrip.ai/pay/x" } }).endsWith(`\n\n${ORDER_NEXT_STEP}`), tool);
    }
    const page = { data: [{ junk: 1, payment: { url: "" } }, { junk: 2, payment: { url: "" } }], nextCursor: null };
    assert.ok(!renderToolResult("list_orders", page).includes(ORDER_NEXT_STEP));
    page.data[1]!.payment.url = "https://fortrip.ai/pay/x";
    assert.ok(renderToolResult("list_orders", page).endsWith(`\n\n${ORDER_NEXT_STEP}`));
  });

  it("an order with a token shows how to pay without the link, Stripe's usage limits by name, and the pay rule", () => {
    const data = withToken();
    data.payment.tokenRequest.handler.available_instruments.push({
      type: "link",
      config: { business_profile: "profile_test_1" },
    });
    strictOutput(outputOf("get_order")).parse(data);
    for (const tool of ["create_order", "get_order", "pay_order"] as const) {
      const text = renderToolResult(tool, data);
      assert.ok(
        text
          .split("\n")
          .includes(
            'Pay without the link: call pay_order { orderId: "ord_BundAwaiting00000000", sharedPaymentToken: "<spt_…>", total: { amount: "365.00", currency: "USD" } } with a shared payment token via com.stripe.payments (handler stripe_payments, business_profile profile_test_1); usage limits for the token request: max_amount 36500 (cents), currency usd, expires_at 1793537400 (2026-11-01 12:50 UTC).',
          ),
        `${tool}: ${text}`,
      );
      // Every result that shows the line carries its rule, pay_order's own answer too.
      assert.equal(text.split(PAY_NEXT_STEP).length, 2, tool);
      assert.ok(text.endsWith(`\n\n${ORDER_NEXT_STEP}\n\n${PAY_NEXT_STEP}`), tool);
      assertClean(text);
    }
    // The instant in parentheses is the expires_at above it, read as Unix seconds.
    data.payment.tokenRequest.usageLimits.expires_at = 1793537400 + 3600;
    assert.match(renderToolResult("get_order", data), /expires_at 1793541000 \(2026-11-01 13:50 UTC\)\.$/m);
    assert.match(render(load("order-payable-by-token")), /max_amount 36500 \(cents\), currency usd, expires_at 1793537400 \(2026-11-01 12:50 UTC\)\.$/m);
    // max_amount is in the currency's minor unit: cents is said of usd only.
    data.payment.tokenRequest.usageLimits.currency = "eur";
    assert.match(renderToolResult("get_order", data), /max_amount 36500 \(the currency's minor unit\), currency eur, expires_at /);
    assert.match(PAY_NEXT_STEP, /^To pay without the link: only if you have a tool that can request a Stripe shared payment token /);
    assert.match(PAY_NEXT_STEP, /never ask the user to create, type or paste a token\. Before you call pay_order, show the user the order's total and currency, the stay \(hotel, room, dates, and each room's party and guest names\), the contact \(name, email, phone\), any special requests and every term \(meals, cancellation, fees payable at the property\), then end your reply by asking them to confirm, and wait for a clear yes\./);
    assert.match(PAY_NEXT_STEP, /Pay one way only: either give the payment link or call pay_order\./);
    // The paragraph names what the order's text shows: the line, and Stripe's
    // own names on it, which go into the token request as they are.
    assert.match(PAY_NEXT_STEP, /and the order's text has a "Pay without the link" line\. Otherwise give the payment link,/);
    assert.match(PAY_NEXT_STEP, /with the business_profile and the usage limits on that line \(max_amount in cents, currency, expires_at\), and make the pay_order call that line gives, exactly as shown, with the token in place of <spt_…>: its total is the order's Total, never a figure from anywhere else\./);
    assert.match(PAY_NEXT_STEP, /Once pay_order succeeds, the payment link stops working; a failed payment leaves it open\.$/);
    assert.doesNotMatch(PAY_NEXT_STEP, /method|Alipay|WeChat/i);
    // An order with no token: the link alone, and only its rule.
    const unpayable = load("order-awaiting-payment") as ToolFixture;
    assert.equal((unpayable.data as Record<string, any>).payment.tokenRequest, null);
    for (const tool of ["create_order", "get_order", "list_orders"] as const) {
      const data = tool === "list_orders" ? { data: [unpayable.data], nextCursor: null } : unpayable.data;
      const plain = renderToolResult(tool, data);
      assert.doesNotMatch(plain, /^Pay without the link/m, tool);
      assert.ok(!plain.includes(PAY_NEXT_STEP), tool);
      assert.ok(plain.endsWith(`\n\n${ORDER_NEXT_STEP}`), tool);
    }
  });

  // expires_at is Unix seconds. The schema refuses a value that can't be (so the order shows as
  // JSON); the line itself, given one, prints the number and no instant read from it.
  it("the instant beside expires_at is printed only for a plausible Unix-seconds value", () => {
    const tokenLine = (expires_at: number, through: (data: Record<string, any>) => string) => {
      const data = withToken();
      data.payment.tokenRequest.usageLimits.expires_at = expires_at;
      return through(data).split("\n").find((l) => l.startsWith("Pay without the link: ")) ?? through(data);
    };
    const parsed = (data: Record<string, any>) => renderToolResult("get_order", data);
    const direct = (data: Record<string, any>) => renderOrder(data as Order);
    // A past value is still an instant.
    for (const through of [parsed, direct]) {
      assert.match(tokenLine(1_600_000_000, through), /expires_at 1600000000 \(2020-09-13 12:26 UTC\)\.$/);
      assert.match(tokenLine(1_000_000_000, through), /expires_at 1000000000 \(2001-09-09 01:46 UTC\)\.$/);
      assert.match(tokenLine(9_999_999_999, through), /expires_at 9999999999 \(2286-11-20 17:46 UTC\)\.$/);
    }
    // Zero, milliseconds, a value no date can hold, and no number at all.
    for (const bad of [0, 999_999_999, 10_000_000_000, 1793537400000, 8.7e15, 1e21, Number.NaN, Number.POSITIVE_INFINITY, 1793537400.5]) {
      // Read through the schema, such a token request is read as none: the order stands, with its link.
      assert.doesNotMatch(tokenLine(bad, parsed), /Pay without the link|not in the expected shape/, String(bad));
      assert.match(tokenLine(bad, parsed), /^Payment link \(/m, String(bad));
      const line = tokenLine(bad, direct);
      assert.ok(line.endsWith(`, expires_at ${bad}.`), `${bad}: ${line}`);
      assert.doesNotMatch(line, /UTC|Invalid/, String(bad));
    }
  });

  it("no order text names Alipay, WeChat Pay or a wallet payment", () => {
    for (const name of GOLDENS.filter((g) => g.startsWith("order-") || g === "list-orders" || g === "cancel-order")) {
      assert.doesNotMatch(render(load(name)).replace(PAY_NEXT_STEP, ""), /Alipay|WeChat|wallet|stripe_alipay/i, name);
    }
  });

  it("leaves ORDER_NEXT_STEP out when the order has no payment link", () => {
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

  // An item of a type this build does not know is one line, and the order around it is whole.
  it("an item of an unknown type is one line of the order, which is shown in full around it", () => {
    for (const surface of ["mcp", "cli"] as const) {
      const whole = renderToolResult("get_order", (load("order-confirmed") as ToolFixture).data, surface).split("\n");
      const car = { type: "car", car: { model: "x", pickUp: "PVG" } };
      const line = `Item of type car: not shown in this text. ${JSON.stringify(car)}`;
      const added = copy((load("order-confirmed") as ToolFixture).data) as Record<string, any>;
      added.items.push(car);
      const text = renderToolResult("get_order", added, surface).split("\n");
      assert.deepEqual(text.filter((l) => l !== line), whole);
      assert.equal(text.indexOf(line), whole.findIndex((l) => l.startsWith("Contact: ")));
      // An order of that item alone still has every line of its own.
      const only = copy((load("order-confirmed") as ToolFixture).data) as Record<string, any>;
      only.items = [car];
      const alone = renderToolResult("get_order", only, surface).split("\n");
      assert.deepEqual(alone.slice(0, 2), [whole[0], line]);
      assert.deepEqual(alone.slice(2), whole.slice(whole.findIndex((l) => l.startsWith("Contact: "))));
    }
  });

  /*
   * What an order holds beside its stay (what a cancellation kept, why it failed, what a token
   * is requested with) is read on its own: a part that does not parse is read as not there, and
   * the order is shown in full, never as one line of JSON.
   */
  describe("an optional part of an order that does not parse is read as absent, the order in full", () => {
    const TOOLS_OF_ONE = ["create_order", "get_order", "cancel_order", "pay_order"] as const;

    function assertReadAs(name: Golden, change: (order: Record<string, any>) => void, absent: (order: Record<string, any>) => void) {
      for (const surface of ["mcp", "cli"] as const) {
        const broken = copy((load(name) as ToolFixture).data) as Record<string, any>;
        change(broken);
        const expected = copy((load(name) as ToolFixture).data) as Record<string, any>;
        absent(expected);
        strictOutput(outputOf("get_order")).parse(expected);
        for (const tool of TOOLS_OF_ONE) {
          const text = renderToolResult(tool, broken, surface);
          assert.doesNotMatch(text, /not in the expected shape/, `${name} ${tool}`);
          assert.equal(text, renderToolResult(tool, expected, surface), `${name} ${tool}`);
        }
        // In a list too: the order is one of the page's, not its one line of JSON.
        const page = { data: [(load("order-confirmed") as ToolFixture).data, broken], nextCursor: null };
        const text = renderToolResult("list_orders", page, surface);
        assert.doesNotMatch(text, /not in the expected shape/, name);
        assert.equal(text, renderToolResult("list_orders", { ...page, data: [page.data[0], expected] }, surface), name);
      }
    }

    it("what a cancellation kept: the figures are then not on record", () => {
      for (const cancelled of [
        { at: "yesterday", penalty: { amount: "120.00", currency: "USD" }, refund: { amount: "246.00", currency: "USD" } },
        { at: "2026-11-03T10:00:00Z", penalty: "120.00", refund: "246.00" },
        { at: "2026-11-03T10:00:00Z", penalty: { amount: 120, currency: "USD" }, refund: null },
        "kept 120.00",
        7,
      ]) {
        assertReadAs("order-cancelled", (o) => (o.cancelled = cancelled), (o) => (o.cancelled = null));
      }
      const text = renderToolResult("get_order", { ...(load("order-cancelled") as ToolFixture).data, cancelled: 7 });
      assert.match(text, /^Cancelled: the penalty kept and the refund are not on record$/m);
      assert.match(text, /^Order ord_/);
      // On an order that is not cancelled, they are nothing at all.
      assertReadAs("order-confirmed", (o) => (o.cancelled = { at: 1 }), () => {});
    });

    it("why an order failed: the reason is then unknown, and on an order that did not fail there is none", () => {
      for (const failure of ["sold out", { reason: 5 }, { why: "rate_unavailable" }, [], 0]) {
        assertReadAs("order-failed", (o) => (o.failure = failure), (o) => (o.failure = { reason: "unknown" }));
        assertReadAs("order-confirmed", (o) => (o.failure = failure), () => {});
      }
      const text = renderToolResult("get_order", { ...(load("order-failed") as ToolFixture).data, failure: "sold out" });
      assert.match(text, /^Why it failed: the reason is not on record; /m);
    });

    it("what a token is requested with: the order then takes none, and is paid by its link", () => {
      const request = () => copy((load("order-payable-by-token") as ToolFixture).data as Record<string, any>).payment.tokenRequest;
      for (const token of [
        { ...request(), usageLimits: { max_amount: "36500", currency: "usd", expires_at: 1793537400 } },
        { ...request(), usageLimits: { ...request().usageLimits, expires_at: 1793537400000 } },
        { ...request(), handler: "com.stripe.payments" },
        { usageLimits: request().usageLimits },
        "spt",
        true,
      ]) {
        assertReadAs("order-payable-by-token", (o) => (o.payment.tokenRequest = token), (o) => (o.payment.tokenRequest = null));
      }
      const data = copy((load("order-payable-by-token") as ToolFixture).data) as Record<string, any>;
      data.payment.tokenRequest = true;
      const text = renderToolResult("get_order", data);
      // No line to pay without the link, and no rule for it: the link, and its rule, stand.
      assert.doesNotMatch(text, /Pay without the link|pay_order/);
      assert.match(text, /^Payment link \(/m);
      assert.ok(text.endsWith(`\n\n${ORDER_NEXT_STEP}`));
    });

    it("what the order itself is made of is not optional: an order without it is still JSON", () => {
      for (const change of [
        (o: Record<string, any>) => (o.total = "365.00"),
        (o: Record<string, any>) => (o.cancel = { action: "cancel" }),
        (o: Record<string, any>) => (o.payment = "unpaid"),
        (o: Record<string, any>) => (o.items[0].hotel.checkIn = "tomorrow"),
        // A failed order that says nothing of why: there is no part to read around.
        (o: Record<string, any>) => Object.assign(o, { status: "failed", failure: null }),
      ]) {
        const data = copy((load("order-confirmed") as ToolFixture).data) as Record<string, any>;
        change(data);
        assert.match(renderToolResult("get_order", data), /^This get_order result is not in the expected shape; as JSON: /);
      }
    });
  });
});

describe("renderToolResult on malformed data", () => {
  it("never throws, and shows the raw value", () => {
    for (const tool of ["search_hotels", "get_hotel", "get_hotel_offers", "create_order", "get_order", "list_orders", "cancel_order"] as const) {
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
    for (const tool of ["create_order", "get_order"] as const) {
      const text = renderToolResult(tool, order.data);
      assert.match(text, /not in the expected shape/);
      assert.ok(text.includes("https://fortrip.ai/pay/ord_BundAwaiting00000000?s=cs_test_a1B2c3D4"));
      assert.ok(text.endsWith(`\n\n${ORDER_NEXT_STEP}`), tool);
    }
    const list = copy(load("list-orders")) as ToolFixture;
    (list.data.data as Record<string, any>[])[3]!.createdAt = "yesterday";
    assert.ok(
      renderToolResult("list_orders", list.data).endsWith(`\n\n${CANCEL_NEXT_STEP}\n\n${ORDER_NEXT_STEP}`),
    );
  });

  it("keeps the cancel rule when a cancellable order does not parse, for every tool but create_order", () => {
    const order = copy(load("order-confirmed")) as ToolFixture;
    (order.data as Record<string, any>).createdAt = "yesterday";
    const text = renderToolResult("get_order", order.data);
    assert.match(text, /not in the expected shape/);
    assert.ok(text.endsWith(`\n\n${CANCEL_NEXT_STEP}`));
    // A cancellation's own answer and a payment's carry it as a read does; a create_order answer does not.
    for (const tool of ["cancel_order", "pay_order"] as const) {
      assert.ok(renderToolResult(tool, order.data).endsWith(`\n\n${CANCEL_NEXT_STEP}`), tool);
    }
    assert.ok(!renderToolResult("create_order", order.data).includes(CANCEL_NEXT_STEP));
    (order.data as Record<string, any>).cancel = blocked("stay_started");
    assert.ok(!renderToolResult("get_order", order.data).includes(CANCEL_NEXT_STEP));
  });

  // One order of a page that this build can't read must not cost the page: the others are shown
  // in full, the one as JSON on one line under our words, and the rules follow as they would.
  it("a list degrades per order: the others render in full, the unreadable one as one line of JSON", () => {
    const page = (change: (orders: Record<string, any>[]) => void) => {
      const list = copy((load("list-orders") as ToolFixture).data) as { data: Record<string, any>[]; nextCursor: string };
      change(list.data);
      return list;
    };
    const whole = renderToolResult("list_orders", page(() => {}));
    // An action this build does not know, with figures: the order reads, and so does its page.
    const amended = page((orders) => {
      orders[3]!.cancel = { action: "amend", blockedBy: null, penalty: orders[3]!.cancel.penalty, refund: orders[3]!.cancel.refund };
    });
    const later = renderToolResult("list_orders", amended);
    assert.doesNotMatch(later, /not in the expected shape/);
    assert.equal(later.split("\n").filter((l) => l.startsWith("Order ord_")).length, 4);
    assert.ok(later.split("\n").includes("Cancel: amend"));
    assert.ok(!later.includes(CANCEL_NEXT_STEP));
    assert.match(renderToolResult("get_order", amended.data[3]), /^Cancel: amend$/m);
    // One order that does not parse: a failed order that does not say why.
    for (const surface of ["mcp", "cli"] as const) {
      for (const at of [0, 1, 2, 3]) {
        const list = page((orders) => {
          orders[at] = { ...orders[at]!, status: "failed", failure: null };
        });
        const text = renderToolResult("list_orders", list, surface);
        const lines = text.split("\n");
        assert.equal(lines[0], "Orders, newest first: 4 on this page.");
        const bad = lines.filter((l) => l.startsWith("This order is not in the expected shape; as JSON: "));
        assert.equal(bad.length, 1, text);
        assert.equal(bad[0], `This order is not in the expected shape; as JSON: ${JSON.stringify(list.data[at])}`);
        assert.doesNotMatch(text, /^This (?:list_orders|fortrip orders list) result is not in the expected shape/m);
        // Every other order is there whole, line for line as in the page that reads.
        const full = renderToolResult("list_orders", page(() => {}), surface).split("\n\n");
        const blocks = text.split("\n\n");
        assert.equal(blocks.length, full.length, text);
        blocks.forEach((block, i) => {
          if (i === at + 1) assert.equal(block, bad[0]);
          else assert.equal(block, full[i], `order ${i - 1}`);
        });
      }
    }
    assert.ok(whole.endsWith(`\n\n${CANCEL_NEXT_STEP}\n\n${ORDER_NEXT_STEP}`));
    // The rules look at the unreadable order too: its link and its cancellation are in the JSON.
    const onlyBad = page((orders) => {
      orders.splice(0, 2);
      orders[0] = { ...orders[0]!, createdAt: "yesterday" };
      orders[1] = { ...orders[1]!, createdAt: "yesterday" };
    });
    const text = renderToolResult("list_orders", onlyBad);
    assert.equal(text.split("\n").filter((l) => l.startsWith("This order is not in the expected shape; as JSON: ")).length, 2);
    assert.ok(text.endsWith(`\n\nNext page: call again with { cursor: "c_orders_page_2" }.\n\n${CANCEL_NEXT_STEP}\n\n${ORDER_NEXT_STEP}`), text);
    // A page that is no page is still shown whole, as JSON.
    for (const broken of [{ data: "nope", nextCursor: null }, { data: [], nextCursor: 7 }, { nextCursor: null }]) {
      assert.match(renderToolResult("list_orders", broken), /^This list_orders result is not in the expected shape; as JSON: /);
    }
  });

  // A replayed create_order can answer an order paid and confirmed meanwhile: its Cancel line
  // says what cancelling keeps, and the cancel rule stays with the reads.
  it("a create_order answer that holds a confirmed order carries no cancel rule", () => {
    const confirmed = (load("order-confirmed") as ToolFixture).data;
    const text = renderToolResult("create_order", confirmed);
    assert.match(text, /^Cancel: can cancel now: penalty USD 120\.00, refund USD 246\.00 /m);
    assert.ok(!text.includes(CANCEL_NEXT_STEP));
    assert.ok(renderToolResult("get_order", confirmed).endsWith(`\n\n${CANCEL_NEXT_STEP}`));
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
    /\b(search_hotels|get_hotel|get_hotel_offers|create_order|get_order|list_orders|cancel_order|pay_order|maximumPenalty|sharedPaymentToken|radiusMeters|limitPerHotel|requireBreakfast|place_name)\b|\{ (cursor|kind|amount):|close: true/;

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
      const text = cli(load(name));
      assert.doesNotMatch(text, MCP_ONLY, name);
      // How to present hotels is the skill's on the CLI, not the text's.
      assert.ok(!text.includes(PRESENTATION_HINT), name);
      assertClean(text);
    }
    for (const tool of ["create_order", "get_order", "list_orders"] as const) {
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
    assert.match(payNextStep("cli"), /and run the command that line gives, exactly as shown, with the token in place of <spt_…>: its --total is the order's total, never a figure from anywhere else\./);
    assert.doesNotMatch(payNextStep("cli"), /<orderId>|<total>/);
    assert.notEqual(payNextStep("cli"), PAY_NEXT_STEP);
    assert.equal(payNextStep("mcp"), PAY_NEXT_STEP);
  });

  it("the cancel rule runs fortrip orders cancel with --max-penalty", () => {
    const text = cli(load("order-confirmed"));
    assert.ok(text.endsWith(`\n\n${cancelNextStep("cli")}`));
    // The rule names the command, never an order or an amount: those are on the Cancel line alone.
    assert.match(cancelNextStep("cli"), /^Before you run `fortrip orders cancel` with --max-penalty, show the user/);
    assert.doesNotMatch(cancelNextStep("cli"), /<orderId>|<amount>/);
    assert.ok(cancelNextStep("cli").includes("Then run the command that Cancel line gives, exactly as shown: its --max-penalty is the amount of the penalty on that line, never a figure from anywhere else."));
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
    assert.match(error("payment_declined", { declineCode: null }), /the user picks another card in their Link wallet for a new token, or pays by link: read the order with `fortrip orders get <orderId>` and give its payment link\./);
    assert.match(
      error("payment_total_mismatch", { orderId: order, total: { amount: "365.00", currency: "USD" } }),
      new RegExp(`Confirm this total with the user, then run the same \`fortrip orders pay ${order}\` command again with \`--total 365\\.00\`\\. Nothing was charged\\.`),
    );
    assert.match(error("payment_method_unavailable", { reason: "token_not_offered" }), /Read the order with `fortrip orders get <orderId>`\. This call charged nothing\./);
  });

  it("offers cut by the limit name the CLI's flags", () => {
    const fixture = copy(load("offers-two-hotels-one-unavailable")) as ToolFixture;
    const hotels = fixture.data.hotels as Record<string, any>[];
    hotels[0]!.omitted.byLimit = 3;
    const text = renderToolResult("get_hotel_offers", fixture.data, "cli");
    assert.match(text, /not shown: no --limit-per-hotel was given, .* a filtered request \(--require-breakfast \/ --require-free-cancellation\)/);
    assert.doesNotMatch(text, /limitPerHotel|requireBreakfast/);
  });
});

/*
 * The rules that end an order's text. A result that holds a payment link
 * ends with the consent rule; when an order also has a "Pay without the
 * link" line, the pay rule follows it and repeats it, as the evals pinned.
 * The cancel rule comes before both, never after: the last thing a model
 * reads before it answers is the rule about the link it could give away.
 */
describe("the order of the rules that end an order's text", () => {
  const SURFACES = ["mcp", "cli"] as const;
  const text = (fixture: Fixture, surface: "mcp" | "cli") =>
    "tool" in fixture
      ? renderToolResult(fixture.tool, fixture.data, surface)
      : renderError(fixture.envelope, fixture.status, surface);

  /** The paragraphs after the data: the blocks from the first rule on. */
  function rules(result: string, surface: "mcp" | "cli"): string[] {
    const known = [cancelNextStep(surface), ORDER_NEXT_STEP, payNextStep(surface)];
    return result.split("\n\n").filter((block) => known.includes(block));
  }

  it("every fixture that holds a payment link ends with the consent rule, only the pay rule that repeats it after", () => {
    const holding: string[] = [];
    for (const name of GOLDENS) {
      for (const surface of SURFACES) {
        const result = text(load(name), surface);
        if (!/^Payment link \(/m.test(result)) {
          assert.ok(!result.includes(ORDER_NEXT_STEP), `${name} (${surface}) has no link and the consent rule`);
          continue;
        }
        holding.push(name);
        const payable = /^Pay without the link: /m.test(result);
        const expected = [ORDER_NEXT_STEP, ...(payable ? [payNextStep(surface)] : [])];
        const found = rules(result, surface);
        assert.deepEqual(found.slice(-expected.length), expected, `${name} (${surface})`);
        assert.ok(result.endsWith(`\n\n${expected.join("\n\n")}`), `${name} (${surface})`);
        // Whatever comes before the consent rule is the cancel rule, once.
        assert.deepEqual(
          found.slice(0, -expected.length).filter((rule) => rule !== cancelNextStep(surface)),
          [],
          `${name} (${surface})`,
        );
      }
    }
    // An order awaiting payment, one payable by token, one from the website, and a page of orders.
    assert.deepEqual([...new Set(holding)].sort(), ["list-orders", "order-awaiting-payment", "order-payable-by-token", "order-website-checkout"]);
  });

  it("a page with an order to pay and an order to cancel: the cancel rule, the consent rule, the pay rule", () => {
    const confirmed = (load("order-confirmed") as ToolFixture).data;
    for (const surface of SURFACES) {
      const page = renderToolResult("list_orders", { data: [withToken(), confirmed], nextCursor: null }, surface);
      assert.deepEqual(rules(page, surface), [cancelNextStep(surface), ORDER_NEXT_STEP, payNextStep(surface)], surface);
      assert.ok(page.endsWith(`\n\n${cancelNextStep(surface)}\n\n${ORDER_NEXT_STEP}\n\n${payNextStep(surface)}`), surface);
      // No token: the consent rule is the last paragraph.
      const plain = renderToolResult("list_orders", { data: [unpaidOrder(), confirmed], nextCursor: null }, surface);
      assert.ok(plain.endsWith(`\n\n${cancelNextStep(surface)}\n\n${ORDER_NEXT_STEP}`), surface);
    }
    // The golden page holds both: an order with a link, and one that can be cancelled.
    assert.ok(render(load("list-orders")).endsWith(`\n\n${CANCEL_NEXT_STEP}\n\n${ORDER_NEXT_STEP}`));
  });

  it("a result that does not parse keeps the same order", () => {
    const junk = {
      junk: 1,
      payment: { url: "https://fortrip.ai/pay/x", tokenRequest: { handler: {} } },
      cancel: { action: "cancel" },
    };
    for (const surface of SURFACES) {
      const result = renderToolResult("get_order", junk, surface);
      assert.match(result, /result is not in the expected shape; as JSON: /);
      assert.ok(result.endsWith(`\n\n${cancelNextStep(surface)}\n\n${ORDER_NEXT_STEP}\n\n${payNextStep(surface)}`), surface);
    }
  });
});

/*
 * The cancel rule carries no figure of its own. An example penalty in it
 * ("USD 120.00") stood next to the order's own, and a model could pass the
 * example. It points at the order's Cancel line, which gives the call with
 * the order's penalty in it.
 */
describe("the cancel rule names the order's own penalty, never an example", () => {
  it("has no figure in it, and points at the call on the Cancel line", () => {
    assert.doesNotMatch(cancelNextStep("mcp"), /\d/);
    assert.doesNotMatch(cancelNextStep("cli"), /\d/);
    assert.ok(
      cancelNextStep("mcp").includes(
        " Then make the call that Cancel line gives, exactly as shown: its maximumPenalty is the penalty on that line, never a figure from anywhere else. ",
      ),
    );
    assert.ok(
      cancelNextStep("cli").includes(
        " Then run the command that Cancel line gives, exactly as shown: its --max-penalty is the amount of the penalty on that line, never a figure from anywhere else. ",
      ),
    );
  });

  it("every result with the rule shows the call on a Cancel line, and no penalty but the orders' own", () => {
    let withRule = 0;
    for (const name of GOLDENS) {
      const fixture = load(name);
      if (!("tool" in fixture)) continue;
      for (const surface of ["mcp", "cli"] as const) {
        const result = renderToolResult(fixture.tool, fixture.data, surface);
        if (!result.includes(cancelNextStep(surface))) continue;
        withRule++;
        const call = surface === "mcp" ? /^Cancel: can cancel now: .* \(only after the user's yes: call cancel_order \{ orderId: "ord_[0-9A-Za-z]{20}", maximumPenalty: \{ amount: "[\d.]+", currency: "[A-Z]{3}" \} \}\)$/m : /^Cancel: can cancel now: .* \(only after the user's yes: run `fortrip orders cancel ord_[0-9A-Za-z]{20} --max-penalty [\d.]+`\)$/m;
        assert.match(result, call, `${name} (${surface})`);
        // Every amount in the text is one the data holds.
        const held = new Set(stringsAt(fixture.data, "amount"));
        for (const [, amount] of result.matchAll(/\b(?:USD|EUR|CNY) (\d+\.\d{2})\b/g)) assert.ok(held.has(amount!), `${name} (${surface}): ${amount}`);
        for (const [, amount] of result.matchAll(/(?:amount: "|--max-penalty )(\d+\.\d{2})/g)) assert.ok(held.has(amount!), `${name} (${surface}): ${amount}`);
      }
    }
    assert.ok(withRule >= 8, String(withRule));
  });

  it("a page whose order has another penalty shows that one alone", () => {
    const page = load("list-orders") as ToolFixture;
    const confirmed = (page.data.data as Record<string, any>[]).find((o) => o.cancel.action === "cancel")!;
    assert.deepEqual(confirmed.cancel.penalty, { amount: "91.50", currency: "USD" });
    for (const surface of ["mcp", "cli"] as const) {
      const result = renderToolResult("list_orders", page.data, surface);
      assert.ok(!result.includes("120.00"), surface);
      assert.match(result, /^Cancel: can cancel now: penalty USD 91\.50, refund USD 274\.50 \(only after the user's yes: /m, surface);
    }
    assert.ok(render(page).includes('call cancel_order { orderId: "ord_LakeConfirmed0000000", maximumPenalty: { amount: "91.50", currency: "USD" } })'));
    assert.ok(renderToolResult("list_orders", page.data, "cli").includes("run `fortrip orders cancel ord_LakeConfirmed0000000 --max-penalty 91.50`)"));
  });

  it("order_not_cancellable prints the Cancel line of the order it is about, with its own call and its own id", () => {
    const orderId = "ord_KataNoLink0000000000";
    const refusal = (cancel: unknown, surface: "mcp" | "cli") => {
      const envelope = { error: { code: "order_not_cancellable", message: "m", retryable: false, requestId: "req_1", details: { orderId, cancel } } };
      strictOutput(errorEnvelope).parse(envelope);
      return renderError(envelope, 409, surface);
    };
    const cancel = { action: "cancel", blockedBy: null, penalty: { amount: "91.50", currency: "USD" }, refund: { amount: "274.50", currency: "USD" } };
    const mcp = refusal(cancel, "mcp").split("\n");
    assert.ok(mcp.includes("This order is paid, so it is cancelled under its terms, not closed. Its Cancel line now:"), mcp.join("\n"));
    assert.ok(mcp.includes(`Cancel: can cancel now: penalty USD 91.50, refund USD 274.50 (only after the user's yes: call cancel_order { orderId: "${orderId}", maximumPenalty: { amount: "91.50", currency: "USD" } })`), mcp.join("\n"));
    // The rule after the line it names.
    assert.equal(mcp.indexOf(CANCEL_NEXT_STEP), mcp.findIndex((line) => line.startsWith("Cancel: ")) + 1);
    const cli = refusal(cancel, "cli").split("\n");
    // The error names its order, so the command is the one to run: no placeholder.
    assert.ok(cli.includes(`Cancel: can cancel now: penalty USD 91.50, refund USD 274.50 (only after the user's yes: run \`fortrip orders cancel ${orderId} --max-penalty 91.50\`)`), cli.join("\n"));
    for (const lines of [mcp, cli]) assert.ok(!lines.join("\n").includes("120.00"));
    // An unpaid order: its Cancel line too, and no cancel rule.
    const close = { action: "close", blockedBy: null, penalty: null, refund: null };
    assert.ok(refusal(close, "mcp").split("\n").includes(`Cancel: can be closed now, nothing is charged; close it only if the user says they no longer want it (call cancel_order { orderId: "${orderId}", close: true })`));
    assert.ok(refusal(close, "cli").split("\n").includes(`Cancel: can be closed now, nothing is charged; close it only if the user says they no longer want it (run \`fortrip orders cancel ${orderId} --close\`)`));
    for (const surface of ["mcp", "cli"] as const) {
      for (const state of [cancel, close]) assert.doesNotMatch(refusal(state, surface).split("\n").find((l) => l.startsWith("Cancel: "))!, /<orderId>/);
    }
    // The error says which order it is about: without it, it is not this error.
    assert.equal(strictOutput(errorEnvelope).safeParse({ error: { code: "order_not_cancellable", message: "m", retryable: false, requestId: "req_1", details: { cancel } } }).success, false);
  });

  /*
   * Every call an order's text gives is the whole call: the tool and its arguments with the
   * order's own id, penalty and total in them, so that it can be made as it stands and, on a page
   * of orders, cannot be made for another order. Each is read back from the text and parsed with
   * the tool's input schema.
   */
  describe("every call the text gives is the literal call, and parses with the tool's input schema", () => {
    /** The calls in `text`: the tool, and its arguments read as the JSON they are written like. */
    function calls(text: string): { tool: ToolName; input: Record<string, any> }[] {
      const found: { tool: ToolName; input: Record<string, any> }[] = [];
      for (const [, tool, literal] of text.matchAll(/\bcall (cancel_order|pay_order) (\{(?:[^{}]|\{[^{}]*\})*\})/g)) {
        found.push({ tool: tool as ToolName, input: JSON.parse(literal!.replace(/([{,] )([A-Za-z]+):/g, '$1"$2":')) });
      }
      return found;
    }
    const inputOf = (tool: ToolName) => TOOLS.find((t) => t.name === tool)!.input;
    const orderFixtures = GOLDENS.map((name) => [name, load(name)] as const).filter(
      (entry): entry is readonly [Golden, ToolFixture] => "tool" in entry[1] && !["search_hotels", "get_hotel", "get_hotel_offers"].includes(entry[1].tool),
    );

    it("an order's Cancel line and pay line, in every fixture: its own id, penalty and total", () => {
      let cancels = 0;
      let closes = 0;
      for (const [name, fixture] of orderFixtures) {
        const orders = (fixture.tool === "list_orders" ? fixture.data.data : [fixture.data]) as Record<string, any>[];
        const text = renderToolResult(fixture.tool, fixture.data);
        const given = calls(text.split("\n").filter((l) => l.startsWith("Cancel: ") || l.startsWith("Pay without the link: ")).join("\n"));
        const expected = orders.flatMap((o) => [
          ...(o.payment.tokenRequest ? [{ tool: "pay_order", input: { orderId: o.orderId, sharedPaymentToken: "<spt_…>", total: o.total } }] : []),
          ...(o.cancel.action === "cancel" ? [{ tool: "cancel_order", input: { orderId: o.orderId, maximumPenalty: o.cancel.penalty } }] : []),
          ...(o.cancel.action === "close" ? [{ tool: "cancel_order", input: { orderId: o.orderId, close: true } }] : []),
        ]);
        assert.deepEqual(given, expected, name);
        for (const { tool, input } of given) {
          const sent = tool === "pay_order" ? { ...input, sharedPaymentToken: "spt_1TestToken0123456789" } : input;
          assert.deepEqual(inputOf(tool).safeParse(sent).error?.issues ?? [], [], `${name}: ${JSON.stringify(input)}`);
          if (input.maximumPenalty) cancels++;
          if (input.close) closes++;
        }
        // No call is left to be completed from elsewhere in the text.
        assert.doesNotMatch(text, /cancel_order with (?:maximumPenalty \{|close: true)|<orderId>/, name);
      }
      assert.ok(cancels >= 4 && closes >= 3, `${cancels} cancels, ${closes} closes`);
    });

    it("the pay call of an order payable by token is its own, placeholder only for the token", () => {
      const data = (load("order-payable-by-token") as ToolFixture).data as Record<string, any>;
      for (const tool of ["create_order", "get_order"] as const) {
        const [pay, close] = calls(renderToolResult(tool, data));
        assert.deepEqual(pay, { tool: "pay_order", input: { orderId: data.orderId, sharedPaymentToken: "<spt_…>", total: { amount: "365.00", currency: "USD" } } });
        assert.deepEqual(close, { tool: "cancel_order", input: { orderId: data.orderId, close: true } });
        assert.ok(inputOf("pay_order").safeParse({ ...pay!.input, sharedPaymentToken: "spt_1TestToken0123456789" }).success);
        // As it stands, with the placeholder, it is refused: the token is the one thing to fill in.
        assert.deepEqual(inputOf("pay_order").safeParse(pay!.input).error?.issues.map((i) => i.path.join(".")), ["sharedPaymentToken"]);
      }
    });

    it("two cancellable orders on one page: each call names its own order", () => {
      const first = copy((load("order-confirmed") as ToolFixture).data) as Record<string, any>;
      const second = copy((load("order-free-to-cancel") as ToolFixture).data) as Record<string, any>;
      const third = unpaidOrder();
      const page = { data: [first, second, third], nextCursor: null };
      strictOutput(outputOf("list_orders")).parse(page);
      const given = calls(renderToolResult("list_orders", page));
      assert.deepEqual(given, [
        { tool: "cancel_order", input: { orderId: first.orderId, maximumPenalty: { amount: "120.00", currency: "USD" } } },
        { tool: "cancel_order", input: { orderId: second.orderId, maximumPenalty: { amount: "0.00", currency: "USD" } } },
        { tool: "cancel_order", input: { orderId: third.orderId, close: true } },
      ]);
      assert.equal(new Set(given.map((c) => c.input.orderId)).size, 3);
      for (const { tool, input } of given) assert.ok(inputOf(tool).safeParse(input).success, JSON.stringify(input));
      // On the CLI each is the whole command, with the real id.
      const commands = [...renderToolResult("list_orders", page, "cli").matchAll(/run `(fortrip orders cancel [^`]+)`/g)].map((m) => m[1]);
      assert.deepEqual(commands, [
        `fortrip orders cancel ${first.orderId} --max-penalty 120.00`,
        `fortrip orders cancel ${second.orderId} --max-penalty 0.00`,
        `fortrip orders cancel ${third.orderId} --close`,
      ]);
    });

    it("order_not_cancellable: the call it gives is for the order it names", () => {
      const orderId = "ord_KataNoLink0000000000";
      const states = [
        { action: "cancel", blockedBy: null, penalty: { amount: "91.50", currency: "USD" }, refund: { amount: "274.50", currency: "USD" } },
        { action: "close", blockedBy: null, penalty: null, refund: null },
      ];
      for (const cancel of states) {
        const text = renderError({ error: { code: "order_not_cancellable", message: "m", retryable: false, requestId: "req_1", details: { orderId, cancel } } }, 409);
        const [call, ...more] = calls(text);
        assert.deepEqual(more, []);
        assert.deepEqual(call, { tool: "cancel_order", input: cancel.penalty ? { orderId, maximumPenalty: cancel.penalty } : { orderId, close: true } });
        assert.ok(inputOf("cancel_order").safeParse(call!.input).success);
      }
    });
  });

  it("on the CLI, the close call names the order as the cancel call does", () => {
    const line = (name: Golden) => renderToolResult("get_order", (load(name) as ToolFixture).data, "cli").split("\n").find((l) => l.startsWith("Cancel: "));
    assert.equal(
      line("order-awaiting-payment"),
      "Cancel: can be closed now, nothing is charged; close it only if the user says they no longer want it (run `fortrip orders cancel ord_BundAwaiting00000000 --close`)",
    );
    assert.equal(
      line("order-confirmed"),
      "Cancel: can cancel now: penalty USD 120.00, refund USD 246.00 (only after the user's yes: run `fortrip orders cancel ord_LakeConfirmed0000000 --max-penalty 120.00`)",
    );
    // No CLI text of an order names an order it could name as a placeholder.
    for (const name of GOLDENS) {
      const fixture = load(name);
      if ("tool" in fixture && fixture.tool !== "search_hotels" && fixture.tool !== "get_hotel" && fixture.tool !== "get_hotel_offers") {
        const data = renderToolResult(fixture.tool, fixture.data, "cli").split("\n\n").filter((block) => block.startsWith("Order ") || block.includes("\nOrder "));
        for (const block of data) assert.doesNotMatch(block, /<orderId>/, name);
      }
    }
  });
});

/* What the goldens show, so each line a rule names can be read in one. */
describe("the goldens show the lines the rules name", () => {
  const golden = (name: Golden) => readFileSync(new URL(`${name}.txt`, DIR), "utf8");

  it("a search with a hotel's photo and the currency hint", () => {
    const text = golden("search-shanghai-area");
    assert.match(text, /^1\. Hotel: .* · photo https:\/\/fortrip\.ai\/hotel-photos\/hotels\/imgs\/1\/a\.webp · htl_BundRiverside0000000$/m);
    assert.match(text, /^Currency: this request comes from mainland China\. Prices are also available in CNY/m);
    // The hint is the last of the data; how to present hotels follows it.
    assert.ok(text.trimEnd().endsWith(PRESENTATION_HINT));
  });

  it("an order with no payment link while a payment is processed", () => {
    const text = golden("order-payment-processing");
    assert.match(text, /^Payment link: none while a payment is being processed; read this order again shortly\.$/m);
    assert.match(text, /^Cancel: not available: a payment is under way; read the order again shortly$/m);
    for (const rule of [ORDER_NEXT_STEP, PAY_NEXT_STEP, CANCEL_NEXT_STEP]) assert.ok(!text.includes(rule));
  });
});

/* An error whose advice depends on a wait says it only when there is one. */
describe("ordering_paused", () => {
  const paused = (after?: number) =>
    renderError({ error: { code: "ordering_paused", message: "m", retryable: true, requestId: "req_1", ...(after === undefined ? {} : { retryAfterSeconds: after }) } }, 503).split("\n");

  it("points at the retry line when it gives a wait", () => {
    const lines = paused(120);
    assert.equal(lines[1], "Retryable: retry after 120 s.");
    assert.equal(lines[2], "Tell the user, and try again later: no sooner than the retry line above says.");
  });

  it("names no retry line when none gives a wait", () => {
    const lines = paused();
    assert.equal(lines[1], "Retryable.");
    assert.equal(lines[2], "Tell the user, and try again later.");
    assert.doesNotMatch(lines.join("\n"), /retry line/);
  });
});
