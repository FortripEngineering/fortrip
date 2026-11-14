import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { strictOutput } from "../src/conventions/open.ts";
import { ERROR_CODES, type ErrorCode } from "../src/errors.ts";
import { LIMITS } from "../src/limits.ts";
import { authConfig, meResult } from "../src/outputs/account.ts";
import { ERROR_DETAILS, errorEnvelope } from "../src/outputs/error-details.ts";
import { hotel, POLICY_TOPICS } from "../src/outputs/hotel.ts";
import { FEE_KINDS, hotelOffersResult, offer, UNAVAILABLE_REASONS } from "../src/outputs/offer.ts";
import {
  CANCEL_BLOCKERS,
  FAILURE_REASONS,
  offerChange,
  order,
  orderCancel,
  orderList,
} from "../src/outputs/order.ts";
import { place } from "../src/outputs/place.ts";
import { SEARCH_NOTE_CODES, SEARCH_NOTE_DETAILS, searchResult } from "../src/outputs/search.ts";
import { jsonSchemaOf, OUTPUT_SCHEMAS, type JsonSchema } from "./output-schemas.ts";

// ---------------------------------------------------------------------------
// Fixtures: one fully populated value per shape, as the spec writes them.

const usd = (amount: string) => ({ amount, currency: "USD" });
const names = { en: "Shanghai", zh: "上海" };
const shanghaiRef = { placeId: "plc_1796236", name: "Shanghai", names };
const shanghai = {
  ...shanghaiRef,
  kind: "region",
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
  text: "Hilton",
  stay,
  pricing: { mode: "indicative", covers: "page", status: "ok" },
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
          localityTotal: 812,
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
  currencyHint: null,
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
      indicativePrice: {
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
  pricing: { mode: "none", covers: null, status: null },
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
  roomTypes: [
    {
      name: { text: "Deluxe King", locale: "en" },
      beds: { text: "1 king bed", locale: null },
      areaSqm: { min: 30, max: 35 },
      maxOccupancy: 2,
      window: "yes",
    },
  ],
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
  readAt: "2026-10-24T08:00:00Z",
  freeCancellationEndsAt: "2026-11-08T16:00:00Z",
  penalties: [{ startsAt: "2026-11-08T16:00:00Z", amount: usd("66.20") }],
  timeZone: "Asia/Shanghai",
};
const confirmation = { mode: "instant", withinMinutes: null };
const payAtProperty = {
  disclosure: "complete",
  items: [
    {
      kind: "tax",
      amount: { amount: "10.00", currency: "CNY" },
      mandatory: true,
      basis: "unknown",
    },
  ],
};

const offerFixture = {
  offerId: OFF,
  hotelId: HTL,
  expiresAt: "2026-10-24T09:00:00Z",
  roomType: {
    name: { text: "Deluxe King", locale: "en" },
    beds: null,
    areaSqm: null,
    maxOccupancy: 2,
    window: null,
  },
  roomCount: 1,
  meals,
  cancellation,
  confirmation,
  payAtProperty,
  total: usd("132.40"),
  perRoomNight: usd("66.20"),
};

const omitted = { byNationality: 0, byFilters: 1, dominated: 2, unreadable: 0, byLimit: 3, byCallLimit: 4 };
const offersFixture = {
  stay,
  limitPerHotel: null,
  hotels: [{ hotelId: HTL, name: "Hotel A", names: { en: "Hotel A", zh: null }, offers: [offerFixture], omitted }],
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
            roomType: {
              name: { text: "Deluxe King", locale: "en" },
              beds: null,
              areaSqm: null,
              maxOccupancy: 2,
              window: null,
            },
            meals,
          },
        ],
        specialRequests: null,
        cancellation,
        confirmation,
        payAtProperty,
        confirmationNumber: null,
      },
    },
  ],
  total: usd("132.40"),
  payment: {
    status: "unpaid",
    url: `https://fortrip.ai/pay/${ORD}?s=cs_test_1`,
    requiresSignIn: false,
    expiresAt: "2026-10-25T08:00:00Z",
    localCurrencyAtCheckout: true,
    localCharge: null,
    tokenRequest: null,
  },
  cancel: { action: "close", blockedBy: null, penalty: null, refund: null },
  cancelled: null,
  failure: null,
  manageUrl: "https://fortrip.ai/orders/ord_0123456789abcdefABCD",
};

const cancelNow = { action: "cancel", blockedBy: null, penalty: usd("66.20"), refund: usd("66.20") };
const blockedBy = (reason: string) => ({ action: null, blockedBy: reason, penalty: null, refund: null });

const totalChange = { field: "total", previous: usd("132.40"), current: usd("140.00"), worse: true };

const ERROR_FIXTURES: Record<ErrorCode, unknown> = {
  invalid_request: {
    issues: [{ pointer: "/filters/amenities/0", message: "spa cannot filter" }],
  },
  cursor_invalid: { reason: "expired" },
  unauthenticated: undefined,
  forbidden: undefined,
  not_found: undefined,
  offer_expired: { offerId: OFF, expiredAt: "2026-10-24T09:00:00Z" },
  offer_changed: { changes: [totalChange], offer: offerFixture },
  offer_already_ordered: { orderId: ORD },
  order_in_progress: { orderId: ORD },
  cancellation_changed: undefined,
  order_not_cancellable: { orderId: ORD, cancel: cancelNow },
  order_not_payable: { orderId: ORD, status: "expired" },
  payment_in_progress: { orderId: ORD },
  payment_total_mismatch: { orderId: ORD, total: usd("140.00") },
  payment_credential_invalid: { reason: "amount" },
  payment_declined: { declineCode: "insufficient_funds" },
  payment_action_required: undefined,
  payment_method_unavailable: { reason: "payment_open_on_page" },
  destination_ambiguous: {
    name: "Suzhou",
    countryCode: "CN",
    candidates: [{ ...shanghai, hotels: { radiusMeters: null, count: 1200 } }],
    candidatesTotal: 2,
    nameAsText: 14,
  },
  destination_not_found: {
    reason: "not_a_locality",
    placeId: "plc_1151254",
    locality: { placeId: "plc_1151253", name: "Phuket", names: { en: "Phuket", zh: "普吉" } },
    localityTotal: 2752,
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
  rate_limited: { rateLimit: "search" },
  ordering_paused: undefined,
  service_unavailable: undefined,
  supplier_unavailable: { outcome: "not_started" },
  client_outdated: undefined,
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
    // Always there: null unless the server sees a sign; then one currency and its reason.
    parsesBoth(searchResult, { ...searchFixture, currencyHint: null });
    parsesBoth(searchResult, { ...searchFixture, currencyHint: { currency: "CNY", reason: "request_location" } });
    parsesBoth(searchResult, { ...searchFixture, currencyHint: { currency: "CNY", reason: "sign_in_location" } });
    const { currencyHint: _hint, ...noHint } = searchFixture;
    assert.equal(searchResult.safeParse(noHint).success, false);
    assert.equal(strictOutput(searchResult).safeParse({ ...searchFixture, currencyHint: { currency: "CNY" } }).success, false);
  });
  it("search text is the string searched for, or null", () => {
    parsesBoth(searchResult, { ...searchFixture, text: null });
    assert.equal(searchResult.safeParse({ ...searchFixture, text: { value: "Hilton", match: "exact" } }).success, false);
  });
  // A note is worded from its code. The two whose words need a fact the search does not hold
  // carry it in details, which a server may leave out.
  it("a search note's details: the facts its words need, by code, and optional", () => {
    const withNotes = (...notes: unknown[]) => ({ ...searchFixture, notes });
    const absorbed = { places: [{ placeId: "plc_1796236", name: "Shanghai", kind: "settlement" }] };
    const available = { localityTotal: 6953 };
    assert.deepEqual(Object.keys(SEARCH_NOTE_DETAILS).sort(), ["area_absorbed", "locality_available"]);
    parsesBoth(searchResult, withNotes({ code: "area_absorbed", message: "m", details: absorbed }));
    parsesBoth(searchResult, withNotes({ code: "locality_available", message: "m", details: available }));
    // Without them a note still reads: the server fills them later.
    for (const code of SEARCH_NOTE_CODES) parsesBoth(searchResult, withNotes({ code, message: "m" }));
    // Details are open objects: a field this build does not know is kept, and closed in the strict copy.
    const more = withNotes({ code: "locality_available", message: "m", details: { ...available, share: 0.4 } });
    assert.ok(searchResult.safeParse(more).success);
    assert.equal(strictOutput(searchResult).safeParse(more).success, false);
    // A known code's details are that code's: malformed ones do not read.
    for (const details of [{ localityTotal: "many" }, {}, { places: absorbed.places }, null]) {
      assert.equal(searchResult.safeParse(withNotes({ code: "locality_available", message: "m", details })).success, false, JSON.stringify(details));
    }
    for (const details of [{ places: [] }, { places: [{ placeId: "plc_1", name: "Shanghai" }] }, { places: [{ placeId: "one", name: "Shanghai", kind: "settlement" }] }, available]) {
      assert.equal(searchResult.safeParse(withNotes({ code: "area_absorbed", message: "m", details })).success, false, JSON.stringify(details));
    }
    // A kind of place this build does not know reads, as an open enum.
    assert.ok(searchResult.safeParse(withNotes({ code: "area_absorbed", message: "m", details: { places: [{ ...absorbed.places[0], kind: "atoll" }] } })).success);
    // A code with no details of its own: none in the strict copy.
    const stray = withNotes({ code: "broad_area", message: "m", details: available });
    assert.ok(searchResult.safeParse(stray).success);
    assert.equal(strictOutput(searchResult).safeParse(stray).success, false);
    // A code this build does not know reads with whatever it carries; every note has a message.
    const later = withNotes({ code: "something_new", message: "m", details: { anything: [1, { at: "all" }] } });
    assert.ok(searchResult.safeParse(later).success);
    assert.equal(strictOutput(searchResult).safeParse(later).success, false);
    for (const code of ["area_absorbed", "broad_area"]) {
      assert.equal(searchResult.safeParse(withNotes({ code })).success, false, code);
      assert.equal(searchResult.safeParse(withNotes({ code, message: 7 })).success, false, code);
    }
  });

  it("hotel, with and without room types", () => {
    parsesBoth(hotel, hotelFixture);
    // Absent unless asked for; asked for, null when the catalogue lists none.
    const { roomTypes: _roomTypes, ...notAsked } = hotelFixture;
    parsesBoth(hotel, notAsked);
    parsesBoth(hotel, { ...hotelFixture, roomTypes: null });
    // A room type's facts not on record are null, its name included.
    parsesBoth(hotel, {
      ...hotelFixture,
      roomTypes: [{ name: null, beds: null, areaSqm: null, maxOccupancy: null, window: null }],
    });
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
  it("an order's payment token: the handler in UCP's shape, the usage limits in Stripe's", () => {
    const usageLimits = { max_amount: 13240, currency: "usd", expires_at: 1792915200 };
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
    const withToken = (tokenRequest: unknown) => ({ ...orderFixture, payment: { ...orderFixture.payment, tokenRequest } });
    const withHandler = (h: unknown, l: unknown = usageLimits) => withToken({ handler: h, usageLimits: l });
    parsesBoth(order, withHandler(handler));
    // An instrument's config is UCP's: the strict copy keeps what it doesn't know.
    const hinted = { ...handler, available_instruments: [{ type: "link", config: { hint: { any: ["thing"] } } }] };
    parsesBoth(order, withHandler(hinted));
    // An environment this contract doesn't know reads, as an open enum.
    assert.ok(order.safeParse(withHandler({ ...handler, config: { ...handler.config, environment: "staging" } })).success);
    // What the contract closes stays closed in the strict copy.
    for (const leaked of [
      withHandler({ ...handler, available_instruments: [{ type: "card", extra: 1 }] }),
      withHandler({ ...handler, config: { ...handler.config, extra: 1 } }),
      withHandler({ ...handler, networkId: "profile_test_1" }),
      withHandler(handler, { ...usageLimits, maxAmount: 13240 }),
      withToken({ handler, usageLimits, limits: usageLimits }),
    ]) {
      assert.ok(order.safeParse(leaked).success);
      assert.equal(strictOutput(order).safeParse(leaked).success, false);
    }
    for (const field of ["schema", "available_instruments", "config"] as const) {
      const { [field]: _gone, ...without } = handler;
      assert.equal(order.safeParse(withHandler(without)).success, false, field);
    }
    assert.equal(
      order.safeParse(withHandler({ ...handler, config: { environment: "testmode" } })).success,
      false,
    );
    // The usage limits are Stripe's object, whole: its three names, its value types.
    for (const field of ["max_amount", "currency", "expires_at"] as const) {
      const { [field]: _gone, ...without } = usageLimits;
      assert.equal(order.safeParse(withHandler(handler, without)).success, false, field);
    }
    assert.equal(order.safeParse(withHandler(handler, null)).success, false);
    assert.equal(order.safeParse(withHandler(handler, { ...usageLimits, max_amount: 132.4 })).success, false);
    assert.equal(order.safeParse(withHandler(handler, { ...usageLimits, expires_at: "2026-10-25T08:00:00Z" })).success, false);
    // expires_at is Unix seconds: a plausible instant, never milliseconds, zero or a fraction.
    for (const expires_at of [1_000_000_000, 1_600_000_000, 1792915200, 9_999_999_999]) {
      parsesBoth(order, withHandler(handler, { ...usageLimits, expires_at }));
    }
    for (const expires_at of [0, -1, 999_999_999, 10_000_000_000, 1792915200000, 1792915200.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(order.safeParse(withHandler(handler, { ...usageLimits, expires_at })).success, false, String(expires_at));
    }
    // The 5.x names are not the token's.
    assert.equal(order.safeParse(withHandler(handler, { maxAmount: 13240, currency: "usd", expiresAt: "2026-10-25T08:00:00Z" })).success, false);
  });

  it("an order's payment: a token or null, always said, and nothing of a method list or a charge currency", () => {
    parsesBoth(order, orderFixture);
    const { tokenRequest: _gone, ...without } = orderFixture.payment;
    assert.equal(order.safeParse({ ...orderFixture, payment: without }).success, false);
    for (const gone of [{ methods: [] }, { chargeCurrency: "USD" }]) {
      assert.equal(strictOutput(order).safeParse({ ...orderFixture, payment: { ...orderFixture.payment, ...gone } }).success, false);
    }
    const payment = (jsonSchemaOf(order).properties as Record<string, JsonSchema>).payment!;
    assert.deepEqual(Object.keys(payment.properties as Record<string, unknown>), [
      "status",
      "url",
      "requiresSignIn",
      "expiresAt",
      "localCurrencyAtCheckout",
      "localCharge",
      "tokenRequest",
    ]);
  });

  it("an order's total is the order's own, not under price", () => {
    const { total: _total, ...without } = orderFixture;
    assert.equal(order.safeParse(without).success, false);
    assert.equal(order.safeParse({ ...without, price: { total: orderFixture.total } }).success, false);
    assert.equal(strictOutput(order).safeParse({ ...orderFixture, price: { total: orderFixture.total } }).success, false);
  });

  it("an order's rooms each carry the party, the guests, the room type and the meals", () => {
    const [item] = orderFixture.items;
    const [room] = item!.hotel.rooms;
    const withRoom = (r: unknown) => ({ ...orderFixture, items: [{ ...item, hotel: { ...item!.hotel, rooms: [r] } }] });
    parsesBoth(order, withRoom(room));
    // Rooms can differ: each has its own type and meals.
    parsesBoth(order, {
      ...orderFixture,
      items: [
        {
          ...item,
          hotel: {
            ...item!.hotel,
            rooms: [room, { ...room, guests: null, roomType: { ...room!.roomType, name: null }, meals: { ...meals, included: [] } }],
          },
        },
      ],
    });
    for (const field of ["roomType", "meals", "guests", "adults"] as const) {
      const { [field]: _gone, ...without } = room!;
      assert.equal(order.safeParse(withRoom(without)).success, false, field);
    }
    // A room type is always an object; a fact not on record is null inside it.
    assert.equal(order.safeParse(withRoom({ ...room, roomType: null })).success, false);
    // The item holds no room or meals of its own.
    for (const gone of [{ room: { name: null, beds: null } }, { meals }]) {
      const leaked = { ...orderFixture, items: [{ ...item, hotel: { ...item!.hotel, ...gone } }] };
      assert.equal(strictOutput(order).safeParse(leaked).success, false, Object.keys(gone)[0]);
    }
  });

  it("an order's hotel item carries the stay's terms by an offer's names", () => {
    const [item] = orderFixture.items;
    const hotelWith = (change: object) => ({ ...orderFixture, items: [{ ...item, hotel: { ...item!.hotel, ...change } }] });
    // A confirmation mode not on record is null.
    parsesBoth(order, hotelWith({ confirmation: null }));
    for (const field of ["cancellation", "confirmation", "payAtProperty"] as const) {
      const { [field]: _gone, ...without } = item!.hotel;
      assert.equal(order.safeParse({ ...orderFixture, items: [{ ...item, hotel: without }] }).success, false, field);
      assert.ok(field in offerFixture, field);
    }
    assert.equal(order.safeParse(hotelWith({ cancellation: null })).success, false);
  });

  it("an order's cancel: an action, or what blocks both", () => {
    parsesBoth(order, { ...orderFixture, status: "confirmed", cancel: cancelNow });
    parsesBoth(order, { ...orderFixture, cancel: { action: "close", blockedBy: null, penalty: null, refund: null } });
    for (const reason of CANCEL_BLOCKERS) parsesBoth(orderCancel, blockedBy(reason));
    // A paid order past its free deadline: the whole total kept, nothing refunded.
    parsesBoth(orderCancel, { ...cancelNow, penalty: usd("132.40"), refund: usd("0.00") });
    // Both stay open: an action or a blocker this contract doesn't know reads.
    assert.ok(orderCancel.safeParse(blockedBy("later")).success);
    assert.equal(strictOutput(orderCancel).safeParse(blockedBy("later")).success, false);
    assert.ok(orderCancel.safeParse({ action: "amend", blockedBy: null, penalty: null, refund: null }).success);
    // One situation each: an unpaid order whose time ran out is not one that was closed, and an
    // order a person at Fortrip is resolving is not a sound one only support can cancel.
    assert.deepEqual([...CANCEL_BLOCKERS], [
      "payment_in_progress",
      "website_checkout",
      "expired",
      "closed",
      "failed",
      "confirming",
      "cancelling",
      "already_cancelled",
      "stay_started",
      "cancellation_not_allowed",
      "cancellation_refused",
      "terms_unknown",
      "support_only",
      "needs_attention",
    ]);
    // An order always says it.
    const { cancel: _cancel, ...withoutCancel } = orderFixture;
    assert.equal(order.safeParse(withoutCancel).success, false);
    for (const field of ["action", "blockedBy", "penalty", "refund"] as const) {
      const { [field]: _gone, ...without } = cancelNow;
      assert.equal(orderCancel.safeParse(without).success, false, field);
    }
    // The 5.x values that were no reasons, and the one that meant four situations, are gone.
    for (const gone of ["cancellable", "unpaid", "not_confirmed", "in_progress"]) {
      assert.ok(!(CANCEL_BLOCKERS as readonly string[]).includes(gone), gone);
      assert.equal(strictOutput(orderCancel).safeParse(blockedBy(gone)).success, false, gone);
    }
    assert.equal(strictOutput(order).safeParse({ ...orderFixture, cancel: { available: true, reason: "unpaid", penalty: null, refund: null } }).success, false);
  });

  it("an order's cancel holds exactly one of action and blockedBy, and figures only with action cancel", () => {
    const refused: unknown[] = [
      { action: null, blockedBy: null, penalty: null, refund: null },
      { ...cancelNow, blockedBy: "stay_started" },
      { action: "close", blockedBy: "payment_in_progress", penalty: null, refund: null },
      // A penalty and a refund come with cancel, both, and only then.
      { action: "close", blockedBy: null, penalty: usd("0.00"), refund: null },
      { ...blockedBy("cancellation_not_allowed"), penalty: usd("132.40"), refund: usd("0.00") },
      { ...cancelNow, penalty: null },
      { ...cancelNow, refund: null },
      { ...cancelNow, penalty: null, refund: null },
    ];
    for (const cancel of refused) {
      assert.equal(orderCancel.safeParse(cancel).success, false, JSON.stringify(cancel));
      assert.equal(strictOutput(orderCancel).safeParse(cancel).success, false, JSON.stringify(cancel));
      assert.equal(order.safeParse({ ...orderFixture, cancel }).success, false, JSON.stringify(cancel));
      assert.equal(
        errorEnvelope.safeParse(envelope("order_not_cancellable", { orderId: ORD, cancel })).success,
        false,
        JSON.stringify(cancel),
      );
    }
  });

  // The rules above are for the actions this build knows. An action it does
  // not know is not held to them: the enum stays open, whatever comes with it.
  it("an order's cancel with an action this build does not know reads, whatever it carries", () => {
    const later: unknown[] = [
      { action: "amend", blockedBy: null, penalty: null, refund: null },
      { action: "amend", blockedBy: null, penalty: usd("20.00"), refund: usd("112.40") },
      { action: "amend", blockedBy: null, penalty: usd("20.00"), refund: null },
      { action: "amend", blockedBy: "later", penalty: null, refund: null },
    ];
    for (const cancel of later) {
      assert.ok(orderCancel.safeParse(cancel).success, JSON.stringify(cancel));
      assert.ok(order.safeParse({ ...orderFixture, status: "confirmed", cancel }).success, JSON.stringify(cancel));
      assert.ok(orderList.safeParse({ data: [orderFixture, { ...orderFixture, cancel }], nextCursor: null }).success);
      assert.ok(errorEnvelope.safeParse(envelope("order_not_cancellable", { orderId: ORD, cancel })).success, JSON.stringify(cancel));
      // The strict copy knows only this build's actions.
      assert.equal(strictOutput(orderCancel).safeParse(cancel).success, false, JSON.stringify(cancel));
    }
  });

  it("a cancelled order's figures, and a failed order's reason", () => {
    const cancelled = { at: "2026-10-26T09:41:00Z", penalty: usd("66.20"), refund: usd("66.20") };
    parsesBoth(order, { ...orderFixture, status: "cancelled", cancel: blockedBy("already_cancelled"), cancelled });
    // Not on record: null, never figures of zero.
    parsesBoth(order, { ...orderFixture, status: "cancelled", cancel: blockedBy("already_cancelled"), cancelled: null });
    for (const field of ["at", "penalty", "refund"] as const) {
      const { [field]: _gone, ...without } = cancelled;
      assert.equal(order.safeParse({ ...orderFixture, cancelled: without }).success, false, field);
    }
    for (const reason of FAILURE_REASONS) {
      parsesBoth(order, { ...orderFixture, status: "failed", cancel: blockedBy("failed"), failure: { reason } });
    }
    // What the server can tell apart: not a sold-out room from a rate gone, nor a refusal for the details.
    assert.deepEqual([...FAILURE_REASONS], ["rate_unavailable", "hotel_refused", "unknown"]);
    const later = { ...orderFixture, status: "failed", cancel: blockedBy("failed"), failure: { reason: "later" } };
    assert.ok(order.safeParse(later).success);
    assert.equal(strictOutput(order).safeParse(later).success, false);
    assert.equal(order.safeParse({ ...orderFixture, failure: {} }).success, false);
    // A failed order always says why: a reason not on record is `unknown`, never a null failure.
    const failed = { ...orderFixture, status: "failed", cancel: blockedBy("failed") };
    assert.equal(order.safeParse({ ...failed, failure: null }).success, false);
    assert.equal(strictOutput(order).safeParse({ ...failed, failure: null }).success, false);
    assert.equal(orderList.safeParse({ data: [{ ...failed, failure: null }], nextCursor: null }).success, false);
    parsesBoth(order, { ...failed, failure: { reason: "unknown" } });
    // Every other status has none, and a status this build does not know is not held to the rule.
    parsesBoth(order, { ...orderFixture, failure: null });
    assert.ok(order.safeParse({ ...orderFixture, status: "later", failure: null }).success);
    // An order always says both, null when they don't apply.
    for (const field of ["cancelled", "failure"] as const) {
      const { [field]: _gone, ...without } = orderFixture;
      assert.equal(order.safeParse(without).success, false, field);
    }
  });

  it("order_not_cancellable carries the order's cancel, the same object", () => {
    assert.equal(ERROR_DETAILS.order_not_cancellable.shape.cancel._zod.def, orderCancel._zod.def);
    for (const cancel of [cancelNow, { action: "close", blockedBy: null, penalty: null, refund: null }, blockedBy("stay_started")]) {
      parsesBoth(errorEnvelope, envelope("order_not_cancellable", { orderId: ORD, cancel }));
      // It names its order: the call it leads to is that order's.
      assert.equal(errorEnvelope.safeParse(envelope("order_not_cancellable", { cancel })).success, false);
    }
    assert.equal(errorEnvelope.safeParse(envelope("order_not_cancellable", { reason: "stay_started" })).success, false);
  });

  it("an error's locator is pointer, on the error and on each issue", () => {
    const located = envelope("invalid_request", ERROR_FIXTURES.invalid_request);
    parsesBoth(errorEnvelope, { error: { ...located.error, pointer: "/filters/amenities/0" } });
    assert.equal(strictOutput(errorEnvelope).safeParse({ error: { ...located.error, param: "/filters" } }).success, false);
    // The amenities refusal's own details are gone with it.
    for (const gone of [{ filterable: ["parking"] }, { share: { code: "spa", listedShare: 0.1 } }]) {
      const details = { ...(ERROR_FIXTURES.invalid_request as object), ...gone };
      assert.equal(strictOutput(errorEnvelope).safeParse(envelope("invalid_request", details)).success, false);
    }
  });

  it("every change field", () => {
    for (const [field, value] of [
      ["meals", meals],
      ["cancellation", cancellation],
      ["confirmation", confirmation],
      ["payAtProperty", payAtProperty],
    ] as const) {
      parsesBoth(offerChange, { field, previous: value, current: value, worse: false });
    }
    parsesBoth(offerChange, totalChange);
    // The field is the offer's key that changed: the 5.x names read as unknown ones.
    for (const field of ["price", "pay_at_property"]) {
      const change = { field, previous: 1, current: 2, worse: false };
      assert.ok(offerChange.safeParse(change).success, field);
      assert.equal(strictOutput(offerChange).safeParse(change).success, false, field);
    }
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
    const fee = { ...payAtProperty.items[0], kind: "parking_fee" };
    const withFee = { ...offerFixture, payAtProperty: { ...payAtProperty, items: [fee] } };
    assert.ok(offer.safeParse(withFee).success);
    assert.equal(strictOutput(offer).safeParse(withFee).success, false);
    assert.ok(offerChange.safeParse({ field: "room", previous: 1, current: 2 }).success);
    assert.ok(errorEnvelope.safeParse(envelope("teapot", { x: 1 })).success);
  });

  it("fails a malformed known branch instead of falling back", () => {
    assert.equal(
      offerChange.safeParse({ field: "total", previous: "132.40", current: usd("1.00"), worse: true }).success,
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
  "address", "adults", "available_instruments", "allInclusive", "amenities", "amount", "areaSqm",
  "basis", "beds", "business_profile", "bookable", "breakfastServed", "byCallLimit", "byFilters", "byLimit", "byNationality",
  "cancel", "cancellation", "candidates", "candidatesTotal", "caption", "center", "changes",
  "checkIn", "checkInTimes", "checkOut", "checkOutTimes", "childrenAges", "cityLike", "clientId",
  "code", "config", "confirmation", "confirmationNumber", "contact", "count", "countryCode",
  "coverage", "covers", "createdAt", "currency", "currencyHint", "current", "data", "declineCode", "deposit", "description", "destination",
  "details", "deviceAuthorizationEndpoint", "disclosure", "distanceMeters", "dominated", "email",
  "en", "environment", "error", "excludedNoFacilityData", "excludedNoPrice", "expiredAt", "expiresAt", "field",
  "firstName", "freeCancellationEndsAt", "from", "fromPerRoomNight", "fromPerRoomStay",
  "guests", "guestsCoveredPerRoom", "handler", "hotel", "hotelId", "hotels", "id", "included", "includes", "indicativePrice",
  "issuer", "issues", "items", "kind", "known", "label", "lastName", "lat", "line", "listed",
  "lng", "localCharge", "localCurrencyAtCheckout", "locale", "localities", "locality", "localityTotal", "location",
  "manageUrl", "mandatory", "matched", "max", "maxOccupancy", "meals", "members",
  "message", "min", "mode", "more", "name", "nameAsText", "names", "nextCursor",
  "notes", "offer", "offerId", "offers", "omitted", "orderId", "otherMatches", "outcome",
  "payAtProperty", "payment", "penalties", "penalty", "perRoomNight", "phone", "photo", "photos", "place", "placeId",
  "pointer", "policies", "poolLimit", "poolRadiusMeters", "population", "previous",
  "priced", "pricing", "radiusMeters", "radiusSource", "rateLimit", "readAt", "reason", "reference", "refund",
  "region", "requestId", "required", "requiresSignIn", "resolution", "retryAfterSeconds",
  "retryable", "revocationEndpoint", "roomCount", "roomType", "roomTypes", "rooms", "schema", "scope", "scopes",
  "sort", "spec", "specialRequests", "stars", "startsAt", "status", "stay", "text", "textAnywhere", "timeZone",
  "tokenEndpoint", "topic", "total", "type", "unassigned", "unavailable", "unreadable",
  "unspecifiedMainMeals", "until", "updatedAt", "url", "userId", "version", "website", "window",
  "withPrice", "withinMaxRadius", "withinMinutes", "worse", "zh",
  // Orders and errors in 6.0.
  "action", "at", "blockedBy", "cancelled", "expires_at", "failure", "limitPerHotel", "max_amount", "tokenRequest", "usageLimits",
  // A search note's details.
  "places",
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
  it("the payment token says when it is null, its cap from LIMITS", () => {
    const text = descriptionAt(order, "payment.tokenRequest") ?? "";
    assert.match(text, /^What to request a Stripe shared payment token with, for pay_order\. null when no token can pay this order: /);
    assert.match(text, /a CNY order, an order from the Fortrip website's own checkout, /);
    assert.ok(text.includes(`a total over $${LIMITS.tokenPaymentMaxUsd}`), text);
    assert.match(text, /then the user pays by url\.$/);
  });

  it("the usage limits say they go into the token request as they are, each in Stripe's unit", () => {
    assert.match(
      descriptionAt(order, "payment.tokenRequest.usageLimits") ?? "",
      /^Stripe's usage limits for the token: copy these values as they are into the token request\.$/,
    );
    assert.match(descriptionAt(order, "payment.tokenRequest.usageLimits.max_amount") ?? "", /minor unit \(cents for usd\)/);
    assert.match(descriptionAt(order, "payment.tokenRequest.usageLimits.currency") ?? "", /lowercase/);
    assert.match(descriptionAt(order, "payment.tokenRequest.usageLimits.expires_at") ?? "", /Unix seconds/);
  });

  it("cancel explains each action and everything that blocks both; failure, every reason", () => {
    const action = descriptionAt(order, "cancel.action") ?? "";
    for (const value of ["cancel: ", "close: ", "null: "]) assert.ok(action.includes(value), value);
    const blocked = descriptionAt(order, "cancel.blockedBy") ?? "";
    for (const value of CANCEL_BLOCKERS) assert.ok(blocked.includes(value), value);
    const reason = descriptionAt(order, "failure.reason") ?? "";
    for (const value of FAILURE_REASONS) assert.ok(reason.includes(`${value}: `), value);
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
        "hotels.offers.total",
        "hotels.offers.perRoomNight",
        "hotels.offers.roomType",
        "hotels.offers.cancellation",
        "hotels.offers.cancellation.readAt",
        "hotels.offers.meals",
        "hotels.offers.meals.unspecifiedMainMeals",
        "hotels.offers.meals.guestsCoveredPerRoom",
        "hotels.offers.payAtProperty",
        "hotels.offers.payAtProperty.items.kind",
        "hotels.omitted",
        "hotels.omitted.byNationality",
        "hotels.omitted.byFilters",
        "hotels.omitted.dominated",
        "hotels.omitted.unreadable",
        "hotels.omitted.byLimit",
        "hotels.omitted.byCallLimit",
        "unavailable.reason",
      ],
    ],
    [
      "order",
      order,
      [
        "status",
        "total",
        "items.hotel.rooms.roomType",
        "items.hotel.rooms.meals",
        "items.hotel.cancellation",
        "items.hotel.confirmation",
        "items.hotel.payAtProperty",
        "payment.expiresAt",
        "payment.localCurrencyAtCheckout",
        "payment.localCharge",
        "payment.tokenRequest",
        "cancel",
        "cancel.penalty",
        "cancel.refund",
        "cancelled",
        "failure",
      ],
    ],
    [
      "search",
      searchResult,
      [
        "text",
        "destination.scope",
        "pricing.covers",
        "currencyHint",
        "data.indicativePrice",
        "data.indicativePrice.fromPerRoomNight",
        "data.indicativePrice.fromPerRoomStay",
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
    ["hotel", hotel, ["roomTypes"]],
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

  it("an offer's perRoomNight is the total divided by rooms and nights, for comparison only", () => {
    const text = descriptionAt(hotelOffersResult, "hotels.offers.perRoomNight") ?? "";
    assert.match(text, /^total divided by the rooms and the nights, rounded to cents: for comparison only\./);
    assert.match(text, /need not multiply back to total, which is what is charged\.$/);
    assert.match(descriptionAt(hotelOffersResult, "hotels.offers.total") ?? "", /what is charged/);
  });

  it("a search price says it is an estimate from a price floor, and what that leaves out", () => {
    const text = descriptionAt(searchResult, "data.indicativePrice") ?? "";
    for (const part of [/estimate/, /price floor/, /not a price for this party/, /bed in a shared room/, /days old/, /Not bookable/]) {
      assert.match(text, part);
    }
  });

  it("a null currencyHint says nothing about where the user is", () => {
    assert.match(
      descriptionAt(searchResult, "currencyHint") ?? "",
      /null when there is none, which says nothing about where the user is\.$/,
    );
  });

  it("says of each fee kind what it is, and of the offers a call's hotels share that a call for the hotel alone shows them", () => {
    const kind = descriptionAt(hotelOffersResult, "hotels.offers.payAtProperty.items.kind") ?? "";
    for (const value of FEE_KINDS) assert.ok(kind.includes(value), value);
    const shared = descriptionAt(hotelOffersResult, "hotels.omitted.byCallLimit") ?? "";
    assert.ok(shared.includes(`share ${LIMITS.offersPerCallDefault} offers in all (${LIMITS.offersPerCallMax} when limitPerHotel is given)`), shared);
    assert.match(shared, /a call for this hotel alone shows this many more\.$/);
  });

  it("scope is a search's destination scope and nothing else of a search", () => {
    const found: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (key === "properties" && value && typeof value === "object") {
          for (const name of Object.keys(value)) if (name === "scope") found.push(path);
          for (const [name, child] of Object.entries(value)) walk(child, `${path}.${name}`);
        } else {
          walk(value, path);
        }
      }
    };
    walk(jsonSchemaOf(searchResult), "search");
    walk(jsonSchemaOf(ERROR_DETAILS.destination_ambiguous), "destination_ambiguous");
    assert.deepEqual([...new Set(found)], ["search.destination"]);
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
