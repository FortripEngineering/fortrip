import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { CARD_NUMBER_MESSAGE, containsCardNumber } from "../src/card-number.ts";
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
  offersPerHotel,
  payOrderInput,
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
    ["payOrderInput", payOrderInput],
    ["stay", stay],
    ["destination", destination],
  ] as const) {
    it(name, () => {
      const json = z.toJSONSchema(schema, { io: "input" }) as Json;
      assert.deepEqual(undescribed(json), []);
      // A locality is a locality: "hub" is only the name of a field.
      assert.doesNotMatch(JSON.stringify(json), /"description":"[^"]*\bhubs?\b/i);
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
        amenities: ["pool", "wifi"],
        price: { maxPerRoomNight: { amount: "200.00", currency: "CNY" } },
      },
      sort: "price_asc",
      limit: 50,
      locale: "zh",
      currency: "CNY",
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

  it("the price filter is in the search's currency", () => {
    const price = (currency: string) => ({
      maxPerRoomNight: { amount: "200", currency },
    });
    for (const input of [
      { currency: "CNY", filters: { price: price("USD") } },
      { filters: { price: price("CNY") } },
    ]) {
      const result = searchHotelsInput.safeParse({
        destination: tokyo,
        stay: goodStay,
        ...input,
      });
      assert.equal(result.success, false);
      const issue = result.error?.issues.find(
        (found) => found.path.join(".") === "filters.price.maxPerRoomNight.currency",
      );
      assert.ok(issue, JSON.stringify(result.error?.issues));
      assert.match(issue.message, /CNY/);
      assert.match(issue.message, /USD/);
    }
    for (const input of [
      { currency: "CNY", filters: { price: price("CNY") } },
      { currency: "USD", filters: { price: price("USD") } },
      { filters: { price: price("USD") } },
    ]) {
      assertAccepted(searchHotelsInput, {
        destination: tokyo,
        stay: goodStay,
        ...input,
      });
    }
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

  it("amenities take only the codes that can filter, up to nine", () => {
    for (const code of FILTERABLE_AMENITIES) {
      assertAccepted(searchHotelsInput, {
        text: "x",
        filters: { amenities: [code] },
      });
    }
    assertAccepted(searchHotelsInput, {
      text: "x",
      filters: { amenities: [...FILTERABLE_AMENITIES] },
    });
    // A code a hotel can list but a search cannot filter by, and one nobody has.
    for (const code of [...AMENITY_CODES.slice(FILTERABLE_AMENITIES.length), "sauna"]) {
      assert.deepEqual(
        refusalOf(searchHotelsInput, {
          text: "x",
          filters: { amenities: [code] },
        }),
        [
          {
            path: "filters.amenities.0",
            message: `Each amenity must be one of: ${FILTERABLE_AMENITIES.join(", ")}`,
          },
        ],
        code,
      );
    }
    assert.deepEqual(
      refusalOf(searchHotelsInput, {
        text: "x",
        filters: { amenities: [...FILTERABLE_AMENITIES, "pool"] },
      }),
      [
        {
          path: "filters.amenities",
          message: `amenities must list 1 to 9 codes from: ${FILTERABLE_AMENITIES.join(", ")}`,
        },
      ],
    );
    assertRefusedAt(searchHotelsInput, { text: "x", filters: { amenities: [] } }, "filters.amenities");
  });

  it("describes the amenities filter by what it takes, with the codes in the schema", () => {
    const json = z.toJSONSchema(searchHotelsInput, { io: "input" }) as Json;
    const amenities = json.properties?.filters?.properties?.amenities;
    assert.deepEqual(amenities?.items?.enum, [...FILTERABLE_AMENITIES]);
    assert.equal(
      amenities?.description,
      "Amenities every hotel must list, 1 to 9 of the codes a search can filter by. A hotel's own amenities can hold other codes.",
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
      include: "roomTypes",
      locale: "zh",
    });
    assertRefusedAt(getHotelInput, { hotelId: "12345" }, "hotelId");
    // `rooms` is a stay's rooms; a hotel's list is its room types.
    assert.deepEqual(refusalOf(getHotelInput, { hotelId: hotel, include: "rooms" }), [
      { path: "include", message: "include must be one of: roomTypes" },
    ]);
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

  it("currency is USD or CNY", () => {
    assertAccepted(hotelOffersInput, { ...base, currency: "CNY" });
    assertAccepted(searchHotelsInput, { destination: tokyo, stay: goodStay, currency: "CNY" });
    for (const [schema, value] of [
      [hotelOffersInput, base],
      [searchHotelsInput, { destination: tokyo, stay: goodStay }],
    ] as const) {
      const issues = refusalOf(schema, { ...value, currency: "EUR" });
      const issue = issues.find((candidate) => candidate.path === "currency");
      assert.match(issue?.message ?? "", /USD/);
      assert.match(issue?.message ?? "", /CNY/);
      assert.equal(
        refusalOf(schema, { ...value, displayCurrency: "CNY" })[0]?.message,
        "Unknown argument(s): displayCurrency",
      );
    }
  });

  it("accepts the full request, and leaves limitPerHotel for the service to resolve", () => {
    assertAccepted(hotelOffersInput, {
      ...base,
      filters: { requireBreakfast: true, requireFreeCancellation: false },
      limitPerHotel: 30,
      locale: "en",
      currency: "USD",
    });
    assertAccepted(hotelOffersInput, { ...base, limitPerHotel: 1 });
    assert.equal(hotelOffersInput.parse(base).limitPerHotel, undefined);
    const json = z.toJSONSchema(hotelOffersInput, { io: "input" }) as Json;
    assert.equal(json.properties?.limitPerHotel?.default, undefined);
    assert.deepEqual(json.required, ["hotelIds", "stay"]);
  });

  it("describes limitPerHotel by the rule that resolves it", () => {
    const json = z.toJSONSchema(hotelOffersInput, { io: "input" }) as Json;
    assert.equal(
      json.properties?.limitPerHotel?.description,
      "Offers per hotel, 1 to 30. Left out: 15 for each hotel that has offers while that is at most 45 offers in all, otherwise 45 split evenly among those hotels, never under 3 each (5 hotels: 9 each; 15 hotels: 3 each). Given: that many for each hotel while that is at most 100 offers in all, otherwise 100 split evenly the same way.",
    );
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
      { ...base, limitPerHotel: 31 },
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

describe("offersPerHotel", () => {
  it("pins the budget's limits", () => {
    assert.equal(LIMITS.offersPerHotelDefault, 15);
    assert.equal(LIMITS.offersPerHotelMax, 30);
    assert.equal(LIMITS.offersPerHotelFloor, 3);
    assert.equal(LIMITS.offersPerCallDefault, 45);
    assert.equal(LIMITS.offersPerCallMax, 100);
  });

  it("without a limit: 15 per hotel while that fits 45 offers, otherwise 45 split evenly, never under 3", () => {
    for (const [hotels, each] of [
      [1, 15],
      [3, 15],
      [4, 11],
      [5, 9],
      [15, 3],
    ] as const) {
      assert.equal(offersPerHotel(undefined, hotels), each, `${hotels} hotels`);
    }
  });

  it("with a limit: honoured per hotel while that fits 100 offers, otherwise 100 split evenly", () => {
    for (const [limit, hotels, each] of [
      [30, 1, 30],
      [30, 3, 30],
      [30, 4, 25],
      [30, 5, 20],
      [30, 15, 6],
      [20, 5, 20],
      [20, 15, 6],
      // What the default would have cut is honoured when asked for.
      [15, 4, 15],
      [15, 5, 15],
      [15, 15, 6],
      // A limit under the floor is what the caller asked for.
      [1, 1, 1],
      [2, 15, 2],
    ] as const) {
      assert.equal(offersPerHotel(limit, hotels), each, `${limit} for ${hotels} hotels`);
    }
  });

  it("the floor holds however many hotels there are, and never lifts a lower limit", () => {
    // More hotels than a call takes today: an even share would be under 3.
    assert.equal(offersPerHotel(undefined, 20), 3);
    assert.equal(offersPerHotel(30, 50), 3);
    assert.equal(offersPerHotel(2, 50), 2);
  });

  it("never answers more than the limit, nor more than the call's ceiling in all", () => {
    for (const limit of [undefined, ...Array.from({ length: LIMITS.offersPerHotelMax }, (_, i) => i + 1)]) {
      for (let hotels = 1; hotels <= LIMITS.offersHotels; hotels++) {
        const each = offersPerHotel(limit, hotels);
        const label = `${limit} for ${hotels} hotels`;
        assert.ok(each >= 1 && each <= (limit ?? LIMITS.offersPerHotelDefault), label);
        assert.ok(
          each * hotels <= (limit === undefined ? LIMITS.offersPerCallDefault : LIMITS.offersPerCallMax),
          label,
        );
      }
    }
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
      name: "Wei Zhang",
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

  it("takes the contact's name as one field, in any script, trimmed", () => {
    for (const name of ["Wei Zhang", "张伟", "José Müller-O’Brien", "Cher"]) {
      assertAccepted(createOrderInput, withContact({ name }));
    }
    assert.equal(
      createOrderInput.parse(withContact({ name: "  Wei Zhang \n" })).contact.name,
      "Wei Zhang",
    );
    for (const name of ["", "   ", undefined, 5]) {
      assert.deepEqual(
        refusalOf(createOrderInput, withContact({ name })),
        [{ path: "contact.name", message: "name must be text of 1 to 119 characters" }],
        JSON.stringify(name),
      );
    }
    // The two names of old are sent as one.
    for (const key of ["firstName", "lastName"]) {
      assert.equal(
        refusalOf(createOrderInput, withContact({ [key]: "Wei" }))[0]?.message,
        `Unknown argument(s): ${key}`,
      );
    }
  });

  it("holds the contact name to 119 characters: two names of 59 and the space between", () => {
    assert.equal(LIMITS.contactName, 59 + 1 + 59);
    const longest = `${"a".repeat(59)} ${"b".repeat(59)}`;
    assertAccepted(createOrderInput, withContact({ name: longest }));
    assertAccepted(createOrderInput, withContact({ name: ` ${longest}  ` }));
    assertRefusedAt(createOrderInput, withContact({ name: `${longest}c` }), "contact.name");
    const json = z.toJSONSchema(createOrderInput, { io: "input" }) as Json;
    assert.deepEqual(json.properties?.contact?.required, ["name", "email", "phone"]);
    assert.equal(
      json.properties?.contact?.properties?.name?.description,
      "Contact person's full name, in any script, at most 119 characters.",
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
    assert.deepEqual(refusalOf(createOrderInput, withContact({ name: `Wei Zhang ${VISA}` })), [
      { path: "contact.name", message: CARD_NUMBER_MESSAGE },
    ]);
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
  const penalty = { amount: "12.50", currency: "CNY" };
  const exactlyOne =
    "Send exactly one of close and maximumPenalty: close (true) closes an unpaid order; maximumPenalty cancels a paid one, with the penalty the user agreed to as a ceiling";

  it("closes an unpaid order with close: true", () => {
    assertAccepted(cancelOrderInput, { orderId, close: true });
    for (const close of [false, "true", 1, null]) {
      assert.deepEqual(
        refusalOf(cancelOrderInput, { orderId, close }),
        [{ path: "close", message: "close must be true" }],
        JSON.stringify(close),
      );
    }
  });

  it("cancels a paid order with the penalty the user agreed to, as Money", () => {
    assertAccepted(cancelOrderInput, { orderId, maximumPenalty: penalty });
    assertAccepted(cancelOrderInput, { orderId, maximumPenalty: { amount: "0.00", currency: "USD" } });
    // The order's cancel.penalty as returned: a website order's may be in any currency.
    assertAccepted(cancelOrderInput, { orderId, maximumPenalty: { amount: "12.50", currency: "EUR" } });
    assert.deepEqual(refusalOf(cancelOrderInput, { orderId, maximumPenalty: 12.5 }), [
      {
        path: "maximumPenalty",
        message: 'maximumPenalty must be Money as returned: { amount: "132.40", currency: "USD" }',
      },
    ]);
    assertRefusedAt(cancelOrderInput, { orderId, maximumPenalty: { amount: "-1", currency: "USD" } }, "maximumPenalty.amount");
    assertRefusedAt(cancelOrderInput, { orderId, maximumPenalty: { amount: "12.50", currency: "eur" } }, "maximumPenalty.currency");
  });

  it("takes exactly one of the two, and says what each is for", () => {
    // Neither: the order alone no longer closes it.
    assert.deepEqual(refusalOf(cancelOrderInput, { orderId }), [{ path: "close", message: exactlyOne }]);
    assert.deepEqual(refusalOf(cancelOrderInput, { orderId, close: true, maximumPenalty: penalty }), [
      { path: "maximumPenalty", message: exactlyOne },
    ]);
    // One mistake, one refusal: a close that isn't true is not also a missing mode.
    assert.deepEqual(refusalOf(cancelOrderInput, { orderId, close: false, maximumPenalty: penalty }), [
      { path: "close", message: "close must be true" },
    ]);
  });

  it("needs the order and is strict", () => {
    assertRefusedAt(cancelOrderInput, { orderId: hotel, close: true }, "orderId");
    assertRefusedAt(cancelOrderInput, { close: true }, "orderId");
    assert.equal(
      refusalOf(cancelOrderInput, { orderId, close: true, refund: 1 })[0]?.message,
      "Unknown argument(s): refund",
    );
  });

  it("describes each mode by the order it acts on", () => {
    const json = z.toJSONSchema(cancelOrderInput, { io: "input" }) as Json;
    assert.equal(
      json.properties?.close?.description,
      "Send true to close an unpaid order: nothing is charged. Send exactly one of close and maximumPenalty.",
    );
    assert.equal(json.properties?.close?.const, true);
    assert.equal(
      json.properties?.maximumPenalty?.description,
      "Send it to cancel a paid order: the penalty the user agreed to, as a ceiling (the order's cancel.penalty, exactly as returned). Send exactly one of close and maximumPenalty.",
    );
    assert.deepEqual(json.required, ["orderId"]);
  });
});

describe("payOrderInput", () => {
  const orderId = "ord_aaaaaaaaaaaaaaaaaaaa";
  const total = { amount: "132.40", currency: "USD" };
  const token = "spt_1TestToken0123456789";
  const tokenError =
    "sharedPaymentToken must be a Stripe shared payment token: spt_ followed by letters and digits";

  it("takes the order, the token and the total, all required", () => {
    assertAccepted(payOrderInput, { orderId, sharedPaymentToken: token, total });
    assert.deepEqual(payOrderInput.parse({ orderId, sharedPaymentToken: token, total }), {
      orderId,
      sharedPaymentToken: token,
      total,
    });
    const json = z.toJSONSchema(payOrderInput, { io: "input" }) as Json;
    assert.deepEqual(Object.keys(json.properties ?? {}), ["orderId", "sharedPaymentToken", "total"]);
    assert.deepEqual(json.required, ["orderId", "sharedPaymentToken", "total"]);
    assertRefusedAt(payOrderInput, { sharedPaymentToken: token, total }, "orderId");
    assert.deepEqual(refusalOf(payOrderInput, { orderId, total }), [
      { path: "sharedPaymentToken", message: tokenError },
    ]);
    assertRefusedAt(payOrderInput, { orderId, sharedPaymentToken: token }, "total");
  });

  it("holds the token to spt_ and the total to Money in USD or CNY", () => {
    for (const sharedPaymentToken of ["tok_1", "", "spt_", "spt_a-b", 5]) {
      assert.deepEqual(
        refusalOf(payOrderInput, { orderId, sharedPaymentToken, total }),
        [{ path: "sharedPaymentToken", message: tokenError }],
        JSON.stringify(sharedPaymentToken),
      );
    }
    assertRefusedAt(
      payOrderInput,
      { orderId, sharedPaymentToken: token, total: { amount: "132.40", currency: "EUR" } },
      "total.currency",
    );
    assertRefusedAt(payOrderInput, { orderId, sharedPaymentToken: token, total: 132.4 }, "total");
  });

  it("takes no other way to pay: no UCP payment object, no method", () => {
    const card = {
      id: "instr_1",
      handler_id: "stripe_payments",
      type: "card",
      selected: true,
      credential: { type: "stripe_payment_token", token },
    };
    for (const [key, value] of [
      ["payment", { instruments: [card] }],
      ["method", "stripe_alipay_wechat_pay"],
      ["credential", "x"],
    ] as const) {
      // With the token or in its place, the key is unknown.
      assert.deepEqual(refusalOf(payOrderInput, { orderId, sharedPaymentToken: token, total, [key]: value }), [
        { path: "", message: `Unknown argument(s): ${key}` },
      ]);
      assert.ok(
        refusalOf(payOrderInput, { orderId, total, [key]: value }).some(
          (issue) => issue.message === `Unknown argument(s): ${key}`,
        ),
        key,
      );
    }
  });

  it("describes the token without naming another way to send it", () => {
    const json = z.toJSONSchema(payOrderInput, { io: "input" }) as Json;
    assert.equal(
      json.properties?.sharedPaymentToken?.description,
      "The shared payment token (spt_…) the user approved for this order, requested with the limits of the order's stripe_shared_payment_token method.",
    );
    assert.doesNotMatch(JSON.stringify(json), /Exactly one of|instrument/);
  });
});
