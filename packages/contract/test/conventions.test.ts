import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatMoney, money, usdMoney } from "../src/conventions/money.ts";
import {
  hotelId,
  offerId,
  orderId,
  placeId,
} from "../src/conventions/ids.ts";
import {
  instant,
  localDate,
  localTime,
  timeZone,
} from "../src/conventions/time.ts";

const B62 = "aZ09aZ09aZ09aZ09aZ09";

describe("money", () => {
  it("accepts a decimal string with an uppercase ISO currency", () => {
    assert.equal(money.safeParse({ amount: "132.40", currency: "USD" }).success, true);
    assert.equal(money.safeParse({ amount: "90", currency: "CNY" }).success, true);
  });

  it("rejects numbers, exponents and lowercase currencies", () => {
    assert.equal(money.safeParse({ amount: 132.4, currency: "USD" }).success, false);
    assert.equal(money.safeParse({ amount: "1e3", currency: "USD" }).success, false);
    assert.equal(money.safeParse({ amount: "-1.00", currency: "USD" }).success, false);
    assert.equal(money.safeParse({ amount: "132.40", currency: "usd" }).success, false);
  });

  it("keeps unknown fields in a response Money", () => {
    const parsed = money.parse({ amount: "1.00", currency: "USD", extra: 1 });
    assert.deepEqual(parsed, { amount: "1.00", currency: "USD", extra: 1 });
  });

  it("requires USD in a request Money and rejects unknown fields", () => {
    assert.equal(usdMoney.safeParse({ amount: "10.00", currency: "USD" }).success, true);
    assert.equal(usdMoney.safeParse({ amount: "10.00", currency: "CNY" }).success, false);
    assert.equal(
      usdMoney.safeParse({ amount: "10.00", currency: "USD", extra: 1 }).success,
      false,
    );
  });

  it("formats as currency then amount", () => {
    assert.equal(formatMoney({ amount: "132.40", currency: "USD" }), "USD 132.40");
  });
});

describe("ids", () => {
  it("accepts a prefix plus 20 base62 characters", () => {
    assert.equal(hotelId.safeParse(`htl_${B62}`).success, true);
    assert.equal(offerId.safeParse(`off_${B62}`).success, true);
    assert.equal(orderId.safeParse(`ord_${B62}`).success, true);
  });

  it("rejects short ids, long ids, bad characters and the wrong prefix", () => {
    assert.equal(hotelId.safeParse(`htl_${B62.slice(1)}`).success, false);
    assert.equal(hotelId.safeParse(`htl_${B62}a`).success, false);
    assert.equal(hotelId.safeParse(`htl_${B62.slice(1)}-`).success, false);
    assert.equal(hotelId.safeParse(`off_${B62}`).success, false);
    assert.equal(offerId.safeParse(`htl_${B62}`).success, false);
    assert.equal(orderId.safeParse(`ord_${B62}\n`).success, false);
  });

  it("accepts plc_ with 1 to 12 digits only", () => {
    assert.equal(placeId.safeParse("plc_1796236").success, true);
    assert.equal(placeId.safeParse("plc_1").success, true);
    assert.equal(placeId.safeParse("plc_123456789012").success, true);
    assert.equal(placeId.safeParse("plc_abc").success, false);
    assert.equal(placeId.safeParse("plc_").success, false);
    assert.equal(placeId.safeParse("plc_1234567890123").success, false);
  });
});

describe("time", () => {
  it("accepts RFC 3339 UTC instants only", () => {
    assert.equal(instant.safeParse("2026-10-23T08:00:00Z").success, true);
    assert.equal(instant.safeParse("2026-10-23T08:00:00.123Z").success, true);
    assert.equal(instant.safeParse("2026-10-23T08:00:00+08:00").success, false);
    assert.equal(instant.safeParse("2026-10-23T08:00:00").success, false);
    assert.equal(instant.safeParse("2026-02-30T08:00:00Z").success, false);
  });

  it("accepts real yyyy-MM-dd dates", () => {
    assert.equal(localDate.safeParse("2026-10-23").success, true);
    assert.equal(localDate.safeParse("2026-02-30").success, false);
    assert.equal(localDate.safeParse("2026-1-3").success, false);
  });

  it("accepts HH:mm local times", () => {
    assert.equal(localTime.safeParse("14:00").success, true);
    assert.equal(localTime.safeParse("00:00").success, true);
    assert.equal(localTime.safeParse("24:00").success, false);
    assert.equal(localTime.safeParse("9:05").success, false);
    assert.equal(localTime.safeParse("14:00:00").success, false);
  });

  it("accepts IANA zone names", () => {
    assert.equal(timeZone.safeParse("Asia/Shanghai").success, true);
    assert.equal(timeZone.safeParse("America/Argentina/Buenos_Aires").success, true);
    assert.equal(timeZone.safeParse("+08:00").success, false);
    assert.equal(timeZone.safeParse("Mars/Olympus").success, false);
  });
});
