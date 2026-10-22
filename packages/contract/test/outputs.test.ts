import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import {
  authConfig,
  bookingResult,
  meResult,
  type BookingResult,
} from "../src/outputs.ts";

const booked: BookingResult = {
  agentOrderId: "ord_abc123",
  paymentUrl: "https://fortrip.ai/booking-status?session_id=cs_test_1",
  amount: 1133,
  currency: "CNY",
  orderUrl: "https://fortrip.ai/orders/ord_abc123",
  statusUrl: "https://fortrip.ai/booking-status?session_id=cs_test_1",
  stay: {
    hotelId: 16525,
    hotelName: "Test Hotel",
    roomName: "Deluxe Room",
    checkIn: "2026-06-24",
    checkOut: "2026-06-26",
    nights: 2,
    rooms: 1,
    adultsPerRoom: 2,
    childrenAgesPerRoom: [5],
  },
  terms: {
    boardCode: "BB",
    boardCount: 2,
    refundable: true,
    freeCancelUntil: "2026-06-22T12:00:00.000+08:00",
    cancellation: [{ amount: 1133, from: "2026-06-22T12:00:00.000+08:00" }],
    isInstantConfirm: true,
    confirmByMins: null,
    payAtHotelFees: [
      { type: "ResortFee", isMandatory: true, amount: 30, currency: "THB" },
    ],
  },
};

describe("bookingResult", () => {
  it("accepts a booking as the server returns it", () => {
    assert.deepEqual(bookingResult.parse(booked), booked);
  });

  it("accepts a booking without a status page, a price, names or terms", () => {
    const { statusUrl: _statusUrl, ...withoutStatus } = booked;
    const bare = {
      ...withoutStatus,
      amount: null,
      stay: { ...booked.stay, hotelName: null, roomName: null },
      terms: null,
    };
    assert.deepEqual(bookingResult.parse(bare), bare);
  });

  it("accepts terms with no confirmation window, cancellation steps or fees", () => {
    const terms = {
      boardCode: "RO",
      boardCount: 0,
      refundable: false,
      freeCancelUntil: null,
      cancellation: [],
      isInstantConfirm: false,
      confirmByMins: 30,
      payAtHotelFees: [],
    };
    assert.deepEqual(bookingResult.parse({ ...booked, terms }).terms, terms);
  });

  it("rejects a missing or mistyped field", () => {
    const { agentOrderId: _agentOrderId, ...withoutId } = booked;
    const { nights: _nights, ...stayWithoutNights } = booked.stay;
    for (const value of [
      withoutId,
      { ...booked, amount: "1133" },
      { ...booked, amount: undefined },
      { ...booked, terms: undefined },
      { ...booked, stay: stayWithoutNights },
      { ...booked, stay: { ...booked.stay, childrenAgesPerRoom: ["5"] } },
      { ...booked, terms: { ...booked.terms, refundable: "yes" } },
      "not an object",
    ]) {
      assert.equal(bookingResult.safeParse(value).success, false);
    }
  });

  it("describes exactly the server's keys: no nextStep, none besides", () => {
    const json = z.toJSONSchema(bookingResult, { io: "output" }) as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: unknown;
    };
    assert.deepEqual(Object.keys(json.properties).sort(), [
      "agentOrderId",
      "amount",
      "currency",
      "orderUrl",
      "paymentUrl",
      "statusUrl",
      "stay",
      "terms",
    ]);
    assert.deepEqual([...json.required].sort(), [
      "agentOrderId",
      "amount",
      "currency",
      "orderUrl",
      "paymentUrl",
      "stay",
      "terms",
    ]);
    assert.equal(json.additionalProperties, false);
  });
});

describe("meResult", () => {
  it("accepts the signed-in user, with an email and a name or without", () => {
    for (const me of [
      { userId: "user_1", email: "a@b.co", name: "A B" },
      { userId: "user_1", email: null, name: null },
    ]) {
      assert.deepEqual(meResult.parse(me), me);
    }
  });

  it("rejects a missing user id, email or name", () => {
    for (const value of [
      { email: null, name: null },
      { userId: "user_1", name: null },
      { userId: "user_1", email: null },
      { userId: 1, email: null, name: null },
    ]) {
      assert.equal(meResult.safeParse(value).success, false);
    }
  });
});

describe("authConfig", () => {
  const config = {
    issuer: "https://clerk.fortrip.ai",
    clientId: "client_1",
    scopes: "openid profile email offline_access",
    deviceAuthorizationEndpoint:
      "https://clerk.fortrip.ai/oauth/device_authorization",
    tokenEndpoint: "https://clerk.fortrip.ai/oauth/token",
    revocationEndpoint: "https://clerk.fortrip.ai/oauth/token/revoke",
  };

  it("accepts the six strings", () => {
    assert.deepEqual(authConfig.parse(config), config);
  });

  it("rejects a missing or non-string field", () => {
    for (const key of Object.keys(config)) {
      const { [key]: _dropped, ...rest } = config as Record<string, string>;
      assert.equal(authConfig.safeParse(rest).success, false, key);
      assert.equal(
        authConfig.safeParse({ ...config, [key]: 1 }).success,
        false,
        key,
      );
    }
  });
});
