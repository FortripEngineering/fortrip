import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { CARD_NUMBER_MESSAGE } from "../src/card-number.ts";
import { addIsoDateDays } from "../src/dates.ts";
import { GUEST_NAME_MESSAGE } from "../src/guest-name.ts";
import {
  createBookingInput,
  getHotelInput,
  getRatesInput,
  searchHotelsInput,
} from "../src/inputs.ts";
import { LIMITS } from "../src/limits.ts";

// The production bundle never runs zod's `config(en())` (zod is
// `sideEffects: false`), and zod 4.6 only installs English on a ZodType's first
// construction when none is set: a locale that answers nothing keeps every
// message here our own, whichever zod version is installed.
z.config({ localeError: () => undefined });

type Issue = { path: string; message: string };

/** The issues the schema raises for `value` (path joined with dots), or `null` if it passes. */
function issuesOf(schema: z.ZodType, value: unknown): Issue[] | null {
  const result = schema.safeParse(value);
  return result.success
    ? null
    : result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
}

/** Every case fails with the given first issue, and no issue falls back to zod's "Invalid input". */
function assertRefused(
  schema: z.ZodType,
  cases: ReadonlyArray<readonly [unknown, string, string]>,
) {
  for (const [value, path, message] of cases) {
    const issues = issuesOf(schema, value);
    assert.ok(issues, `should fail: ${JSON.stringify(value)}`);
    assert.deepEqual(issues[0], { path, message }, JSON.stringify(value));
    for (const issue of issues) {
      assert.notEqual(issue.message, "Invalid input", JSON.stringify(issue));
    }
  }
}

type JsonSchema = {
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  [key: string]: unknown;
};

/** Dotted paths of every property, nested ones (`near.lat`, `guests[].firstName`) included, that has no description. */
function undescribed(schema: JsonSchema, prefix = ""): string[] {
  const missing: string[] = [];
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const path = `${prefix}${name}`;
    if (!property.description?.trim()) missing.push(path);
    missing.push(...undescribed(property, `${path}.`));
    if (property.items) {
      missing.push(...undescribed(property.items, `${path}[].`));
    }
  }
  return missing;
}

const today = new Date().toISOString().slice(0, 10);
const checkIn = addIsoDateDays(today, 30);

describe("the inputs run without zod's own messages", () => {
  it("falls back to Invalid input for a bare zod check, as the production bundle does", () => {
    assert.equal(
      z.string().safeParse(1).error?.issues[0]?.message,
      "Invalid input",
    );
  });
});

describe("every input field has a non-empty description", () => {
  for (const [name, schema] of [
    ["searchHotelsInput", searchHotelsInput],
    ["getHotelInput", getHotelInput],
    ["getRatesInput", getRatesInput],
    ["createBookingInput", createBookingInput],
  ] as const) {
    it(name, () => {
      const json = z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
      assert.ok(Object.keys(json.properties ?? {}).length > 0);
      assert.deepEqual(undescribed(json), []);
    });
  }

  it("reaches nested fields and array items", () => {
    const search = z.toJSONSchema(searchHotelsInput, {
      io: "input",
    }) as JsonSchema;
    assert.ok(search.properties?.near?.properties?.lat?.description);
    const booking = z.toJSONSchema(createBookingInput, {
      io: "input",
    }) as JsonSchema;
    assert.ok(
      booking.properties?.guests?.items?.properties?.firstName?.description,
    );
  });
});

describe("searchHotelsInput", () => {
  const valid = {
    query: "曼谷",
    checkIn,
    checkOut: addIsoDateDays(checkIn, 2),
  };

  it("applies defaults and accepts the 15-night boundary", () => {
    const parsed = searchHotelsInput.parse({
      ...valid,
      checkOut: addIsoDateDays(checkIn, LIMITS.nights),
    });
    assert.equal(parsed.currency, "CNY");
    assert.equal(parsed.sortBy, "recommended");
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, 20);
  });

  it("accepts a geo-only search sorted by distance", () => {
    assert.equal(
      searchHotelsInput.safeParse({
        checkIn: valid.checkIn,
        checkOut: valid.checkOut,
        near: { lat: 13.75, lng: 100.5, radiusKm: 3 },
        sortBy: "distance",
      }).success,
      true,
    );
  });

  it("accepts a search from yesterday in UTC, for travellers ahead of UTC", () => {
    assert.equal(
      searchHotelsInput.safeParse({
        query: "Bangkok",
        checkIn: addIsoDateDays(today, -1),
        checkOut: addIsoDateDays(today, 1),
      }).success,
      true,
    );
  });

  it("trims and de-duplicates facilities", () => {
    const parsed = searchHotelsInput.parse({
      ...valid,
      facilities: [" 游泳池 ", "停车场", "游泳池"],
    });
    assert.deepEqual(parsed.facilities, ["游泳池", "停车场"]);
  });

  it("rejects invalid dates, spans, scopes and ranges", () => {
    for (const input of [
      { ...valid, checkIn: "2026-02-30" },
      { ...valid, checkOut: addIsoDateDays(checkIn, 16) },
      { ...valid, checkOut: checkIn },
      {
        ...valid,
        checkIn: addIsoDateDays(today, -2),
        checkOut: addIsoDateDays(today, 1),
      },
      { checkIn: valid.checkIn, checkOut: valid.checkOut },
      { ...valid, query: "   " },
      { ...valid, sortBy: "distance" },
      { ...valid, starMin: 5, starMax: 3 },
      { ...valid, priceMin: 500, priceMax: 100 },
      { ...valid, pageSize: 51 },
      { ...valid, facilities: [] },
      { ...valid, facilities: ["  "] },
      { ...valid, facilities: Array.from({ length: 11 }, (_, i) => `f${i}`) },
      { ...valid, hotelIds: [1] },
    ]) {
      assert.equal(
        searchHotelsInput.safeParse(input).success,
        false,
        JSON.stringify(input),
      );
    }
  });

  it("names what is wrong, with its own message", () => {
    assertRefused(searchHotelsInput, [
      [
        { checkIn: valid.checkIn, checkOut: valid.checkOut },
        "query",
        "Provide query, cityCode or near",
      ],
      [
        { ...valid, sortBy: "distance" },
        "sortBy",
        "distance sort requires near",
      ],
      [
        { ...valid, sortBy: "cheapest" },
        "sortBy",
        "sortBy must be one of: recommended, price-asc, price-desc, star-desc, distance",
      ],
      [
        { ...valid, starMin: 5, starMax: 3 },
        "starMax",
        "starMax must be >= starMin",
      ],
      [
        { ...valid, priceMin: 500, priceMax: 100 },
        "priceMax",
        "priceMax must be >= priceMin",
      ],
      [
        { ...valid, checkIn: addIsoDateDays(today, -2), checkOut: today },
        "checkIn",
        "checkIn must not be in the past",
      ],
      [
        { ...valid, checkOut: valid.checkIn },
        "checkOut",
        "checkOut must be after checkIn",
      ],
      [
        { ...valid, checkOut: addIsoDateDays(checkIn, 16) },
        "checkOut",
        "search supports at most 15 nights",
      ],
      [
        { ...valid, checkIn: "2026-02-30" },
        "checkIn",
        "checkIn must be a real yyyy-MM-dd calendar date",
      ],
      [
        { ...valid, query: "   " },
        "query",
        "query must be text of 1 to 128 characters",
      ],
      [
        { ...valid, query: "x".repeat(129) },
        "query",
        "query must be text of 1 to 128 characters",
      ],
      [
        { ...valid, cityCode: 0 },
        "cityCode",
        "cityCode must be a positive whole number",
      ],
      [
        { ...valid, currency: "EUR" },
        "currency",
        "currency must be one of: CNY, USD",
      ],
      [
        { ...valid, starMin: 6 },
        "starMin",
        "starMin must be a number from 0 to 5",
      ],
      [
        { ...valid, priceMin: -1 },
        "priceMin",
        "priceMin must be a number, 0 or more",
      ],
      [
        { ...valid, priceMax: 0 },
        "priceMax",
        "priceMax must be a number above 0",
      ],
      [
        { ...valid, page: 0 },
        "page",
        "page must be a whole number from 1 to 100",
      ],
      [
        { ...valid, pageSize: 51 },
        "pageSize",
        "pageSize must be a whole number from 1 to 50",
      ],
      [
        { ...valid, facilities: [] },
        "facilities",
        "facilities must list 1 to 10 catalogue facility names (1 to 64 characters each)",
      ],
      [
        { ...valid, facilities: ["  "] },
        "facilities.0",
        "facilities must list 1 to 10 catalogue facility names (1 to 64 characters each)",
      ],
      [
        { ...valid, near: { lat: 91, lng: 0, radiusKm: 3 } },
        "near.lat",
        "near.lat must be a number from -90 to 90",
      ],
      [
        { ...valid, near: { lat: 0, lng: 181, radiusKm: 3 } },
        "near.lng",
        "near.lng must be a number from -180 to 180",
      ],
      [
        { ...valid, near: { lat: 0, lng: 0, radiusKm: 201 } },
        "near.radiusKm",
        "near.radiusKm must be more than 0, at most 200",
      ],
      [{ ...valid, hotelIds: [1] }, "", "Unknown argument(s): hotelIds"],
      [
        { ...valid, near: { lat: 0, lng: 0, radiusKm: 3, zoom: 2 } },
        "near",
        "Unknown argument(s): zoom",
      ],
      ["not an object", "", "Expected a JSON object"],
    ]);
  });
});

describe("getHotelInput", () => {
  it("takes a hotelId and an optional includeRooms", () => {
    assert.deepEqual(getHotelInput.parse({ hotelId: 16525 }), {
      hotelId: 16525,
    });
    assert.deepEqual(
      getHotelInput.parse({ hotelId: 16525, includeRooms: true }),
      {
        hotelId: 16525,
        includeRooms: true,
      },
    );
  });

  it("is not strict: keys it doesn't know are dropped, not refused", () => {
    assert.deepEqual(getHotelInput.parse({ hotelId: 1, include: "rooms" }), {
      hotelId: 1,
    });
  });

  it("names what is wrong, with its own message", () => {
    assertRefused(getHotelInput, [
      [{ hotelId: 0 }, "hotelId", "hotelId must be a positive whole number"],
      [{}, "hotelId", "hotelId must be a positive whole number"],
      [
        { hotelId: 1, includeRooms: "yes" },
        "includeRooms",
        "includeRooms must be true or false",
      ],
      ["not an object", "", "Expected a JSON object"],
    ]);
  });
});

describe("getRatesInput", () => {
  const valid = {
    hotelIds: [16525],
    checkIn,
    checkOut: addIsoDateDays(checkIn, 2),
    rooms: 1,
    adults: 2,
  };

  it("applies defaults", () => {
    const parsed = getRatesInput.parse(valid);
    assert.equal(parsed.currency, "CNY");
    assert.equal(parsed.bookableOnly, true);
    assert.equal(parsed.maxRoomsPerHotel, 10);
    assert.equal(parsed.childrenAges, undefined);
  });

  it("has no occupancy defaults", () => {
    const { rooms: _rooms, ...withoutRooms } = valid;
    const { adults: _adults, ...withoutAdults } = valid;
    assert.equal(getRatesInput.safeParse(withoutRooms).success, false);
    assert.equal(getRatesInput.safeParse(withoutAdults).success, false);
  });

  it("rates without rooms fails with the rooms message", () => {
    const { rooms: _rooms, ...withoutRooms } = valid;
    assert.deepEqual(issuesOf(getRatesInput, withoutRooms), [
      { path: "rooms", message: "rooms must be a whole number from 1 to 8" },
    ]);
  });

  it("accepts the per-room caps themselves", () => {
    assert.equal(
      getRatesInput.safeParse({
        ...valid,
        hotelIds: Array.from({ length: LIMITS.ratesHotels }, (_, i) => i + 1),
        checkOut: addIsoDateDays(checkIn, LIMITS.nights),
        rooms: LIMITS.rooms,
        adults: LIMITS.adultsPerRoom,
        childrenAges: [0, 1, 2, 3, 4, 5, 6, 17],
        maxRoomsPerHotel: LIMITS.maxRoomsPerHotel,
        nationality: "CN",
        boardCodes: ["BB", "HBLD"],
        freeCancellation: true,
      }).success,
      true,
    );
  });

  it("rejects invalid stays", () => {
    for (const input of [
      { ...valid, hotelIds: [] },
      { ...valid, hotelIds: Array.from({ length: 16 }, (_, i) => i + 1) },
      { ...valid, checkOut: checkIn },
      { ...valid, checkOut: addIsoDateDays(checkIn, 16) },
      { ...valid, checkIn: "2026-02-30" },
      { ...valid, rooms: 9 },
      { ...valid, adults: 0 },
      { ...valid, adults: 9 },
      { ...valid, childrenAges: [18] },
      { ...valid, childrenAges: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
      { ...valid, nationality: "cn" },
      { ...valid, extra: true },
      { ...valid, boardCodes: ["XX"] },
      { ...valid, boardCodes: [] },
      { ...valid, maxRoomsPerHotel: 0 },
      { ...valid, maxRatesPerRoom: 3 },
      { ...valid, maxRoomsPerHotel: 201 },
      { ...valid, currency: "usd" },
      { ...valid, currency: "EUR" },
    ]) {
      assert.equal(
        getRatesInput.safeParse(input).success,
        false,
        JSON.stringify(input),
      );
    }
  });

  it("names what is wrong, with its own message", () => {
    assertRefused(getRatesInput, [
      [
        { ...valid, rooms: 9 },
        "rooms",
        "rooms must be a whole number from 1 to 8",
      ],
      [
        { ...valid, adults: 9 },
        "adults",
        "adults (per room) must be a whole number from 1 to 8",
      ],
      [
        { ...valid, childrenAges: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
        "childrenAges",
        "childrenAges must list each child's age (0 to 17) in one room, at most 8",
      ],
      [
        { ...valid, hotelIds: [] },
        "hotelIds",
        "hotelIds must list 1 to 15 hotelIds",
      ],
      [
        { ...valid, hotelIds: [0] },
        "hotelIds.0",
        "Each hotelId must be a positive whole number",
      ],
      [
        { ...valid, checkIn: "2026-02-30" },
        "checkIn",
        "checkIn must be a real yyyy-MM-dd calendar date",
      ],
      [
        { ...valid, checkOut: valid.checkIn },
        "checkOut",
        "checkOut must be after checkIn",
      ],
      [
        { ...valid, checkOut: addIsoDateDays(checkIn, 16) },
        "checkOut",
        "rates support at most 15 nights",
      ],
      [
        { ...valid, currency: "EUR" },
        "currency",
        "currency must be one of: CNY, USD",
      ],
      [
        { ...valid, boardCodes: ["XX"] },
        "boardCodes.0",
        "Each boardCode must be one of: RO, BB, HB, FB, BL, BD, HBBL, HBLD, AI",
      ],
      [
        { ...valid, boardCodes: [] },
        "boardCodes",
        "boardCodes must list meal codes from: RO, BB, HB, FB, BL, BD, HBBL, HBLD, AI",
      ],
      [
        { ...valid, nationality: "cn" },
        "nationality",
        "nationality must be a 2-letter ISO 3166-1 code, upper case",
      ],
      [
        { ...valid, nationality: 86 },
        "nationality",
        "nationality must be a 2-letter ISO 3166-1 code",
      ],
      [
        { ...valid, bookableOnly: "yes" },
        "bookableOnly",
        "bookableOnly must be true or false",
      ],
      [
        { ...valid, maxRoomsPerHotel: 201 },
        "maxRoomsPerHotel",
        "maxRoomsPerHotel must be a whole number from 1 to 200",
      ],
      [
        { ...valid, maxRatesPerRoom: 3 },
        "",
        "Unknown argument(s): maxRatesPerRoom",
      ],
    ]);
  });

  it("carries the limits into its JSON Schema", () => {
    const json = z.toJSONSchema(getRatesInput, { io: "input" }) as {
      properties: Record<string, Record<string, unknown>>;
    };
    assert.equal(json.properties.rooms?.maximum, LIMITS.rooms);
    assert.equal(json.properties.adults?.maximum, LIMITS.adultsPerRoom);
    assert.equal(json.properties.hotelIds?.maxItems, LIMITS.ratesHotels);
    assert.equal(
      json.properties.childrenAges?.maxItems,
      LIMITS.childrenPerRoom,
    );
    assert.equal(
      json.properties.maxRoomsPerHotel?.maximum,
      LIMITS.maxRoomsPerHotel,
    );
    assert.equal(json.properties.maxRoomsPerHotel?.default, 10);
    assert.equal(json.properties.currency?.default, "CNY");
  });
});

describe("createBookingInput", () => {
  const stay = {
    hotelId: 16525,
    roomId: "18035576",
    ratePlanCode: "rp_xxx",
    checkIn: "2026-06-24",
    checkOut: "2026-06-26",
    adults: 2,
    rooms: 1,
  };
  const body = {
    ...stay,
    guests: [{ firstName: "Test", lastName: "Guest", roomNo: 1 }],
    contactName: "Test Contact",
    contactPhone: "+1234567890",
  };

  it("accepts a booking and defaults childrenAges to none", () => {
    assert.deepEqual(createBookingInput.parse(body), {
      ...body,
      childrenAges: [],
    });
  });

  it("accepts the per-room caps and a full stay of 15 nights", () => {
    assert.equal(
      createBookingInput.safeParse({
        ...body,
        checkIn: "2026-06-24",
        checkOut: "2026-07-09",
        rooms: LIMITS.rooms,
        adults: LIMITS.adultsPerRoom,
        childrenAges: [0, 1, 2, 3, 4, 5, 6, 17],
        guests: [
          { firstName: "A".repeat(LIMITS.guestName), lastName: "B", roomNo: 8 },
        ],
        contactName: "C".repeat(LIMITS.contactName),
        specialRequests: "D".repeat(LIMITS.specialRequests),
        contactEmail: "a@b.co",
      }).success,
      true,
    );
  });

  it("refuses a reversed, same-day or over-long stay on checkOut", () => {
    for (const [dates, message] of [
      [
        { checkIn: "2026-06-26", checkOut: "2026-06-24" },
        "checkOut must be after checkIn",
      ],
      [
        { checkIn: "2026-06-24", checkOut: "2026-06-24" },
        "checkOut must be after checkIn",
      ],
      [
        { checkIn: "2026-06-24", checkOut: "2026-07-10" },
        "A booking covers at most 15 nights; book a longer stay as separate bookings",
      ],
    ] as const) {
      assert.deepEqual(
        issuesOf(createBookingInput, { ...body, ...dates }),
        [{ path: "checkOut", message }],
        JSON.stringify(dates),
      );
    }
  });

  it("names what is wrong, with its own message", () => {
    assertRefused(createBookingInput, [
      [
        { ...body, hotelId: 0 },
        "hotelId",
        "hotelId must be a positive whole number",
      ],
      [
        { ...body, hotelId: undefined },
        "hotelId",
        "hotelId must be a positive whole number",
      ],
      [{ ...body, roomId: "" }, "roomId", "roomId must be a non-empty string"],
      [
        { ...body, ratePlanCode: "" },
        "ratePlanCode",
        "ratePlanCode must be a non-empty string",
      ],
      [
        { ...body, guests: [] },
        "guests",
        "guests must list at least one guest per room",
      ],
      [
        { ...body, checkIn: "24/06/2026" },
        "checkIn",
        "checkIn must be a real yyyy-MM-dd calendar date",
      ],
      [
        { ...body, checkIn: "2026-13-01" },
        "checkIn",
        "checkIn must be a real yyyy-MM-dd calendar date",
      ],
      [
        { ...body, checkOut: "2026-06-31" },
        "checkOut",
        "checkOut must be a real yyyy-MM-dd calendar date",
      ],
      [
        { ...body, rooms: 9 },
        "rooms",
        "rooms must be a whole number from 1 to 8",
      ],
      [
        { ...body, rooms: "2" },
        "rooms",
        "rooms must be a whole number from 1 to 8",
      ],
      [
        { ...body, adults: 9 },
        "adults",
        "adults (per room) must be a whole number from 1 to 8",
      ],
      [
        { ...body, childrenAges: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
        "childrenAges",
        "childrenAges must list each child's age (0 to 17) in one room, at most 8",
      ],
      [
        { ...body, childrenAges: [18] },
        "childrenAges.0",
        "Each child's age must be a whole number from 0 to 17",
      ],
      // A misspelled optional key must not book the default party.
      [{ ...body, children: [5] }, "", "Unknown argument(s): children"],
      [{ ...body, nationality: "CN" }, "", "Unknown argument(s): nationality"],
      [
        {
          ...body,
          guests: [
            { firstName: "Test", lastName: "Guest", roomNo: 1, title: "Mr" },
          ],
        },
        "guests.0",
        "Unknown argument(s): title",
      ],
      // A dropped middle name would change the name booked: refused.
      [
        {
          ...body,
          guests: [
            {
              firstName: "Test",
              middleName: "Q",
              lastName: "Guest",
              roomNo: 1,
              age: 30,
            },
          ],
        },
        "guests.0",
        "Unknown argument(s): middleName, age",
      ],
      [
        { ...body, guests: [{ firstName: "伟", lastName: "张", roomNo: 1 }] },
        "guests.0.firstName",
        GUEST_NAME_MESSAGE,
      ],
      [
        {
          ...body,
          guests: [{ firstName: "José", lastName: "Müller", roomNo: 1 }],
        },
        "guests.0.firstName",
        GUEST_NAME_MESSAGE,
      ],
      [
        { ...body, guests: [{ firstName: " ", lastName: "Guest", roomNo: 1 }] },
        "guests.0.firstName",
        "firstName must not be blank",
      ],
      [
        {
          ...body,
          guests: [{ firstName: "Wei", lastName: "Zhang", roomNo: "two" }],
        },
        "guests.0.roomNo",
        "roomNo must be a whole number from 1 to 8",
      ],
      [
        {
          ...body,
          guests: [{ firstName: "Wei", lastName: "Zhang", roomNo: 9 }],
        },
        "guests.0.roomNo",
        "roomNo must be a whole number from 1 to 8",
      ],
      [
        { ...body, contactPhone: "1" },
        "contactPhone",
        "contactPhone must be text of 3 to 40 characters",
      ],
      [
        { ...body, contactName: "" },
        "contactName",
        "contactName must be text of 1 to 120 characters",
      ],
      [
        { ...body, specialRequests: "x".repeat(501) },
        "specialRequests",
        "specialRequests must be text of 0 to 500 characters",
      ],
      [
        { ...body, contactEmail: "nope" },
        "contactEmail",
        "contactEmail must be an email address",
      ],
      ["not an object", "", "Expected a JSON object"],
    ]);
  });

  it("a 61-character guest name fails", () => {
    for (const field of ["firstName", "lastName"] as const) {
      const guest = { firstName: "Wei", lastName: "Zhang", roomNo: 1 };
      assert.deepEqual(
        issuesOf(createBookingInput, {
          ...body,
          guests: [{ ...guest, [field]: "A".repeat(LIMITS.guestName + 1) }],
        }),
        [
          {
            path: `guests.0.${field}`,
            message: `${field} must be text of 1 to 60 characters`,
          },
        ],
        field,
      );
    }
  });

  it("refuses a payment card number in free text, naming only that field", () => {
    for (const [payload, path] of [
      [
        { ...body, specialRequests: "My card is 4242424242424242" },
        "specialRequests",
      ],
      [
        { ...body, specialRequests: "room 12 4111 1111 1111 1111 thanks" },
        "specialRequests",
      ],
      [{ ...body, contactName: "5555-5555-5555-4444" }, "contactName"],
      [{ ...body, contactPhone: "4242 4242 4242 4242" }, "contactPhone"],
      [{ ...body, contactPhone: "+4242424242424242" }, "contactPhone"],
      [
        {
          ...body,
          guests: [
            { firstName: "Test", lastName: "378282246310005", roomNo: 1 },
          ],
        },
        "guests.0.lastName",
      ],
    ] as const) {
      assert.deepEqual(
        issuesOf(createBookingInput, payload),
        [{ path, message: CARD_NUMBER_MESSAGE }],
        JSON.stringify(payload),
      );
    }
  });

  it("contactPhone 4242 4242 4242 4242 fails with the card message, +86 138 0013 8000 passes", () => {
    assert.deepEqual(
      issuesOf(createBookingInput, {
        ...body,
        contactPhone: "4242 4242 4242 4242",
      }),
      [{ path: "contactPhone", message: CARD_NUMBER_MESSAGE }],
    );
    assert.equal(
      createBookingInput.safeParse({
        ...body,
        contactPhone: "+86 138 0013 8000",
      }).success,
      true,
    );
  });

  it("lets numbers that aren't cards through", () => {
    for (const specialRequests of [
      // Luhn-invalid 16 digits, a phone number, dates and a flight.
      "Ref 4242424242424241, call +86 138 0013 8000",
      "Arriving 2026-06-24 on CA 1234, late check-in",
      "Stay 2026-11-10 2026-11-12, mobiles 138 0013 8000 / 139 1234 5678",
    ]) {
      assert.equal(
        createBookingInput.safeParse({ ...body, specialRequests }).success,
        true,
        specialRequests,
      );
    }
    // Phone numbers of 13–15 digits that pass the card check.
    for (const contactPhone of [
      "6281234567899",
      "4930 1234 5678 907",
      "+86 138 0013 8000 / 393331234567893",
    ]) {
      assert.equal(
        createBookingInput.safeParse({ ...body, contactPhone }).success,
        true,
        contactPhone,
      );
    }
  });

  it("still takes what booked before: a blank email, a numeric-string roomNo, a curly apostrophe", () => {
    for (const [extra, expected] of [
      [{ contactEmail: "" }, { contactEmail: "" }],
      [{ contactEmail: "   " }, { contactEmail: "" }],
      [{ contactEmail: " a@b.co " }, { contactEmail: "a@b.co" }],
      [
        { guests: [{ firstName: "Test", lastName: "Guest", roomNo: "1" }] },
        { guests: [{ firstName: "Test", lastName: "Guest", roomNo: 1 }] },
      ],
      [
        { guests: [{ firstName: "Sean", lastName: "O’Brien", roomNo: 1 }] },
        { guests: [{ firstName: "Sean", lastName: "O’Brien", roomNo: 1 }] },
      ],
    ] as const) {
      const result = createBookingInput.safeParse({ ...body, ...extra });
      assert.ok(result.success, JSON.stringify(extra));
      for (const [key, value] of Object.entries(expected)) {
        assert.deepEqual(
          (result.data as Record<string, unknown>)[key],
          value,
          `${JSON.stringify(extra)} ${key}`,
        );
      }
    }
  });
});
