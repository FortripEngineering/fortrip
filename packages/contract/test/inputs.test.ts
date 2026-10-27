import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { CARD_NUMBER_MESSAGE } from "../src/card-number.ts";
import { addIsoDateDays } from "../src/dates.ts";
import { GUEST_NAME_MESSAGE } from "../src/guest-name.ts";
import {
  cancelOrderInput,
  createOrderInput,
  createSearchHotelsInput,
  destination,
  getHotelInput,
  getOrderInput,
  hotelOffersInput,
  listOrdersInput,
  searchHotelsInput,
  stay,
} from "../src/inputs.ts";
import { LIMITS } from "../src/limits.ts";
import { AMENITY_CODES, FILTERABLE_AMENITIES } from "../src/vocabulary.ts";

// The production bundle never runs zod's `config(en())`: every message
// asserted here must be our own.
z.config({ localeError: undefined });

type Issue = { path: string; message: string };

function issuesOf(schema: z.ZodType, value: unknown): Issue[] | null {
  const result = schema.safeParse(value);
  return result.success
    ? null
    : result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
}

/** The issues for `value`; fails if it passes or an issue reads "Invalid input". */
function refusalOf(schema: z.ZodType, value: unknown): Issue[] {
  const issues = issuesOf(schema, value);
  assert.ok(issues, `should fail: ${JSON.stringify(value)}`);
  for (const issue of issues) {
    assert.notEqual(issue.message, "Invalid input", JSON.stringify(value));
  }
  return issues;
}

function assertAccepted(schema: z.ZodType, value: unknown) {
  assert.equal(issuesOf(schema, value), null, JSON.stringify(value));
}

function assertRefusedAt(schema: z.ZodType, value: unknown, path: string) {
  const issues = refusalOf(schema, value);
  assert.ok(
    issues.some((issue) => issue.path === path),
    `expected an issue at "${path}", got ${JSON.stringify(issues)}`,
  );
}

const today = new Date().toISOString().slice(0, 10);
const checkIn = addIsoDateDays(today, 30);
const checkOut = addIsoDateDays(today, 32);
const room = { adults: 2, childrenAges: [] };
const goodStay = { checkIn, checkOut, rooms: [room] };
const tokyo = {
  kind: "place_name",
  name: "Tokyo",
  countryCode: "JP",
} as const;
const hotel = "htl_aaaaaaaaaaaaaaaaaaaa";
const offer = "off_aaaaaaaaaaaaaaaaaaaa";
const VISA = "4111 1111 1111 1111";

type Json = {
  description?: string;
  properties?: Record<string, Json>;
  items?: Json;
  anyOf?: Json[];
  oneOf?: Json[];
  [key: string]: unknown;
};

/** Dotted paths of every property that has no description, branches of a union included. */
function undescribed(schema: Json, prefix = ""): string[] {
  const missing: string[] = [];
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const path = `${prefix}${name}`;
    if (!property.description?.trim()) missing.push(path);
    missing.push(...undescribed(property, `${path}.`));
  }
  if (schema.items) missing.push(...undescribed(schema.items, `${prefix}[].`));
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
    missing.push(...undescribed(branch, prefix));
  }
  return missing;
}

describe("every request field has a description", () => {
  for (const [name, schema] of [
    ["searchHotelsInput", searchHotelsInput],
    ["getHotelInput", getHotelInput],
    ["hotelOffersInput", hotelOffersInput],
    ["createOrderInput", createOrderInput],
    ["getOrderInput", getOrderInput],
    ["listOrdersInput", listOrdersInput],
    ["cancelOrderInput", cancelOrderInput],
    ["stay", stay],
    ["destination", destination],
  ] as const) {
    it(name, () => {
      const json = z.toJSONSchema(schema, { io: "input" }) as Json;
      assert.deepEqual(undescribed(json), []);
    });
  }

  it("reaches nested fields, array items and union branches", () => {
    const search = z.toJSONSchema(searchHotelsInput, { io: "input" }) as Json;
    assert.ok(search.properties?.filters?.properties?.stars?.properties?.min);
    assert.ok(search.properties?.stay?.properties?.rooms?.items);
    const order = z.toJSONSchema(createOrderInput, { io: "input" }) as Json;
    assert.ok(
      order.properties?.items?.items?.properties?.hotel?.properties?.rooms
        ?.items?.properties?.guests?.items?.properties?.firstName?.description,
    );
  });
});

describe("amenity codes", () => {
  it("the filterable ones come first and are the nine of §7.7", () => {
    assert.deepEqual(
      [...FILTERABLE_AMENITIES],
      [
        "parking",
        "wifi",
        "laundry",
        "restaurant",
        "room_service",
        "bar",
        "non_smoking",
        "business_center",
        "pool",
      ],
    );
    assert.deepEqual(AMENITY_CODES.slice(0, 9), FILTERABLE_AMENITIES);
    assert.deepEqual(AMENITY_CODES.slice(9), [
      "airport_shuttle",
      "spa",
      "gym",
      "accessible",
      "ev_charging",
      "air_conditioning",
      "pets_allowed",
      "kitchen",
      "other",
    ]);
  });
});

describe("stay", () => {
  it("accepts one to eight rooms and 1 to 30 nights", () => {
    assertAccepted(stay, goodStay);
    assertAccepted(stay, {
      checkIn,
      checkOut: addIsoDateDays(checkIn, 30),
      rooms: Array.from({ length: 8 }, () => ({
        adults: 8,
        childrenAges: [0, 17, 5, 5],
      })),
    });
  });

  it("refuses a bad party", () => {
    assertRefusedAt(stay, { ...goodStay, rooms: [] }, "rooms");
    assertRefusedAt(
      stay,
      { ...goodStay, rooms: Array.from({ length: 9 }, () => room) },
      "rooms",
    );
    assertRefusedAt(
      stay,
      { ...goodStay, rooms: [{ adults: 0, childrenAges: [] }] },
      "rooms.0.adults",
    );
    assertRefusedAt(
      stay,
      { ...goodStay, rooms: [{ adults: 9, childrenAges: [] }] },
      "rooms.0.adults",
    );
    assertRefusedAt(
      stay,
      { ...goodStay, rooms: [{ adults: 2, childrenAges: [1, 2, 3, 4, 5] }] },
      "rooms.0.childrenAges",
    );
    assertRefusedAt(
      stay,
      { ...goodStay, rooms: [{ adults: 2, childrenAges: [18] }] },
      "rooms.0.childrenAges.0",
    );
    assertRefusedAt(
      stay,
      { ...goodStay, rooms: [{ adults: 2 }] },
      "rooms.0.childrenAges",
    );
  });

  it("refuses 0 and 31 nights, and a date that is not a date", () => {
    assertRefusedAt(stay, { ...goodStay, checkOut: checkIn }, "checkOut");
    assertRefusedAt(
      stay,
      { ...goodStay, checkOut: addIsoDateDays(checkIn, 31) },
      "checkOut",
    );
    assertRefusedAt(stay, { ...goodStay, checkIn: "2026-02-30" }, "checkIn");
  });

  it("names an unknown key", () => {
    const issues = refusalOf(stay, { ...goodStay, nights: 2 });
    assert.equal(issues[0]?.message, "Unknown argument(s): nights");
  });
});

describe("destination", () => {
  it("accepts each of the five kinds", () => {
    for (const value of [
      tokyo,
      { ...tokyo, radiusMeters: 500 },
      { kind: "place", placeId: "plc_1850147" },
      { kind: "place", placeId: "plc_1850147", radiusMeters: 80_000 },
      { kind: "point", location: { lat: 35.68, lng: 139.69 }, radiusMeters: 1 },
      { kind: "country", countryCode: "JP" },
      { kind: "locality", placeId: "plc_1", radiusMeters: 8_000 },
    ]) {
      assertAccepted(destination, value);
    }
  });

  it("holds the radius to 1 to 80000 meters", () => {
    for (const radiusMeters of [80_001, 0, -1, 1.5, "100"]) {
      assertRefusedAt(
        destination,
        { kind: "locality", placeId: "plc_1", radiusMeters },
        "radiusMeters",
      );
    }
  });

  it("refuses a country with a radius, a bad code, a bad place id and a bad point", () => {
    assert.equal(
      refusalOf(destination, {
        kind: "country",
        countryCode: "JP",
        radiusMeters: 5,
      })[0]?.message,
      "Unknown argument(s): radiusMeters",
    );
    assertRefusedAt(
      destination,
      { ...tokyo, countryCode: "jp" },
      "countryCode",
    );
    assertRefusedAt(
      destination,
      { ...tokyo, countryCode: "JPN" },
      "countryCode",
    );
    assertRefusedAt(destination, { ...tokyo, name: "" }, "name");
    assertRefusedAt(
      destination,
      { kind: "place", placeId: "1850147" },
      "placeId",
    );
    assertRefusedAt(
      destination,
      { kind: "point", location: { lat: 91, lng: 0 } },
      "location.lat",
    );
    assertRefusedAt(
      destination,
      { kind: "point", location: { lat: 0, lng: 181 } },
      "location.lng",
    );
  });

  it("answers an unknown kind by listing the kinds", () => {
    const issues = refusalOf(destination, { kind: "city", name: "x" });
    assert.match(
      issues[0]?.message ?? "",
      /place_name, place, point, country, locality/,
    );
    refusalOf(destination, "Tokyo");
  });
});

describe("searchHotelsInput", () => {
  it("accepts a destination or text, with or without a stay", () => {
    assertAccepted(searchHotelsInput, { destination: tokyo });
    assertAccepted(searchHotelsInput, { text: "ritz" });
    assertAccepted(searchHotelsInput, { destination: tokyo, stay: goodStay });
    assertAccepted(searchHotelsInput, {
      destination: tokyo,
      stay: goodStay,
      pricing: "indicative",
      filters: {
        stars: { min: 3.5, max: 5 },
        amenities: ["pool", "spa"],
        price: { maxPerRoomNight: { amount: "200.00", currency: "USD" } },
      },
      sort: "price_asc",
      limit: 50,
      locale: "zh",
      displayCurrency: "CNY",
    });
  });

  it("needs a destination or text on a first page", () => {
    assertRefusedAt(searchHotelsInput, {}, "destination");
    assertRefusedAt(searchHotelsInput, { stay: goodStay }, "destination");
    assertRefusedAt(searchHotelsInput, { text: "  " }, "text");
    assertRefusedAt(
      searchHotelsInput,
      { text: "x".repeat(LIMITS.textLength + 1) },
      "text",
    );
  });

  it("a next page is a cursor and a limit only", () => {
    assertAccepted(searchHotelsInput, { cursor: "c" });
    assertAccepted(searchHotelsInput, { cursor: "c", limit: 10 });
    assertRefusedAt(searchHotelsInput, { cursor: "c", text: "x" }, "text");
    assertRefusedAt(
      searchHotelsInput,
      { cursor: "c", destination: tokyo },
      "destination",
    );
    assertRefusedAt(
      searchHotelsInput,
      { cursor: "c", sort: "distance" },
      "sort",
    );
    assertRefusedAt(searchHotelsInput, { cursor: "c", locale: "en" }, "locale");
    assertRefusedAt(searchHotelsInput, { cursor: "" }, "cursor");
  });

  it("limit runs from 1 to 50 and is not defaulted by the schema", () => {
    assertRefusedAt(searchHotelsInput, { text: "x", limit: 0 }, "limit");
    assertRefusedAt(searchHotelsInput, { text: "x", limit: 51 }, "limit");
    assertRefusedAt(searchHotelsInput, { text: "x", limit: 1.5 }, "limit");
    const parsed = searchHotelsInput.parse({ cursor: "c" });
    assert.equal("limit" in parsed ? parsed.limit : undefined, undefined);
  });

  it("distance needs a destination and relevance needs text", () => {
    assertRefusedAt(searchHotelsInput, { text: "x", sort: "distance" }, "sort");
    assertAccepted(searchHotelsInput, {
      destination: tokyo,
      sort: "distance",
    });
    assertRefusedAt(
      searchHotelsInput,
      { destination: tokyo, sort: "relevance" },
      "sort",
    );
    assertAccepted(searchHotelsInput, { text: "x", sort: "relevance" });
    assertRefusedAt(searchHotelsInput, { text: "x", sort: "cheapest" }, "sort");
  });

  it("price sorts and the price filter need indicative pricing, which needs a stay", () => {
    const price = { maxPerRoomNight: { amount: "200", currency: "USD" } };
    assertRefusedAt(
      searchHotelsInput,
      { destination: tokyo, sort: "price_asc" },
      "sort",
    );
    assertRefusedAt(
      searchHotelsInput,
      {
        destination: tokyo,
        stay: goodStay,
        pricing: "none",
        sort: "price_desc",
      },
      "sort",
    );
    assertRefusedAt(
      searchHotelsInput,
      {
        destination: tokyo,
        stay: goodStay,
        pricing: "none",
        filters: { price },
      },
      "filters.price",
    );
    assertRefusedAt(
      searchHotelsInput,
      { destination: tokyo, filters: { price } },
      "filters.price",
    );
    assertAccepted(searchHotelsInput, {
      destination: tokyo,
      stay: goodStay,
      filters: { price },
      sort: "price_desc",
    });
    assertRefusedAt(
      searchHotelsInput,
      { destination: tokyo, pricing: "indicative" },
      "stay",
    );
    assertAccepted(searchHotelsInput, {
      destination: tokyo,
      stay: goodStay,
      pricing: "none",
    });
  });

  it("the price filter is USD", () => {
    assertRefusedAt(
      searchHotelsInput,
      {
        destination: tokyo,
        stay: goodStay,
        filters: {
          price: { maxPerRoomNight: { amount: "200", currency: "CNY" } },
        },
      },
      "filters.price.maxPerRoomNight.currency",
    );
  });

  it("stars run from 1 to 5 in half steps, min not above max", () => {
    for (const stars of [{ min: 4 }, { max: 4.5 }, { min: 1, max: 1 }, {}]) {
      assertAccepted(searchHotelsInput, { text: "x", filters: { stars } });
    }
    for (const [stars, path] of [
      [{ min: 0.5 }, "filters.stars.min"],
      [{ min: 3.7 }, "filters.stars.min"],
      [{ max: 5.5 }, "filters.stars.max"],
      [{ min: 4, max: 3 }, "filters.stars.max"],
    ] as const) {
      assertRefusedAt(
        searchHotelsInput,
        { text: "x", filters: { stars } },
        path,
      );
    }
  });

  it("amenities take any amenity code, up to nine", () => {
    assertAccepted(searchHotelsInput, {
      text: "x",
      filters: { amenities: ["spa"] },
    });
    assertAccepted(searchHotelsInput, {
      text: "x",
      filters: { amenities: [...FILTERABLE_AMENITIES] },
    });
    const sauna = refusalOf(searchHotelsInput, {
      text: "x",
      filters: { amenities: ["sauna"] },
    });
    assert.ok(sauna.some((i) => i.path === "filters.amenities.0"));
    assert.match(sauna[0]?.message ?? "", /pool/);
    assertRefusedAt(
      searchHotelsInput,
      { text: "x", filters: { amenities: AMENITY_CODES.slice(0, 10) } },
      "filters.amenities",
    );
  });

  it("refuses a past check-in at UTC-12, with the clock injectable", () => {
    // 2026-10-24 11:59Z is still 2026-10-23 at UTC-12.
    const at = (iso: string) => createSearchHotelsInput(() => Date.parse(iso));
    const input = (date: string) => ({
      destination: tokyo,
      stay: { checkIn: date, checkOut: addIsoDateDays(date, 1), rooms: [room] },
    });
    const early = at("2026-10-24T11:59:00Z");
    assertAccepted(early, input("2026-10-23"));
    assertRefusedAt(early, input("2026-10-22"), "stay.checkIn");
    const later = at("2026-10-24T12:00:00Z");
    assertRefusedAt(later, input("2026-10-23"), "stay.checkIn");
    assertAccepted(later, input("2026-10-24"));
  });

  it("the default instance reads the real clock", () => {
    assertRefusedAt(
      searchHotelsInput,
      {
        destination: tokyo,
        stay: { checkIn: "2020-01-01", checkOut: "2020-01-02", rooms: [room] },
      },
      "stay.checkIn",
    );
  });

  it("a party with different rooms is fine, and so is a stay of 30 nights", () => {
    assertAccepted(searchHotelsInput, {
      destination: tokyo,
      stay: {
        checkIn,
        checkOut: addIsoDateDays(checkIn, 30),
        rooms: [room, { adults: 1, childrenAges: [3] }],
      },
    });
  });

  it("names an unknown key", () => {
    assert.equal(
      refusalOf(searchHotelsInput, { text: "x", page: 2 })[0]?.message,
      "Unknown argument(s): page",
    );
    assert.equal(
      refusalOf(searchHotelsInput, {
        text: "x",
        filters: { brand: "hilton" },
      })[0]?.message,
      "Unknown argument(s): brand",
    );
  });
});

describe("getHotelInput", () => {
  it("takes a hotel id, include and locale", () => {
    assertAccepted(getHotelInput, { hotelId: hotel });
    assertAccepted(getHotelInput, {
      hotelId: hotel,
      include: "rooms",
      locale: "zh",
    });
    assertRefusedAt(getHotelInput, { hotelId: "12345" }, "hotelId");
    assertRefusedAt(
      getHotelInput,
      { hotelId: hotel, include: "photos" },
      "include",
    );
    assertRefusedAt(getHotelInput, { hotelId: hotel, locale: "fr" }, "locale");
    assert.equal(
      refusalOf(getHotelInput, { hotelId: hotel, rooms: true })[0]?.message,
      "Unknown argument(s): rooms",
    );
  });
});

describe("hotelOffersInput", () => {
  const base = { hotelIds: [hotel], stay: goodStay };

  it("accepts the full request and defaults limitPerHotel to 5", () => {
    assertAccepted(hotelOffersInput, {
      ...base,
      filters: { requireBreakfast: true, requireFreeCancellation: false },
      limitPerHotel: 20,
      locale: "en",
      displayCurrency: "USD",
    });
    assert.equal(hotelOffersInput.parse(base).limitPerHotel, 5);
    assert.equal(LIMITS.offersPerHotelDefault, 5);
  });

  it("holds hotelIds to 1 to 15, distinct", () => {
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => `htl_${String(i).padStart(20, "a")}`);
    assertAccepted(hotelOffersInput, { ...base, hotelIds: ids(15) });
    assertRefusedAt(hotelOffersInput, { ...base, hotelIds: [] }, "hotelIds");
    assertRefusedAt(
      hotelOffersInput,
      { ...base, hotelIds: ids(16) },
      "hotelIds",
    );
    assertRefusedAt(
      hotelOffersInput,
      { ...base, hotelIds: [hotel, hotel] },
      "hotelIds",
    );
    assertRefusedAt(
      hotelOffersInput,
      { ...base, hotelIds: ["12"] },
      "hotelIds.0",
    );
  });

  it("needs a stay, bounds limitPerHotel and is strict", () => {
    assertRefusedAt(hotelOffersInput, { hotelIds: [hotel] }, "stay");
    assertRefusedAt(
      hotelOffersInput,
      { ...base, limitPerHotel: 0 },
      "limitPerHotel",
    );
    assertRefusedAt(
      hotelOffersInput,
      { ...base, limitPerHotel: 21 },
      "limitPerHotel",
    );
    assertRefusedAt(
      hotelOffersInput,
      { ...base, filters: { requireBreakfast: "yes" } },
      "filters.requireBreakfast",
    );
    assert.equal(
      refusalOf(hotelOffersInput, { ...base, filters: { board: "BB" } })[0]
        ?.message,
      "Unknown argument(s): board",
    );
  });

  it("does not check the date against today: the service does, in the hotel's zone", () => {
    assertAccepted(hotelOffersInput, {
      hotelIds: [hotel],
      stay: { checkIn: "2020-01-01", checkOut: "2020-01-02", rooms: [room] },
    });
  });
});

describe("createOrderInput", () => {
  const guest = { firstName: "Wei", lastName: "Zhang" };
  const item = {
    offerId: offer,
    hotel: { rooms: [{ guests: [guest] }] },
  };
  const order = {
    contact: {
      firstName: "Wei",
      lastName: "Zhang",
      email: "wei@example.com",
      phone: "+86 138 0013 8000",
    },
    items: [item],
  };
  const withItem = (hotelPart: object) => ({
    ...order,
    items: [{ ...item, hotel: { ...item.hotel, ...hotelPart } }],
  });
  const withContact = (contact: object) => ({
    ...order,
    contact: { ...order.contact, ...contact },
  });

  it("accepts a complete order", () => {
    assertAccepted(createOrderInput, order);
    assertAccepted(
      createOrderInput,
      withItem({ specialRequests: "High floor" }),
    );
    assertAccepted(
      createOrderInput,
      withItem({
        rooms: [
          { guests: [guest, { firstName: "O’Brien", lastName: "St. John" }] },
          { guests: [guest] },
        ],
      }),
    );
  });

  it("takes exactly one item", () => {
    assertRefusedAt(
      createOrderInput,
      { ...order, items: [item, item] },
      "items",
    );
    assertRefusedAt(createOrderInput, { ...order, items: [] }, "items");
    assertRefusedAt(
      createOrderInput,
      { ...order, items: [{ ...item, offerId: "off_1" }] },
      "items.0.offerId",
    );
  });

  it("holds each contact name to 59 characters after normalizing", () => {
    assertAccepted(
      createOrderInput,
      withContact({ firstName: "a".repeat(59) }),
    );
    assertRefusedAt(
      createOrderInput,
      withContact({ firstName: "a".repeat(60) }),
      "contact.firstName",
    );
    assertRefusedAt(
      createOrderInput,
      withContact({ lastName: "a".repeat(60) }),
      "contact.lastName",
    );
    // 62 characters typed, 59 once the run of spaces collapses.
    assertAccepted(
      createOrderInput,
      withContact({ firstName: `${"a".repeat(30)}    ${"a".repeat(28)}` }),
    );
    assertRefusedAt(
      createOrderInput,
      withContact({ firstName: "   " }),
      "contact.firstName",
    );
    assertAccepted(
      createOrderInput,
      withContact({ firstName: "伟", lastName: "张" }),
    );
  });

  it("checks the contact email and phone", () => {
    assertRefusedAt(
      createOrderInput,
      withContact({ email: "wei" }),
      "contact.email",
    );
    assertRefusedAt(
      createOrderInput,
      withContact({ email: undefined }),
      "contact.email",
    );
    assertRefusedAt(
      createOrderInput,
      withContact({ phone: "12" }),
      "contact.phone",
    );
    assertRefusedAt(
      createOrderInput,
      withContact({ phone: "1".repeat(LIMITS.contactPhoneMax + 1) }),
      "contact.phone",
    );
  });

  it("holds guests to the guest-name rule", () => {
    for (const firstName of ["张伟", "José", "-Wei", "   "]) {
      assertRefusedAt(
        createOrderInput,
        withItem({ rooms: [{ guests: [{ firstName, lastName: "Zhang" }] }] }),
        "items.0.hotel.rooms.0.guests.0.firstName",
      );
    }
    const issues = refusalOf(
      createOrderInput,
      withItem({
        rooms: [{ guests: [{ firstName: "José", lastName: "Zhang" }] }],
      }),
    );
    assert.equal(issues[0]?.message, GUEST_NAME_MESSAGE);
    assertRefusedAt(
      createOrderInput,
      withItem({
        rooms: [{ guests: [{ firstName: "a".repeat(61), lastName: "Zhang" }] }],
      }),
      "items.0.hotel.rooms.0.guests.0.firstName",
    );
  });

  it("holds rooms and guests to their counts", () => {
    assertRefusedAt(
      createOrderInput,
      withItem({ rooms: [] }),
      "items.0.hotel.rooms",
    );
    assertRefusedAt(
      createOrderInput,
      withItem({
        rooms: Array.from({ length: 9 }, () => ({ guests: [guest] })),
      }),
      "items.0.hotel.rooms",
    );
    assertRefusedAt(
      createOrderInput,
      withItem({ rooms: [{ guests: [] }] }),
      "items.0.hotel.rooms.0.guests",
    );
    assertRefusedAt(
      createOrderInput,
      withItem({
        rooms: [{ guests: Array.from({ length: 13 }, () => guest) }],
      }),
      "items.0.hotel.rooms.0.guests",
    );
  });

  it("rejects a card number in every free-text field", () => {
    const requests = refusalOf(
      createOrderInput,
      withItem({ specialRequests: `Late arrival, card ${VISA}` }),
    );
    assert.equal(requests[0]?.path, "items.0.hotel.specialRequests");
    assert.equal(requests[0]?.message, CARD_NUMBER_MESSAGE);
    assertRefusedAt(
      createOrderInput,
      withItem({ specialRequests: "x".repeat(LIMITS.specialRequests + 1) }),
      "items.0.hotel.specialRequests",
    );
    assert.equal(
      refusalOf(createOrderInput, withContact({ firstName: VISA }))[0]?.message,
      CARD_NUMBER_MESSAGE,
    );
    assert.equal(
      refusalOf(createOrderInput, withContact({ lastName: VISA }))[0]?.message,
      CARD_NUMBER_MESSAGE,
    );
    assert.equal(
      refusalOf(createOrderInput, withContact({ phone: "4111111111111111" }))[0]
        ?.message,
      CARD_NUMBER_MESSAGE,
    );
    assert.equal(
      refusalOf(
        createOrderInput,
        withItem({
          rooms: [{ guests: [{ firstName: VISA, lastName: "Zhang" }] }],
        }),
      )[0]?.message,
      CARD_NUMBER_MESSAGE,
    );
    // A phone number is not a card.
    assertAccepted(createOrderInput, withContact({ phone: "+4915112345678" }));
  });

  it("names an unknown key at every level", () => {
    for (const value of [
      { ...order, note: 1 },
      withContact({ nationality: "CN" }),
      { ...order, items: [{ ...item, quantity: 1 }] },
      withItem({ breakfast: true }),
      withItem({ rooms: [{ guests: [guest], adults: 2 }] }),
      withItem({ rooms: [{ guests: [{ ...guest, roomNo: 1 }] }] }),
    ]) {
      assert.match(
        refusalOf(createOrderInput, value)[0]?.message ?? "",
        /^Unknown argument\(s\): /,
      );
    }
  });
});

describe("getOrderInput and listOrdersInput", () => {
  it("getOrderInput takes an order id and a locale", () => {
    assertAccepted(getOrderInput, { orderId: "ord_aaaaaaaaaaaaaaaaaaaa" });
    assertAccepted(getOrderInput, {
      orderId: "ord_aaaaaaaaaaaaaaaaaaaa",
      locale: "zh",
    });
    assertRefusedAt(getOrderInput, { orderId: hotel }, "orderId");
    assert.equal(
      refusalOf(getOrderInput, { orderId: "ord_aaaaaaaaaaaaaaaaaaaa", x: 1 })[0]
        ?.message,
      "Unknown argument(s): x",
    );
  });

  it("listOrdersInput takes a cursor, a limit of 1 to 50 and a locale", () => {
    assertAccepted(listOrdersInput, {});
    assertAccepted(listOrdersInput, { cursor: "c", limit: 50, locale: "en" });
    assertAccepted(listOrdersInput, { limit: "20" });
    assertRefusedAt(listOrdersInput, { limit: 0 }, "limit");
    assertRefusedAt(listOrdersInput, { limit: 51 }, "limit");
    assertRefusedAt(listOrdersInput, { limit: "" }, "limit");
    assertRefusedAt(listOrdersInput, { cursor: "" }, "cursor");
    assert.equal(
      refusalOf(listOrdersInput, { status: "confirmed" })[0]?.message,
      "Unknown argument(s): status",
    );
  });
});

describe("cancelOrderInput", () => {
  const orderId = "ord_aaaaaaaaaaaaaaaaaaaa";

  it("takes an order id and the penalty the user agreed to, 0 or more", () => {
    assertAccepted(cancelOrderInput, { orderId, maximumPenalty: 0 });
    assertAccepted(cancelOrderInput, { orderId, maximumPenalty: 12.5 });
    assertRefusedAt(cancelOrderInput, { orderId, maximumPenalty: -1 }, "maximumPenalty");
    assertRefusedAt(cancelOrderInput, { orderId }, "maximumPenalty");
    assertRefusedAt(cancelOrderInput, { orderId, maximumPenalty: "12.50" }, "maximumPenalty");
    assertRefusedAt(cancelOrderInput, { orderId: hotel, maximumPenalty: 0 }, "orderId");
    assert.equal(
      refusalOf(cancelOrderInput, { orderId, maximumPenalty: 0, refund: 1 })[0]?.message,
      "Unknown argument(s): refund",
    );
  });

  it("describes maximumPenalty as the order's cancel.penalty.amount", () => {
    const json = z.toJSONSchema(cancelOrderInput, { io: "input" }) as Json;
    assert.equal(
      json.properties?.maximumPenalty?.description,
      "The penalty the user agreed to: cancel.penalty.amount of the order, in its currency.",
    );
  });
});
