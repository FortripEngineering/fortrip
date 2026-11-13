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
    // The contact's old `firstName` is not a depth either: it has no place to
    // go to, and is answered as a renamed key (below).
    assert.deepEqual(hints(createOrderInput, { ...order, contact: { ...contact, firstName: "Wei" } }), {
      "/contact/firstName": [],
    });
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
      { path: ["offerId"], belongsAt: [["items", 0, "offerId"]], alreadyAt: [], differsAt: [] },
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
      { path: ["offerId"], belongsAt: [["items", 0, "offerId"]], alreadyAt: [["items", 0, "offerId"]], differsAt: [] },
    ]);
  });

  it("says where it belongs when the home has none", () => {
    assert.deepEqual(said(createOrderInput, { contact, offerId, items: [{ hotel: order.items[0]?.hotel }] }), {
      "/offerId": "belongs at /items/0/offerId",
    });
  });

  // "Belongs at /items/0/offerId" would be an order to overwrite the offer in
  // the item, which is the one the user picked more often than not.
  it("says there are two values when the home has another: send one, where it belongs, never 'belongs at'", () => {
    const other = "off_bbbbbbbbbbbbbbbbbbbb";
    const sent = { ...order, offerId: other };
    assert.deepEqual(said(createOrderInput, sent), {
      "/offerId":
        "two different values were sent, this one and the one at /items/0/offerId: send one only, at /items/0/offerId, the one the user picked",
    });
    assert.doesNotMatch(said(createOrderInput, sent)["/offerId"]!, /belongs at/);
    assert.deepEqual(misplacedKeys(createOrderInput, createOrderInput.safeParse(sent).error?.issues ?? [], sent), [
      { path: ["offerId"], belongsAt: [["items", 0, "offerId"]], alreadyAt: [], differsAt: [["items", 0, "offerId"]] },
    ]);
    // Whole values, as for "already given".
    const rooms = [{ guests: [{ ...guest, firstName: "Li" }] }];
    assert.deepEqual(said(createOrderInput, { contact, items: [{ ...order.items[0], rooms }] }), {
      "/items/0/rooms":
        "two different values were sent, this one and the one at /items/0/hotel/rooms: send one only, at /items/0/hotel/rooms, the one the user picked",
    });
  });

  it("a home that is empty is not a second value", () => {
    // A key its home does not have, or has as undefined, is one value: it belongs there.
    assert.deepEqual(said(createOrderInput, { contact, offerId, items: [{ offerId: undefined, hotel: order.items[0]?.hotel }] }), {
      "/offerId": "belongs at /items/0/offerId",
    });
  });

  it("compares whole values, a list or an object as well as a string", () => {
    const rooms = order.items[0]!.hotel.rooms;
    assert.deepEqual(said(createOrderInput, { contact, items: [{ ...order.items[0], rooms }] }), {
      "/items/0/rooms": "already given at /items/0/hotel/rooms: remove this one",
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
    // One home has it already and another has another value: the copy goes, whatever the other is.
    assert.deepEqual(
      said(searchHotelsInput, { text: "x", currency: "USD", stay: goodStay, filters: { currency: "CNY", price } }),
      { "/filters/currency": "already given at /filters/price/maxPerRoomNight/currency: remove this one" },
    );
    // No home has it, and one has another value: two values.
    assert.deepEqual(said(searchHotelsInput, { text: "x", currency: "USD", filters: { currency: "CNY" } }), {
      "/filters/currency":
        "two different values were sent, this one and the one at /currency: send one only, at /currency, the one the user picked",
    });
  });

  it("says where it belongs when it was not given what was sent", () => {
    const result = createOrderInput.safeParse({ ...order, offerId });
    const [key] = misplacedKeys(createOrderInput, result.error?.issues ?? []);
    assert.equal(misplacedKeyHint(key!), "belongs at /items/0/offerId");
  });
});

/*
 * A 5.x caller sends the contact's name in two parts. Neither part is a key
 * of the 6.0 input at any depth, so the depth hint has nothing to say, and
 * "Unknown field: firstName" alone does not say what replaced it.
 */
describe("misplacedKeys: a key this release renamed", () => {
  it("the contact's firstName and lastName are told the contact takes one name", () => {
    const sent = { ...order, contact: { firstName: "Wei", lastName: "Zhang", email: contact.email, phone: contact.phone } };
    assert.deepEqual(said(createOrderInput, sent), {
      "/contact/firstName": "contact takes one name, the full name: send it as /contact/name",
      "/contact/lastName": "contact takes one name, the full name: send it as /contact/name",
    });
    // With the name given as well: the same words, and nothing about a depth.
    assert.deepEqual(said(createOrderInput, { ...order, contact: { ...contact, lastName: "Zhang" } }), {
      "/contact/lastName": "contact takes one name, the full name: send it as /contact/name",
    });
    assert.deepEqual(misplacedKeys(createOrderInput, createOrderInput.safeParse(sent).error?.issues ?? [], sent)[0], {
      path: ["contact", "firstName"],
      belongsAt: [],
      alreadyAt: [],
      differsAt: [],
      renamed: "contact takes one name, the full name: send it as /contact/name",
    });
  });

  it("only there: a guest keeps both names, and an input without that contact says nothing", () => {
    assert.deepEqual(said(createOrderInput, { ...order, contact: { ...contact, middleName: "X" } }), {});
    // A guest's firstName sent one level up is a depth, as before.
    const rooms = [{ ...guest }];
    assert.deepEqual(said(createOrderInput, { contact, items: [{ offerId, hotel: { rooms } }] }), {
      "/items/0/hotel/rooms/0/firstName": "belongs at /items/0/hotel/rooms/0/guests/0/firstName",
      "/items/0/hotel/rooms/0/lastName": "belongs at /items/0/hotel/rooms/0/guests/0/lastName",
    });
    // Another input with a `contact` of its own shape is not this release's rename.
    const other = z.strictObject({ contact: z.strictObject({ label: z.string() }) });
    const value = { contact: { label: "x", firstName: "Wei" } };
    assert.deepEqual(misplacedKeys(other, other.safeParse(value).error?.issues ?? [], value), []);
    // And it is the contact's key: the same key in another object of an input that has contact.name says nothing.
    const two = z.strictObject({ contact: z.strictObject({ name: z.string() }), billing: z.strictObject({ label: z.string() }) });
    const elsewhere = { contact: { name: "Wei Zhang" }, billing: { label: "x", firstName: "Wei" } };
    assert.deepEqual(misplacedKeys(two, two.safeParse(elsewhere).error?.issues ?? [], elsewhere), []);
    const there = { contact: { name: "Wei Zhang", firstName: "Wei" }, billing: { label: "x" } };
    assert.equal(misplacedKeys(two, two.safeParse(there).error?.issues ?? [], there)[0]?.renamed, "contact takes one name, the full name: send it as /contact/name");
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
    assert.equal(result.error?.issues[0]?.message, "Unknown field: radiusMeters");
    assert.deepEqual(hints(searchHotelsInput, { destination }), {});
  });

  it("lists every place a key has on its line, in the schema's order", () => {
    assert.deepEqual(hints(searchHotelsInput, { text: "x", filters: { currency: "CNY" } }), {
      "/filters/currency": ["/filters/price/maxPerRoomNight/currency", "/currency"],
    });
  });
});
