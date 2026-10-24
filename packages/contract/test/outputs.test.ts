import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { strictOutput } from "../src/conventions/open.ts";
import { ERROR_CODES, type ErrorCode } from "../src/errors.ts";
import { authConfig, meResult } from "../src/outputs/account.ts";
import {
  ERROR_DETAILS,
  errorEnvelope,
  strictErrorEnvelope,
} from "../src/outputs/error-details.ts";
import { hotel, POLICY_TOPICS } from "../src/outputs/hotel.ts";
import { hotelOffersResult, offer } from "../src/outputs/offer.ts";
import { offerChange, order, orderList } from "../src/outputs/order.ts";
import { place } from "../src/outputs/place.ts";
import { SEARCH_NOTE_CODES, searchResult } from "../src/outputs/search.ts";
import { jsonSchemaOf, OUTPUT_SCHEMAS, type JsonSchema } from "./output-schemas.ts";

// ---------------------------------------------------------------------------
// Fixtures: one fully populated value per shape, as the spec writes them.

const usd = (amount: string) => ({ amount, currency: "USD" });
const names = { en: "Shanghai", zh: "上海" };
const shanghaiRef = { placeId: "plc_1796236", name: "Shanghai", names };
const shanghai = {
  ...shanghaiRef,
  kind: "region",
  scope: "area",
  cityLike: true,
  population: 24_874_500,
  region: null,
  countryCode: "CN",
  location: { lat: 31.22222, lng: 121.45806 },
};
const stay = {
  checkIn: "2026-11-10",
  checkOut: "2026-11-12",
  rooms: [{ adults: 2, childrenAges: [6] }],
};
const HTL = "htl_0123456789abcdefABCD";
const OFF = "off_0123456789abcdefABCD";
const ORD = "ord_0123456789abcdefABCD";

const searchFixture = {
  destination: {
    kind: "place",
    place: shanghai,
    resolution: "only_match",
    otherMatches: 0,
    scope: "area",
    center: { location: { lat: 31.23, lng: 121.47 }, place: shanghaiRef, basis: "seat" },
    radiusMeters: null,
    radiusSource: null,
  },
  text: { value: "Hilton", match: "exact" },
  stay,
  pricing: { mode: "indicative", scope: "page", status: "ok" },
  sort: "distance",
  coverage: {
    matched: 2634,
    priced: 20,
    withPrice: 11,
    poolRadiusMeters: null,
    excludedNoPrice: null,
    excludedNoFacilityData: null,
    withinMaxRadius: null,
    textAnywhere: null,
    localities: {
      items: [
        {
          place: { placeId: "plc_1", name: "Pudong", names: { en: "Pudong", zh: null } },
          count: 812,
          total: 812,
          includes: [
            { place: { placeId: "plc_2", name: "Lujiazui", names: { en: "Lujiazui", zh: "陆家嘴" } }, members: 90 },
          ],
        },
      ],
      unassigned: 3,
      more: 12,
    },
    nameAsText: null,
  },
  data: [
    {
      hotelId: HTL,
      name: "Hotel A",
      names: { en: "Hotel A", zh: null },
      stars: 4.5,
      address: { line: { text: "1 Nanjing Rd", locale: "en" }, countryCode: "CN", region: shanghaiRef },
      location: { lat: 31.2, lng: 121.4 },
      timeZone: "Asia/Shanghai",
      distanceMeters: 812,
      price: {
        kind: "indicative",
        basis: "lowest_unit",
        fromPerRoomNight: usd("66.20"),
        fromPerRoomStay: usd("132.40"),
        approx: {
          fromPerRoomNight: { amount: "471.33", currency: "CNY" },
          fromPerRoomStay: { amount: "942.66", currency: "CNY" },
          rateDate: "2026-10-23",
        },
      },
    },
  ],
  nextCursor: "c1",
  notes: [{ code: "locality_available", message: "Pudong is a locality: plc_1, 812 hotels." }],
};

const pointSearchFixture = {
  ...searchFixture,
  destination: {
    kind: "point",
    center: { location: { lat: 31.23, lng: 121.47 }, place: null, basis: "point" },
    scope: "radius",
    radiusMeters: 8000,
    radiusSource: "default",
  },
  text: null,
  stay: null,
  pricing: { mode: "none", scope: null, status: null },
  coverage: { ...searchFixture.coverage, localities: null },
  nextCursor: null,
};

const hotelFixture = {
  hotelId: HTL,
  name: "Hotel A",
  names: { en: "Hotel A", zh: "A 酒店" },
  bookable: true,
  stars: 4,
  address: { line: null, countryCode: "CN", region: null },
  location: { lat: 31.2, lng: 121.4 },
  timeZone: "Asia/Shanghai",
  description: { text: "A hotel.", locale: "en" },
  checkInTimes: { from: "14:00", until: null },
  checkOutTimes: { from: null, until: "12:00" },
  policies: { listed: true, items: [{ topic: "pets", text: "No pets.", locale: "en" }] },
  amenities: { listed: true, items: [{ code: "pool", name: { text: "Pool", locale: "en" } }] },
  breakfastServed: null,
  deposit: { required: true, amount: { amount: "500.00", currency: "CNY" } },
  contact: { phone: "+86 21 0000 0000", website: null },
  rooms: {
    listed: true,
    items: [
      {
        name: { text: "Deluxe King", locale: "en" },
        beds: { text: "1 king bed", locale: null },
        areaSqm: { min: 30, max: 35 },
        maxOccupancy: 2,
        window: "yes",
      },
    ],
  },
};

const meals = {
  known: true,
  included: ["breakfast"],
  unspecifiedMainMeals: null,
  allInclusive: false,
  guestsCoveredPerRoom: 2,
  label: { text: "Breakfast for 2", locale: "en" },
};
const cancellation = {
  status: "partial_penalty",
  asOf: "2026-10-24T08:00:00Z",
  freeCancellationEndsAt: "2026-11-08T16:00:00Z",
  penalties: [{ startsAt: "2026-11-08T16:00:00Z", amount: usd("66.20") }],
  timeZone: "Asia/Shanghai",
};
const confirmation = { mode: "instant", withinMinutes: null };
const payAtProperty = {
  disclosure: "complete",
  items: [
    {
      label: { text: "City tax", locale: "en" },
      amount: { amount: "10.00", currency: "CNY" },
      mandatory: true,
      basis: "unknown",
      collectedAt: "property",
    },
  ],
};

const offerFixture = {
  offerId: OFF,
  type: "hotel",
  expiresAt: "2026-10-24T09:00:00Z",
  hotel: {
    hotelId: HTL,
    room: {
      name: { text: "Deluxe King", locale: "en" },
      beds: null,
      areaSqm: null,
      maxOccupancy: 2,
      window: null,
    },
    roomCount: 1,
    meals,
  },
  price: {
    total: usd("132.40"),
    perNightAllRooms: usd("66.20"),
    approx: null,
    payAtProperty,
  },
  cancellation,
  confirmation,
};

const omitted = { byNationality: 0, byFilters: 1, dominated: 2, unreadable: 0, byLimit: 3 };
const offersFixture = {
  stay,
  hotels: [{ hotel: { hotelId: HTL, name: "Hotel A", names: { en: "Hotel A", zh: null } }, offers: [offerFixture], omitted }],
  unavailable: [
    { hotelId: "htl_ZYXWVUTSRQponmlkjihg", reason: "sold_out", omitted },
    { hotelId: "htl_ZYXWVUTSRQponmlkji00", reason: "supplier_unavailable", omitted: null },
  ],
};

const orderFixture = {
  orderId: ORD,
  reference: "FT-7KQ2MX",
  status: "awaiting_payment",
  createdAt: "2026-10-24T08:00:00Z",
  updatedAt: "2026-10-24T08:01:00.123Z",
  items: [
    {
      type: "hotel",
      hotel: {
        hotelId: HTL,
        name: "Hotel A",
        names: { en: "Hotel A", zh: null },
        checkIn: "2026-11-10",
        checkOut: "2026-11-12",
        timeZone: "Asia/Shanghai",
        rooms: [{ adults: 2, childrenAges: [] }],
        room: { name: { text: "Deluxe King", locale: "en" }, beds: null },
        meals,
        cancellation,
        payAtProperty,
        confirmationNumber: null,
      },
    },
  ],
  price: { total: usd("132.40") },
  payment: {
    status: "unpaid",
    url: "https://fortrip.ai/booking-status?session_id=cs_test_1",
    requiresSignIn: false,
    expiresAt: "2026-10-25T08:00:00Z",
    chargeCurrency: "USD",
    localCurrencyAtCheckout: true,
    localCharge: null,
  },
  manageUrl: "https://fortrip.ai/orders/ord_0123456789abcdefABCD",
};

const priceChange = { field: "price", previous: usd("132.40"), current: usd("140.00"), worse: true };

const ERROR_FIXTURES: Record<ErrorCode, unknown> = {
  invalid_request: {
    issues: [{ pointer: "/filters/amenities/0", message: "spa cannot filter" }],
    filterable: ["parking", "wifi"],
    share: { code: "spa", listedShare: 0.12 },
  },
  cursor_invalid: { reason: "expired" },
  unauthenticated: undefined,
  forbidden: undefined,
  not_found: undefined,
  order_removed: { orderId: ORD, reference: "FT-7KQ2MX" },
  offer_expired: { offerId: OFF, expiredAt: "2026-10-24T09:00:00Z" },
  offer_changed: { changes: [priceChange], offer: offerFixture },
  offer_already_ordered: { orderId: ORD },
  order_exists: { orderId: ORD, status: "confirmed" },
  order_in_progress: { orderId: ORD },
  order_attempts_exhausted: { orderId: ORD },
  destination_ambiguous: {
    name: "Suzhou",
    countryCode: "CN",
    candidates: [{ ...shanghai, hotels: { scope: "area", radiusMeters: null, count: 1200 } }],
    candidatesTotal: 2,
    nameAsText: 14,
  },
  destination_not_found: {
    reason: "not_a_locality",
    placeId: "plc_1151254",
    hub: { placeId: "plc_1151253", name: "Phuket", names: { en: "Phuket", zh: "普吉" } },
    hubTotal: 2752,
  },
  search_too_broad: {
    matched: 3044,
    poolLimit: 3000,
    localities: searchFixture.coverage.localities,
    center: searchFixture.destination.center,
  },
  stay_unsupported: { reason: "max_nights", max: 15 },
  stay_in_past: { checkIn: "2026-10-23", timeZone: null },
  offer_unavailable: { offerId: OFF, reason: "sold_out" },
  rate_limited: { scope: "search" },
  ordering_paused: undefined,
  service_unavailable: undefined,
  supplier_unavailable: { outcome: "not_started" },
  internal: undefined,
};

function envelope(code: string, details: unknown) {
  return {
    error: {
      code,
      message: "Something happened.",
      retryable: false,
      ...(details === undefined ? {} : { details }),
      requestId: "req_1",
    },
  };
}

// ---------------------------------------------------------------------------

/** Parses with the open schema and with its strict copy. */
function parsesBoth(schema: z.ZodType, value: unknown) {
  const open = schema.safeParse(value);
  assert.ok(open.success, JSON.stringify(open.error?.issues));
  const strict = strictOutput(schema).safeParse(value);
  assert.ok(strict.success, JSON.stringify(strict.error?.issues));
}

describe("v1 response fixtures parse, open and strict", () => {
  it("search, with a place and with a point destination", () => {
    parsesBoth(searchResult, searchFixture);
    parsesBoth(searchResult, pointSearchFixture);
    parsesBoth(searchResult, { ...searchFixture, destination: null });
  });
  it("hotel, with and without rooms", () => {
    parsesBoth(hotel, hotelFixture);
    const { rooms: _rooms, ...noRooms } = hotelFixture;
    parsesBoth(hotel, noRooms);
  });
  it("offer and the offers response", () => {
    parsesBoth(offer, offerFixture);
    parsesBoth(hotelOffersResult, offersFixture);
  });
  it("order and the order list", () => {
    parsesBoth(order, orderFixture);
    parsesBoth(orderList, { data: [orderFixture], nextCursor: null });
  });
  it("every change field", () => {
    for (const [field, value] of [
      ["meals", meals],
      ["cancellation", cancellation],
      ["confirmation", confirmation],
      ["pay_at_property", payAtProperty],
    ] as const) {
      parsesBoth(offerChange, { field, previous: value, current: value, worse: false });
    }
    parsesBoth(offerChange, priceChange);
  });
  it("account", () => {
    parsesBoth(meResult, { userId: "user_1", email: null, name: "Ann" });
    parsesBoth(authConfig, {
      issuer: "https://clerk.fortrip.ai",
      clientId: "c",
      scopes: "openid email",
      deviceAuthorizationEndpoint: "https://clerk.fortrip.ai/oauth/device",
      tokenEndpoint: "https://clerk.fortrip.ai/oauth/token",
      revocationEndpoint: "https://clerk.fortrip.ai/oauth/revoke",
    });
  });
  it("an error envelope for every code", () => {
    for (const [code, details] of Object.entries(ERROR_FIXTURES)) {
      parsesBoth(errorEnvelope, envelope(code, details));
      const strict = strictErrorEnvelope().safeParse(envelope(code, details));
      assert.ok(strict.success, `${code}: ${JSON.stringify(strict.error?.issues)}`);
    }
    parsesBoth(errorEnvelope, envelope("destination_not_found", { reason: "no_match", name: "Atlantis", countryCode: "GR", nameAsText: 0 }));
    parsesBoth(errorEnvelope, envelope("destination_not_found", { reason: "unknown_id", placeId: "plc_9" }));
    parsesBoth(errorEnvelope, envelope("stay_unsupported", { reason: "mixed_occupancy" }));
    parsesBoth(errorEnvelope, envelope("supplier_unavailable", { outcome: "unknown" }));
  });
});

describe("open where the spec says, strict in server tests", () => {
  it("strictOutput(offer) rejects a supplier field the open offer keeps", () => {
    const leaked = { ...offerFixture, ratePlanCode: "RP1" };
    assert.equal((offer.parse(leaked) as Record<string, unknown>).ratePlanCode, "RP1");
    assert.equal(strictOutput(offer).safeParse(leaked).success, false);
  });

  it("keeps unknown enum values and union branches open", () => {
    const later = {
      ...orderFixture,
      status: "on_hold",
      items: [orderFixture.items[0], { type: "flight", flight: { number: "MU5101" } }],
    };
    assert.ok(order.safeParse(later).success);
    assert.equal(strictOutput(order).safeParse(later).success, false);
    assert.ok(offer.safeParse({ ...offerFixture, type: "car" }).success);
    assert.equal(strictOutput(offer).safeParse({ ...offerFixture, type: "car" }).success, false);
    assert.ok(offerChange.safeParse({ field: "room", previous: 1, current: 2 }).success);
    assert.ok(errorEnvelope.safeParse(envelope("teapot", { x: 1 })).success);
  });

  it("fails a malformed known branch instead of falling back", () => {
    assert.equal(
      offerChange.safeParse({ field: "price", previous: "132.40", current: usd("1.00"), worse: true }).success,
      false,
    );
    assert.equal(
      errorEnvelope.safeParse(envelope("destination_not_found", { reason: "unknown_id" })).success,
      false,
    );
    assert.equal(
      order.safeParse({ ...orderFixture, items: [{ type: "hotel", hotel: {} }] }).success,
      false,
    );
  });

  it("lets a client read an envelope without details (ruling A)", () => {
    for (const code of Object.keys(ERROR_FIXTURES)) {
      assert.ok(errorEnvelope.safeParse(envelope(code, undefined)).success, code);
    }
  });

  it("holds the server to §11's details per code, in the strict envelope", () => {
    const strict = strictErrorEnvelope();
    for (const [code, details] of Object.entries(ERROR_FIXTURES)) {
      if (details === undefined) {
        assert.equal(strict.safeParse(envelope(code, { x: 1 })).success, false, `${code} with details`);
        assert.equal(strictOutput(errorEnvelope).safeParse(envelope(code, { x: 1 })).success, false, code);
      } else {
        assert.equal(strict.safeParse(envelope(code, undefined)).success, false, `${code} without details`);
      }
    }
    assert.ok(errorEnvelope.safeParse(envelope("internal", { x: 1 })).success);
    assert.equal(strict.safeParse(envelope("teapot", undefined)).success, false);
  });

  it("search_too_broad carries the area's center: required, null for text-only searches", () => {
    const strict = strictErrorEnvelope();
    const details = ERROR_FIXTURES.search_too_broad as Record<string, unknown>;
    const { center: _center, ...withoutCenter } = details;
    assert.equal(strict.safeParse(envelope("search_too_broad", withoutCenter)).success, false);
    const textOnly = { ...details, center: null };
    assert.ok(strict.safeParse(envelope("search_too_broad", textOnly)).success);
    parsesBoth(errorEnvelope, envelope("search_too_broad", textOnly));
    // A client still reads the localities from a server that sends no center.
    assert.ok(errorEnvelope.safeParse(envelope("search_too_broad", withoutCenter)).success);
  });
});

describe("shape rules", () => {
  it("an order has at least one item", () => {
    assert.equal(order.safeParse({ ...orderFixture, items: [] }).success, false);
  });

  it("an order reference is FT- and six unambiguous characters", () => {
    for (const reference of ["FT-7KQ2MX", "FT-ABCDEF", "FT-234567"]) {
      assert.ok(order.safeParse({ ...orderFixture, reference }).success, reference);
    }
    for (const reference of ["FT-7KQ2M", "FT-7KQ2MXX", "FT-7KQ2M0", "FT-7KQ2MI", "FT-7KQ2MO", "FT-7KQ2M1", "ft-7KQ2MX", "FT-7kq2mx"]) {
      assert.equal(order.safeParse({ ...orderFixture, reference }).success, false, reference);
    }
  });

  it("an offer change list is never empty", () => {
    assert.equal(
      errorEnvelope.safeParse(envelope("offer_changed", { changes: [], offer: offerFixture })).success,
      false,
    );
  });

  it("place kinds, policy topics and note codes are as listed", () => {
    assert.ok(place.safeParse(shanghai).success);
    assert.equal(POLICY_TOPICS.length, 15);
    assert.equal(POLICY_TOPICS.at(-1), "other");
    assert.ok(SEARCH_NOTE_CODES.includes("locality_available"));
    assert.equal(SEARCH_NOTE_CODES.length, 15);
  });

  it("details are declared for exactly the codes that carry them", () => {
    assert.deepEqual(Object.keys(ERROR_DETAILS).sort(), Object.keys(ERROR_CODES).sort());
    const withDetails = Object.entries(ERROR_FIXTURES)
      .filter(([, d]) => d !== undefined)
      .map(([code]) => code)
      .sort();
    const declared = Object.entries(ERROR_DETAILS)
      .filter(([, d]) => d !== null)
      .map(([code]) => code)
      .sort();
    assert.deepEqual(declared, withDetails);
  });
});

/** Every key an output schema declares. A new key fails the test below until it
 *  is listed here, so a name from outside the public vocabulary can't slip in. */
const PUBLIC_KEYS = new Set([
  "address", "adults", "allInclusive", "amenities", "amount", "approx", "areaSqm", "asOf",
  "basis", "beds", "bookable", "breakfastServed", "byFilters", "byLimit", "byNationality",
  "cancellation", "candidates", "candidatesTotal", "center", "changes", "chargeCurrency",
  "checkIn", "checkInTimes", "checkOut", "checkOutTimes", "childrenAges", "cityLike", "clientId",
  "code", "collectedAt", "confirmation", "confirmationNumber", "contact", "count", "countryCode",
  "coverage", "createdAt", "currency", "current", "data", "deposit", "description", "destination",
  "details", "deviceAuthorizationEndpoint", "disclosure", "distanceMeters", "dominated", "email",
  "en", "error", "excludedNoFacilityData", "excludedNoPrice", "expiredAt", "expiresAt", "field",
  "filterable", "freeCancellationEndsAt", "from", "fromPerRoomNight", "fromPerRoomStay",
  "guestsCoveredPerRoom", "hotel", "hotelId", "hotels", "hub", "hubTotal", "included", "includes",
  "issuer", "issues", "items", "kind", "known", "label", "lat", "line", "listed", "listedShare",
  "lng", "localCharge", "localCurrencyAtCheckout", "locale", "localities", "location",
  "manageUrl", "mandatory", "match", "matched", "max", "maxOccupancy", "meals", "members",
  "message", "min", "mode", "more", "name", "nameAsText", "names", "nextCursor", "nextStep",
  "notes", "offer", "offerId", "offers", "omitted", "orderId", "otherMatches", "outcome", "param",
  "payAtProperty", "payment", "penalties", "perNightAllRooms", "phone", "place", "placeId",
  "pointer", "policies", "poolLimit", "poolRadiusMeters", "population", "previous", "price",
  "priced", "pricing", "radiusMeters", "radiusSource", "rateDate", "reason", "reference",
  "region", "requestId", "required", "requiresSignIn", "resolution", "retryAfterSeconds",
  "retryable", "revocationEndpoint", "room", "roomCount", "rooms", "scope", "scopes", "share",
  "sort", "stars", "startsAt", "status", "stay", "text", "textAnywhere", "timeZone",
  "tokenEndpoint", "topic", "total", "type", "unassigned", "unavailable", "unreadable",
  "unspecifiedMainMeals", "until", "updatedAt", "url", "userId", "value", "website", "window",
  "withPrice", "withinMaxRadius", "withinMinutes", "worse", "zh",
]);

function propertyNames(node: JsonSchema, into = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" && value && typeof value === "object") {
      for (const name of Object.keys(value)) into.add(name);
    }
    if (value && typeof value === "object") propertyNames(value as JsonSchema, into);
  }
  return into;
}

describe("no supplier fields", () => {
  it("every key an output schema declares is a listed public key", () => {
    for (const [name, schema] of Object.entries(OUTPUT_SCHEMAS)) {
      for (const key of propertyNames(jsonSchemaOf(schema))) assert.ok(PUBLIC_KEYS.has(key), `${name}.${key}`);
    }
  });

  it("every listed public key is declared by some output schema", () => {
    const used = new Set<string>();
    for (const schema of Object.values(OUTPUT_SCHEMAS)) for (const key of propertyNames(jsonSchemaOf(schema))) used.add(key);
    for (const key of PUBLIC_KEYS) assert.ok(used.has(key), key);
  });
});
