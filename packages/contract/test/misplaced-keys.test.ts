import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import { addIsoDateDays } from "../src/dates.ts";
import {
  cancelOrderInput,
  createOrderInput,
  hotelOffersInput,
  payOrderInput,
  searchHotelsInput,
} from "../src/inputs.ts";
import { misplacedKeyHint, misplacedKeys } from "../src/misplaced-keys.ts";

z.config({ localeError: undefined });

const pointer = (path: readonly (string | number)[]) => path.map((step) => `/${step}`).join("");

/** What `misplacedKeys` says of a refused `value`: each misplaced key's
 *  pointer as sent, and the pointers it belongs at. */
function hints(schema: z.ZodType, value: unknown): Record<string, string[]> {
  const result = schema.safeParse(value);
  assert.equal(result.success, false, JSON.stringify(value));
  return Object.fromEntries(
    misplacedKeys(schema, result.error?.issues ?? [], value).map(({ path, belongsAt }) => [
      pointer(path),
      belongsAt.map(pointer),
    ]),
  );
}

const today = new Date().toISOString().slice(0, 10);
const goodStay = {
  checkIn: addIsoDateDays(today, 30),
  checkOut: addIsoDateDays(today, 32),
  rooms: [{ adults: 2, childrenAges: [] }],
};
const hotel = "htl_aaaaaaaaaaaaaaaaaaaa";
const offerId = "off_aaaaaaaaaaaaaaaaaaaa";
const orderId = "ord_aaaaaaaaaaaaaaaaaaaa";
const guest = { firstName: "Wei", lastName: "Zhang" };
const contact = { name: "Wei Zhang", email: "wei@example.com", phone: "+86 138 0013 8000" };
const order = { contact, items: [{ offerId, hotel: { rooms: [{ guests: [guest] }] } }] };

describe("misplacedKeys: create order", () => {
  it("a key sent too shallow belongs deeper, in the first item of each list on the way", () => {
    assert.deepEqual(hints(createOrderInput, { contact, offerId, items: [{ hotel: order.items[0]?.hotel }] }), {
      "/offerId": ["/items/0/offerId"],
    });
    assert.deepEqual(hints(createOrderInput, { contact, items: [{ offerId, guests: [guest], hotel: { rooms: [{}] } }] }), {
      "/items/0/guests": ["/items/0/hotel/rooms/0/guests"],
    });
    assert.deepEqual(hints(createOrderInput, { contact, items: [{ offerId, rooms: [{ guests: [guest] }] }] }), {
      "/items/0/rooms": ["/items/0/hotel/rooms"],
    });
    assert.deepEqual(hints(createOrderInput, { ...order, specialRequests: "High floor", email: "wei@example.com" }), {
      "/specialRequests": ["/items/0/hotel/specialRequests"],
      "/email": ["/contact/email"],
    });
  });

  it("keeps the index of the list item it was sent in", () => {
    const rooms = [{ guests: [guest] }, { ...guest }];
    assert.deepEqual(hints(createOrderInput, { contact, items: [{ offerId, hotel: { rooms } }] }), {
      "/items/0/hotel/rooms/1/firstName": ["/items/0/hotel/rooms/1/guests/0/firstName"],
      "/items/0/hotel/rooms/1/lastName": ["/items/0/hotel/rooms/1/guests/0/lastName"],
    });
  });

  it("a key sent too deep belongs higher", () => {
    const rooms = [{ guests: [guest] }, { guests: [guest], specialRequests: "High floor" }];
    assert.deepEqual(hints(createOrderInput, { contact, items: [{ offerId, hotel: { rooms } }] }), {
      "/items/0/hotel/rooms/1/specialRequests": ["/items/0/hotel/specialRequests"],
    });
    assert.deepEqual(hints(createOrderInput, { items: [{ ...order.items[0], contact }] }), {
      "/items/0/contact": ["/contact"],
    });
  });

  it("says nothing for a key the schema has only in another branch: that is not a depth", () => {
    // A guest's one `name` is not the contact's, nor the contact's
    // `firstName` a guest's.
    assert.deepEqual(
      hints(createOrderInput, { contact, items: [{ offerId, hotel: { rooms: [{ guests: [{ name: "Wei Zhang" }] }] } }] }),
      {},
    );
    assert.deepEqual(hints(createOrderInput, { ...order, contact: { ...contact, firstName: "Wei" } }), {});
  });

  it("says nothing for a key the schema does not know", () => {
    assert.deepEqual(hints(createOrderInput, { ...order, nationality: "CN" }), {});
    assert.deepEqual(hints(createOrderInput, { ...order, nationality: "CN", offerId }), {
      "/offerId": ["/items/0/offerId"],
    });
  });

  it("reads only the unknown-key issues", () => {
    const result = createOrderInput.safeParse({ ...order, contact: { ...contact, email: "wei" } });
    assert.equal(result.success, false);
    assert.deepEqual(misplacedKeys(createOrderInput, result.error?.issues ?? []), []);
    assert.deepEqual(misplacedKeys(createOrderInput, []), []);
  });

  it("answers paths as a zod issue has them", () => {
    const result = createOrderInput.safeParse({ ...order, offerId });
    assert.deepEqual(misplacedKeys(createOrderInput, result.error?.issues ?? []), [
      { path: ["offerId"], belongsAt: [["items", 0, "offerId"]], alreadyAt: [] },
    ]);
  });
});

/** What is said of each misplaced key of a refused `value`, by its pointer. */
function said(schema: z.ZodType, value: unknown): Record<string, string> {
  const result = schema.safeParse(value);
  assert.equal(result.success, false, JSON.stringify(value));
  return Object.fromEntries(
    misplacedKeys(schema, result.error?.issues ?? [], value).map((key) => [pointer(key.path), misplacedKeyHint(key)]),
  );
}

/*
 * The first order call of a weaker model nested everything correctly and
 * also sent `offerId` beside `items` (39 of 39 runs), which a strict input
 * refuses. "Belongs at /items/0/offerId" reads as an order to move it there,
 * where it already is; the answer is to remove the copy.
 */
describe("misplacedKeys: a key that is already where it belongs", () => {
  it("says the copy is to be removed when the home has the same value", () => {
    assert.deepEqual(said(createOrderInput, { ...order, offerId }), {
      "/offerId": "already given at /items/0/offerId: remove this one",
    });
    assert.deepEqual(misplacedKeys(createOrderInput, createOrderInput.safeParse({ ...order, offerId }).error?.issues ?? [], { ...order, offerId }), [
      { path: ["offerId"], belongsAt: [["items", 0, "offerId"]], alreadyAt: [["items", 0, "offerId"]] },
    ]);
  });

  it("says where it belongs when the home has none, or another value", () => {
    assert.deepEqual(said(createOrderInput, { contact, offerId, items: [{ hotel: order.items[0]?.hotel }] }), {
      "/offerId": "belongs at /items/0/offerId",
    });
    assert.deepEqual(said(createOrderInput, { ...order, offerId: "off_bbbbbbbbbbbbbbbbbbbb" }), {
      "/offerId": "belongs at /items/0/offerId",
    });
  });

  it("compares whole values, a list or an object as well as a string", () => {
    const rooms = order.items[0]!.hotel.rooms;
    assert.deepEqual(said(createOrderInput, { contact, items: [{ ...order.items[0], rooms }] }), {
      "/items/0/rooms": "already given at /items/0/hotel/rooms: remove this one",
    });
    assert.deepEqual(said(createOrderInput, { contact, items: [{ ...order.items[0], rooms: [{ guests: [{ ...guest, firstName: "Li" }] }] }] }), {
      "/items/0/rooms": "belongs at /items/0/hotel/rooms",
    });
    assert.deepEqual(said(createOrderInput, { ...order, contact: undefined, items: [{ ...order.items[0], contact }] }), {
      "/items/0/contact": "belongs at /contact",
    });
  });

  it("names every home that has it, and every place it could go when none has", () => {
    const price = { maxPerRoomNight: { amount: "150.00", currency: "CNY" } };
    assert.deepEqual(
      said(searchHotelsInput, { text: "x", currency: "CNY", stay: goodStay, filters: { currency: "CNY", price } }),
      { "/filters/currency": "already given at /filters/price/maxPerRoomNight/currency and /currency: remove this one" },
    );
    assert.deepEqual(said(searchHotelsInput, { text: "x", filters: { currency: "CNY" } }), {
      "/filters/currency": "belongs at /filters/price/maxPerRoomNight/currency or /currency",
    });
  });

  it("says where it belongs when it was not given what was sent", () => {
    const result = createOrderInput.safeParse({ ...order, offerId });
    const [key] = misplacedKeys(createOrderInput, result.error?.issues ?? []);
    assert.equal(misplacedKeyHint(key!), "belongs at /items/0/offerId");
  });
});

describe("misplacedKeys: cancel and pay", () => {
  it("Money's fields sent beside the order belong in the Money", () => {
    assert.deepEqual(hints(cancelOrderInput, { orderId, amount: "12.50", currency: "USD" }), {
      "/amount": ["/maximumPenalty/amount"],
      "/currency": ["/maximumPenalty/currency"],
    });
    const sharedPaymentToken = "spt_1TestToken0123456789";
    assert.deepEqual(hints(payOrderInput, { orderId, sharedPaymentToken, amount: "132.40", currency: "USD" }), {
      "/amount": ["/total/amount"],
      "/currency": ["/total/currency"],
    });
    assert.deepEqual(
      hints(payOrderInput, { orderId, total: { amount: "132.40", currency: "USD", sharedPaymentToken } }),
      { "/total/sharedPaymentToken": ["/sharedPaymentToken"] },
    );
  });

  it("says nothing for a key neither knows", () => {
    assert.deepEqual(hints(cancelOrderInput, { orderId, close: true, penalty: "12.50" }), {});
    assert.deepEqual(hints(cancelOrderInput, { orderId, close: true, refund: 1 }), {});
    assert.deepEqual(hints(payOrderInput, { orderId, token: "spt_1", method: "stripe_alipay_wechat_pay" }), {});
  });
});

describe("misplacedKeys: offers and search", () => {
  const base = { hotelIds: [hotel], stay: goodStay };

  it("the stay's and the filters' fields sent at the top belong inside them", () => {
    assert.deepEqual(hints(hotelOffersInput, { hotelIds: [hotel], ...goodStay }), {
      "/checkIn": ["/stay/checkIn"],
      "/checkOut": ["/stay/checkOut"],
      "/rooms": ["/stay/rooms"],
    });
    assert.deepEqual(hints(hotelOffersInput, { ...base, requireBreakfast: true }), {
      "/requireBreakfast": ["/filters/requireBreakfast"],
    });
    assert.deepEqual(hints(hotelOffersInput, { ...base, stay: { ...goodStay, adults: 2, limitPerHotel: 5 } }), {
      "/stay/adults": ["/stay/rooms/0/adults"],
      "/stay/limitPerHotel": ["/limitPerHotel"],
    });
    assert.deepEqual(hints(hotelOffersInput, { ...base, limit: 5 }), {});
  });

  it("looks into every variant of a union, once", () => {
    assert.deepEqual(hints(searchHotelsInput, { text: "x", radiusMeters: 500, lat: 1 }), {
      "/radiusMeters": ["/destination/radiusMeters"],
      "/lat": ["/destination/location/lat"],
    });
  });

  it("follows only the variant the sent discriminator selects", () => {
    const destination = { kind: "place_name", name: "Tokyo", countryCode: "JP", lat: 35, lng: 139 };
    const result = searchHotelsInput.safeParse({ destination });
    assert.equal(result.success, false);
    assert.deepEqual(hints(searchHotelsInput, { destination }), {});
  });

  it("says nothing for a key that another variant has at the same place", () => {
    const destination = { kind: "country", countryCode: "JP", radiusMeters: 500 };
    const result = searchHotelsInput.safeParse({ destination });
    assert.equal(result.error?.issues[0]?.message, "Unknown argument(s): radiusMeters");
    assert.deepEqual(hints(searchHotelsInput, { destination }), {});
  });

  it("lists every place a key has on its line, in the schema's order", () => {
    assert.deepEqual(hints(searchHotelsInput, { text: "x", filters: { currency: "CNY" } }), {
      "/filters/currency": ["/filters/price/maxPerRoomNight/currency", "/currency"],
    });
  });
});
