import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { strictOutput } from "../src/conventions/open.ts";
import { ERROR_CODES, type ErrorCode } from "../src/errors.ts";
import { LIMITS } from "../src/limits.ts";
import { authConfig, meResult } from "../src/outputs/account.ts";
import { ERROR_DETAILS, errorEnvelope } from "../src/outputs/error-details.ts";
import { hotel, POLICY_TOPICS } from "../src/outputs/hotel.ts";
import { hotelOffersResult, offer, UNAVAILABLE_REASONS } from "../src/outputs/offer.ts";
import { offerChange, order, orderList, PAYMENT_METHOD_IDS } from "../src/outputs/order.ts";
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
      },
      photo: { url: "https://fortrip.ai/hotel-photos/hotels/imgs/1/a.webp", caption: null },
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
  photos: [{ url: "https://fortrip.ai/hotel-photos/hotels/imgs/1/a.webp", caption: { text: "Lobby", locale: "en" } }],
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
  contact: { name: "Mary Smith", email: "mary.smith@example.com", phone: "+1 415 555 0134" },
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
        rooms: [
          {
            adults: 2,
            childrenAges: [],
            guests: [
              { firstName: "Mary", lastName: "Smith" },
              { firstName: "Tom", lastName: "Smith" },
            ],
          },
        ],
        specialRequests: null,
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
    methods: [],
  },
  cancel: { available: false, reason: "not_confirmed", penalty: null, refund: null },
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
  offer_expired: { offerId: OFF, expiredAt: "2026-10-24T09:00:00Z" },
  offer_changed: { changes: [priceChange], offer: offerFixture },
  offer_already_ordered: { orderId: ORD },
  order_in_progress: { orderId: ORD },
  cancellation_changed: undefined,
  order_not_cancellable: { reason: "stay_started" },
  order_not_payable: { orderId: ORD, status: "expired" },
  payment_in_progress: { orderId: ORD },
  payment_total_changed: { orderId: ORD, total: usd("140.00") },
  payment_credential_invalid: { reason: "amount" },
  payment_declined: { declineCode: "insufficient_funds" },
  payment_action_required: undefined,
  payment_method_unavailable: undefined,
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
  currency_unavailable: { currency: "CNY" },
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
    // A hotel always says whether it has a cover photo.
    const [summary] = searchFixture.data;
    parsesBoth(searchResult, { ...searchFixture, data: [{ ...summary, photo: null }] });
    const { photo: _photo, ...noPhoto } = summary!;
    assert.equal(searchResult.safeParse({ ...searchFixture, data: [noPhoto] }).success, false);
  });

  it("search, with and without a currency hint", () => {
    // Absent unless the server sees a sign; when present, one currency and its reason.
    parsesBoth(searchResult, { ...searchFixture, currencyHint: { currency: "CNY", reason: "request_location" } });
    parsesBoth(searchResult, { ...searchFixture, currencyHint: { currency: "CNY", reason: "sign_in_location" } });
    assert.equal(strictOutput(searchResult).safeParse({ ...searchFixture, currencyHint: null }).success, false);
    assert.equal(strictOutput(searchResult).safeParse({ ...searchFixture, currencyHint: { currency: "CNY" } }).success, false);
  });
  it("hotel, with and without rooms", () => {
    parsesBoth(hotel, hotelFixture);
    const { rooms: _rooms, ...noRooms } = hotelFixture;
    parsesBoth(hotel, noRooms);
    // Photos aren't asked for: always there, null when none are listed.
    parsesBoth(hotel, { ...hotelFixture, photos: null });
    const { photos: _photos, ...noPhotos } = hotelFixture;
    assert.equal(hotel.safeParse(noPhotos).success, false);
  });
  it("offer and the offers response", () => {
    parsesBoth(offer, offerFixture);
    parsesBoth(hotelOffersResult, offersFixture);
  });
  it("order and the order list", () => {
    parsesBoth(order, orderFixture);
    parsesBoth(orderList, { data: [orderFixture], nextCursor: null });
  });
  it("an order's token method, its handler in UCP's shape", () => {
    const limits = { maxAmount: 13240, currency: "usd", expiresAt: "2026-10-25T08:00:00Z" };
    const handler = {
      id: "stripe_payments",
      type: "com.stripe.payments",
      version: "2026-06-25",
      spec: "https://docs.stripe.com/agentic-commerce/ucp/stripe-payments-handler",
      schema: "https://ucp.stripe.com/payments/2026-06-25/schema.json",
      available_instruments: [
        { type: "card" },
        { type: "link", config: { business_profile: "profile_test_1" } },
      ],
      config: { environment: "testmode", business_profile: "profile_test_1" },
    };
    const withHandler = (h: unknown, l: unknown = limits) => ({
      ...orderFixture,
      payment: { ...orderFixture.payment, methods: [{ id: "stripe_shared_payment_token", handler: h, limits: l }] },
    });
    parsesBoth(order, withHandler(handler));
    // An instrument's config is UCP's: the strict copy keeps what it doesn't know.
    const hinted = { ...handler, available_instruments: [{ type: "link", config: { hint: { any: ["thing"] } } }] };
    parsesBoth(order, withHandler(hinted));
    // An environment this contract doesn't know reads, as an open enum.
    assert.ok(order.safeParse(withHandler({ ...handler, config: { ...handler.config, environment: "staging" } })).success);
    // What the contract closes stays closed in the strict copy.
    for (const leaked of [
      { ...handler, available_instruments: [{ type: "card", extra: 1 }] },
      { ...handler, config: { ...handler.config, extra: 1 } },
      { ...handler, networkId: "profile_test_1" },
    ]) {
      assert.ok(order.safeParse(withHandler(leaked)).success);
      assert.equal(strictOutput(order).safeParse(withHandler(leaked)).success, false);
    }
    for (const field of ["schema", "available_instruments", "config"] as const) {
      const { [field]: _gone, ...without } = handler;
      assert.equal(order.safeParse(withHandler(without)).success, false, field);
    }
    assert.equal(
      order.safeParse(withHandler({ ...handler, config: { environment: "testmode" } })).success,
      false,
    );
    // The token entry always carries its limits.
    for (const field of ["maxAmount", "currency", "expiresAt"] as const) {
      const { [field]: _gone, ...without } = limits;
      assert.equal(order.safeParse(withHandler(handler, without)).success, false, field);
    }
    assert.equal(order.safeParse(withHandler(handler, null)).success, false);
  });

  it("an order's Alipay or WeChat Pay method, offered and open", () => {
    const withWallet = (entry: object) => ({
      ...orderFixture,
      payment: { ...orderFixture.payment, methods: [{ id: "stripe_alipay_wechat_pay", ...entry }] },
    });
    parsesBoth(order, withWallet({ open: false, current: null, wechatPay: null, alipay: null }));
    parsesBoth(
      order,
      withWallet({
        open: true,
        current: "wechat_pay",
        wechatPay: {
          qrData: "weixin://wxpay/bizpayurl?pr=abc",
          qrImageUrl: "https://qr.stripe.com/test_1.png",
          url: "https://fortrip.ai/pay/ord_0123456789abcdefABCD/wechat?t=tok",
        },
        alipay: { url: "https://fortrip.ai/pay/ord_0123456789abcdefABCD/alipay?t=tok" },
      }),
    );
    // Not on WeChat Pay now: no live code, and a wallet this contract doesn't know reads.
    parsesBoth(
      order,
      withWallet({
        open: true,
        current: "alipay",
        wechatPay: { qrData: null, qrImageUrl: null, url: "https://fortrip.ai/pay/ord_0123456789abcdefABCD/wechat?t=tok" },
        alipay: { url: "https://fortrip.ai/pay/ord_0123456789abcdefABCD/alipay?t=tok" },
      }),
    );
    // A known id with its fields missing is malformed, not a method this contract doesn't know.
    assert.equal(order.safeParse(withWallet({})).success, false);
    assert.equal(order.safeParse(withWallet({ current: null, wechatPay: null, alipay: null })).success, false);
  });

  it("an order's payment.methods: both entries, none, or one this contract doesn't know", () => {
    const token = {
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
      limits: { maxAmount: 13240, currency: "usd", expiresAt: "2026-10-25T08:00:00Z" },
    };
    const wallet = { id: "stripe_alipay_wechat_pay", open: false, current: null, wechatPay: null, alipay: null };
    const withMethods = (methods: unknown) => ({ ...orderFixture, payment: { ...orderFixture.payment, methods } });
    parsesBoth(order, withMethods([]));
    parsesBoth(order, withMethods([token, wallet]));
    // An open union: a method this contract doesn't know reads, and the strict copy refuses it.
    const other = withMethods([{ id: "other_method" }]);
    assert.ok(order.safeParse(other).success);
    assert.equal(strictOutput(order).safeParse(other).success, false);
    // Every known id is a branch of the union: alone, its id is malformed.
    for (const id of PAYMENT_METHOD_IDS) {
      assert.equal(order.safeParse(withMethods([{ id }])).success, false, id);
    }
    // An order always lists its methods, the one field for every way to pay but the link.
    const { methods: _gone, ...without } = orderFixture.payment;
    assert.equal(order.safeParse({ ...orderFixture, payment: without }).success, false);
    const payment = (jsonSchemaOf(order).properties as Record<string, JsonSchema>).payment!;
    assert.deepEqual(Object.keys(payment.properties as Record<string, unknown>), [
      "status",
      "url",
      "requiresSignIn",
      "expiresAt",
      "chargeCurrency",
      "localCurrencyAtCheckout",
      "localCharge",
      "methods",
    ]);
  });

  it("an order's cancel quote, cancellable or not", () => {
    const cancellable = {
      ...orderFixture,
      status: "confirmed",
      cancel: { available: true, reason: "cancellable", penalty: usd("66.20"), refund: usd("66.20") },
    };
    parsesBoth(order, cancellable);
    parsesBoth(order, {
      ...orderFixture,
      cancel: { available: false, reason: "not_confirmed", penalty: null, refund: null },
    });
    // An unknown reason stays open; an order always says whether it can be cancelled.
    assert.ok(order.safeParse({ ...cancellable, cancel: { ...cancellable.cancel, reason: "later" } }).success);
    const { cancel: _cancel, ...withoutCancel } = cancellable;
    assert.equal(order.safeParse(withoutCancel).success, false);
    assert.equal(order.safeParse({ ...cancellable, cancel: { available: true } }).success, false);
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

  it("holds every code to §11's details: required where listed, none where the row shows –", () => {
    const strict = strictOutput(errorEnvelope);
    for (const [code, details] of Object.entries(ERROR_FIXTURES)) {
      if (details === undefined) {
        assert.equal(strict.safeParse(envelope(code, { x: 1 })).success, false, `${code} with details`);
      } else {
        assert.equal(errorEnvelope.safeParse(envelope(code, undefined)).success, false, `${code} without details`);
      }
    }
    assert.ok(errorEnvelope.safeParse(envelope("internal", { x: 1 })).success);
    assert.equal(strict.safeParse(envelope("teapot", undefined)).success, false);
  });

  it("search_too_broad carries the area's center: required, null for text-only searches", () => {
    const details = ERROR_FIXTURES.search_too_broad as Record<string, unknown>;
    const { center: _center, ...withoutCenter } = details;
    assert.equal(errorEnvelope.safeParse(envelope("search_too_broad", withoutCenter)).success, false);
    parsesBoth(errorEnvelope, envelope("search_too_broad", { ...details, center: null }));
  });
});

describe("shape rules", () => {
  it("no approx: a price is in one currency, in the search-hotel and offer shapes", () => {
    for (const [name, schema] of [
      ["search_hotels", searchResult],
      ["get_hotel_offers", hotelOffersResult],
    ] as const) {
      assert.doesNotMatch(JSON.stringify(jsonSchemaOf(schema)), /approx/, name);
    }
  });

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
  "address", "adults", "available_instruments", "allInclusive", "amenities", "amount", "areaSqm", "asOf",
  "basis", "beds", "business_profile", "available", "bookable", "breakfastServed", "byFilters", "byLimit", "byNationality",
  "cancel", "cancellation", "candidates", "candidatesTotal", "caption", "center", "changes", "chargeCurrency",
  "checkIn", "checkInTimes", "checkOut", "checkOutTimes", "childrenAges", "cityLike", "clientId",
  "code", "collectedAt", "config", "confirmation", "confirmationNumber", "contact", "count", "countryCode",
  "coverage", "alipay", "createdAt", "currency", "currencyHint", "current", "data", "declineCode", "deposit", "description", "destination",
  "details", "deviceAuthorizationEndpoint", "disclosure", "distanceMeters", "dominated", "email",
  "en", "environment", "error", "excludedNoFacilityData", "excludedNoPrice", "expiredAt", "expiresAt", "field",
  "filterable", "firstName", "freeCancellationEndsAt", "from", "fromPerRoomNight", "fromPerRoomStay",
  "guests", "guestsCoveredPerRoom", "handler", "hotel", "hotelId", "hotels", "id", "hub", "hubTotal", "included", "includes",
  "issuer", "issues", "items", "kind", "known", "label", "lastName", "lat", "line", "listed", "listedShare",
  "limits", "lng", "localCharge", "localCurrencyAtCheckout", "locale", "localities", "location",
  "manageUrl", "mandatory", "match", "matched", "max", "maxAmount", "maxOccupancy", "meals", "members",
  "message", "methods", "min", "mode", "more", "name", "nameAsText", "names", "nextCursor", "nextStep",
  "notes", "offer", "offerId", "offers", "omitted", "orderId", "otherMatches", "outcome", "param",
  "payAtProperty", "payment", "penalties", "penalty", "perNightAllRooms", "phone", "photo", "photos", "place", "placeId",
  "open", "pointer", "policies", "poolLimit", "poolRadiusMeters", "population", "previous", "price",
  "priced", "pricing", "qrData", "qrImageUrl", "radiusMeters", "radiusSource", "reason", "reference", "refund",
  "region", "requestId", "required", "requiresSignIn", "resolution", "retryAfterSeconds",
  "retryable", "revocationEndpoint", "room", "roomCount", "rooms", "schema", "scope", "scopes", "share",
  "sort", "spec", "specialRequests", "stars", "startsAt", "status", "stay", "text", "textAnywhere", "timeZone",
  "tokenEndpoint", "topic", "total", "type", "unassigned", "unavailable", "unreadable",
  "unspecifiedMainMeals", "until", "updatedAt", "url", "userId", "value", "version", "website", "wechatPay", "window",
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

/** The description at a dotted path of a published output schema: dots step
 *  into properties, and through the items of a list and the branches of a
 *  union or a nullable. */
function descriptionAt(schema: z.ZodType, path: string): string | undefined {
  return descriptionsAt(schema, path)[0];
}

/** Every description at a dotted path, as `descriptionAt` steps: the field's
 *  own first, then those of its items and branches. */
function descriptionsAt(schema: z.ZodType, path: string): string[] {
  const expand = (node: JsonSchema): JsonSchema[] => [
    node,
    ...((node.anyOf ?? node.oneOf ?? []) as JsonSchema[]).flatMap(expand),
    ...(node.items ? expand(node.items as JsonSchema) : []),
  ];
  let nodes: JsonSchema[] = [jsonSchemaOf(schema)];
  for (const part of path.split(".")) {
    nodes = nodes.flatMap(expand).flatMap((node) => {
      const child = (node.properties as Record<string, JsonSchema> | undefined)?.[part];
      return child ? [child] : [];
    });
  }
  return nodes
    .flatMap(expand)
    .map((node) => node.description as string | undefined)
    .filter((d): d is string => Boolean(d));
}

describe("field descriptions", () => {
  it("the token method states its limits from LIMITS", () => {
    const text = descriptionsAt(order, "payment.methods").find((d) => d.includes("a token can't pay")) ?? "";
    assert.ok(text.includes(`over $${LIMITS.tokenPaymentMaxUsd}`), text);
    assert.match(text, /not charged in USD/);
    assert.match(text, /then give payment\.url or use another entry\.$/);
  });

  // The fields a caller acts on say what they mean, where the docs and an
  // MCP client read them: in the published JSON Schema.
  const described: Array<[string, z.ZodType, string[]]> = [
    [
      "offers",
      hotelOffersResult,
      [
        "hotels.offers.confirmation",
        "hotels.offers.confirmation.mode",
        "hotels.offers.confirmation.withinMinutes",
        "hotels.offers.price.perNightAllRooms",
        "hotels.offers.cancellation",
        "hotels.offers.cancellation.asOf",
        "hotels.offers.hotel.meals",
        "hotels.offers.hotel.meals.unspecifiedMainMeals",
        "hotels.offers.hotel.meals.guestsCoveredPerRoom",
        "hotels.offers.price.payAtProperty",
        "hotels.omitted",
        "hotels.omitted.byNationality",
        "hotels.omitted.byFilters",
        "hotels.omitted.dominated",
        "hotels.omitted.unreadable",
        "hotels.omitted.byLimit",
        "unavailable.reason",
      ],
    ],
    [
      "order",
      order,
      [
        "status",
        "price.total",
        "items.hotel.cancellation",
        "items.hotel.payAtProperty",
        "payment.expiresAt",
        "payment.chargeCurrency",
        "payment.localCurrencyAtCheckout",
        "payment.localCharge",
      ],
    ],
    [
      "search",
      searchResult,
      [
        "coverage",
        "coverage.matched",
        "coverage.priced",
        "coverage.withPrice",
        "coverage.poolRadiusMeters",
        "coverage.excludedNoPrice",
        "coverage.excludedNoFacilityData",
        "coverage.withinMaxRadius",
        "coverage.textAnywhere",
        "coverage.localities",
        "coverage.nameAsText",
      ],
    ],
  ];
  for (const [name, schema, paths] of described) {
    it(`${name}: the fields a caller acts on say what they mean`, () => {
      for (const path of paths) assert.ok(descriptionAt(schema, path)?.trim(), `${name}.${path}`);
    });
  }

  it("explains every reason a hotel has no offers, nationality_restricted as a rate Fortrip can't book", () => {
    const text = descriptionAt(hotelOffersResult, "unavailable.reason") ?? "";
    for (const reason of UNAVAILABLE_REASONS) assert.ok(text.includes(reason), reason);
    assert.match(text, /nationality_restricted \([^)]*nationalities[^)]*Fortrip can't book/);
  });

  it("calls a locality a locality, never a hub", () => {
    for (const [name, schema] of Object.entries(OUTPUT_SCHEMAS)) {
      const descriptions: string[] = [];
      const collect = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        for (const [key, value] of Object.entries(node)) {
          if (key === "description" && typeof value === "string") descriptions.push(value);
          else collect(value);
        }
      };
      collect(jsonSchemaOf(schema));
      for (const text of descriptions) assert.doesNotMatch(text, /\bhubs?\b/i, `${name}: ${text}`);
    }
  });
});
