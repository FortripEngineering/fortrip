import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOOK_OPTIONS,
  bookBody,
  HOTEL_OPTIONS,
  hotelPath,
  parse,
  parseGuest,
  RATES_OPTIONS,
  ratesBody,
  SEARCH_OPTIONS,
  searchBody,
} from "../src/args.ts";
import { CliError, EXIT } from "../src/errors.ts";

function isUsage(error: unknown): boolean {
  return error instanceof CliError && error.exitCode === EXIT.usage;
}

describe("search", () => {
  it("maps flags onto the API body", () => {
    const { values } = parse(
      [
        "-q",
        "Bangkok",
        "--check-in",
        "2026-11-10",
        "--check-out",
        "2026-11-12",
        "--near",
        "13.7, 100.5, 5",
        "--facility",
        "Swimming pool",
        "--facility",
        "Parking",
        "--star-min",
        "4",
        "--sort",
        "price-asc",
      ],
      SEARCH_OPTIONS,
    );
    assert.deepEqual(searchBody(values), {
      query: "Bangkok",
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      near: { lat: 13.7, lng: 100.5, radiusKm: 5 },
      facilities: ["Swimming pool", "Parking"],
      starMin: 4,
      sortBy: "price-asc",
    });
  });

  it("flags override --body fields; omitted flags keep them", () => {
    const { values } = parse(
      ["--body", '{"query":"Tokyo","pageSize":5}', "--query", "Osaka"],
      SEARCH_OPTIONS,
    );
    assert.deepEqual(searchBody(values), { query: "Osaka", pageSize: 5 });
  });

  it("rejects bad numbers, a bad --near and non-object bodies", () => {
    for (const argv of [
      ["--star-min", "four"],
      ["--near", "13.7,100.5"],
      ["--body", "[1,2]"],
      ["--body", "not json"],
    ]) {
      assert.throws(() => searchBody(parse(argv, SEARCH_OPTIONS).values), isUsage);
    }
  });

  it("unknown flags are usage errors", () => {
    assert.throws(() => parse(["--nope"], SEARCH_OPTIONS), isUsage);
  });
});

describe("rates", () => {
  it("defaults to 1 room × 2 adults and accepts repeated or comma-separated ids", () => {
    const { values } = parse(
      [
        "--hotel",
        "266000,266001",
        "--hotel",
        "3",
        "--check-in",
        "2026-11-10",
        "--check-out",
        "2026-11-12",
        "--board",
        "bb,hb",
        "--free-cancellation",
        "--include-unbookable",
        "--nationality",
        "cn",
      ],
      RATES_OPTIONS,
    );
    assert.deepEqual(ratesBody(values), {
      hotelIds: [266000, 266001, 3],
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      rooms: 1,
      adults: 2,
      nationality: "CN",
      boardCodes: ["BB", "HB"],
      freeCancellation: true,
      bookableOnly: false,
    });
  });

  it("keeps rooms and adults from --body instead of the defaults", () => {
    const { values } = parse(["--body", '{"rooms":2,"adults":3}'], RATES_OPTIONS);
    const body = ratesBody(values);
    assert.equal(body.rooms, 2);
    assert.equal(body.adults, 3);
  });
});

describe("currency", () => {
  const env = { FORTRIP_CURRENCY: " eur " };

  it("--currency beats --body, which beats FORTRIP_CURRENCY", () => {
    const flag = parse(["--currency", "jpy"], RATES_OPTIONS).values;
    assert.equal(ratesBody(flag, env).currency, "JPY");
    const body = parse(["--body", '{"currency":"USD"}'], SEARCH_OPTIONS).values;
    assert.equal(searchBody(body, env).currency, "USD");
    assert.equal(searchBody(parse([], SEARCH_OPTIONS).values, env).currency, "EUR");
  });

  it("rejects a blank --currency instead of falling back", () => {
    for (const blank of ["", "  "]) {
      const { values } = parse(["--currency", blank], RATES_OPTIONS);
      assert.throws(() => ratesBody(values, env), isUsage);
    }
  });

  it("is left to the API default when nothing sets it", () => {
    assert.equal("currency" in ratesBody(parse([], RATES_OPTIONS).values, {}), false);
    assert.equal(
      "currency" in searchBody(parse([], SEARCH_OPTIONS).values, { FORTRIP_CURRENCY: " " }),
      false,
    );
  });
});

describe("hotel", () => {
  it("builds the detail path", () => {
    const parsed = parse(["266000", "--with-rooms"], HOTEL_OPTIONS);
    assert.equal(
      hotelPath(parsed.positionals, parsed.values),
      "/api/huizhi/hotels/266000?include=rooms",
    );
  });

  it("requires exactly one numeric id", () => {
    for (const argv of [[], ["abc"], ["1", "2"]]) {
      const parsed = parse(argv, HOTEL_OPTIONS);
      assert.throws(() => hotelPath(parsed.positionals, parsed.values), isUsage);
    }
  });
});

describe("book", () => {
  it("parses guests: last word is the last name, optional :roomNo", () => {
    assert.deepEqual(parseGuest("John Smith"), {
      firstName: "John",
      lastName: "Smith",
      roomNo: 1,
    });
    assert.deepEqual(parseGuest("Mary Ann Lee:2"), {
      firstName: "Mary Ann",
      lastName: "Lee",
      roomNo: 2,
    });
    assert.throws(() => parseGuest("Cher"), isUsage);
  });

  it("maps flags onto the bookings body", () => {
    const { values } = parse(
      [
        "--hotel",
        "266000",
        "--room-id",
        "9191658",
        "--rate-plan",
        "rp_1",
        "--check-in",
        "2026-11-10",
        "--check-out",
        "2026-11-12",
        "--guest",
        "John Smith",
        "--contact-name",
        "John Smith",
        "--contact-phone",
        "+8613800000000",
      ],
      BOOK_OPTIONS,
    );
    assert.deepEqual(bookBody(values), {
      hotelId: 266000,
      roomId: "9191658",
      ratePlanCode: "rp_1",
      checkIn: "2026-11-10",
      checkOut: "2026-11-12",
      rooms: 1,
      adults: 2,
      guests: [{ firstName: "John", lastName: "Smith", roomNo: 1 }],
      contactName: "John Smith",
      contactPhone: "+8613800000000",
    });
  });
});
