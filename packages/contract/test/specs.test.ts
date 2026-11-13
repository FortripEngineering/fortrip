import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import {
  COMMAND_GROUPS,
  COMMANDS,
  commandInvocation,
  GLOBAL_FLAGS,
  type CommandSpec,
  type FlagSpec,
} from "../src/commands.ts";
import { ERROR_CODES } from "../src/errors.ts";
import {
  cancelOrderInput,
  createOrderInput,
  getHotelInput,
  getOrderInput,
  hotelOffersInput,
  listOrdersInput,
  payOrderInput,
  searchHotelsInput,
} from "../src/inputs.ts";
import * as index from "../src/index.ts";
import { LIMITS, SUPPORT_EMAIL } from "../src/limits.ts";
import { readFileSync } from "node:fs";

import { hotel } from "../src/outputs/hotel.ts";
import { hotelOffersResult } from "../src/outputs/offer.ts";
import { order, orderList } from "../src/outputs/order.ts";
import { searchResult } from "../src/outputs/search.ts";
import {
  CANCEL_NEXT_STEP,
  cancelNextStep,
  ORDER_NEXT_STEP,
  META_KEYS,
  SERVER_INFO,
  TOOLS,
  type ToolName,
  type ToolSpec,
} from "../src/tools.ts";

// The production bundle never runs zod's `config(en())`: messages asserted
// here must be our own.
z.config({ localeError: undefined });

type Json = {
  type?: string;
  description?: string;
  properties?: Record<string, Json>;
  items?: Json;
  oneOf?: Json[];
  anyOf?: Json[];
  required?: string[];
  default?: unknown;
  const?: unknown;
  enum?: unknown[];
  [key: string]: unknown;
};

function jsonOf(schema: z.ZodType, io: "input" | "output" = "input"): Json {
  return z.toJSONSchema(schema, { io }) as Json;
}

/** The branches a node may be: itself, or each branch of its union. */
function branches(node: Json): Json[] {
  return node.oneOf ?? node.anyOf ?? [node];
}

/**
 * The JSON schema of `path`: dots step into objects, into the items of a
 * list and into the branches of a union. In a union, the branch is the one
 * whose constants match `sets` (`destination.kind: "place"`), else the first
 * that has the field.
 */
function fieldOf(
  json: Json,
  path: string,
  sets: Readonly<Record<string, string>> = {},
): Json | undefined {
  let node: Json | undefined = json;
  const walked: string[] = [];
  for (const part of path.split(".")) {
    if (node?.type === "array" && node.items) node = node.items;
    const prefix = walked.join(".");
    const matches: Json[] = node
      ? branches(node).filter((branch) => {
          if (!branch.properties?.[part]) return false;
          return Object.entries(sets).every(([key, value]) => {
            const [head, ...rest] = key.split(".");
            if (rest.length !== 1 || head !== prefix) return true;
            return branch.properties?.[rest[0] as string]?.const === value;
          });
        })
      : [];
    node = matches[0]?.properties?.[part];
    walked.push(part);
  }
  return node;
}

function tool(name: ToolName): ToolSpec {
  const found = TOOLS.find((spec) => spec.name === name);
  assert.ok(found, name);
  return found;
}

/** A command as typed after `fortrip`: `hotels search`, `login`. */
function typed(spec: CommandSpec): string {
  return commandInvocation(spec).replace(/^fortrip /, "");
}

function command(name: string): CommandSpec {
  const found = COMMANDS.find((spec) => typed(spec) === name);
  assert.ok(found, name);
  return found;
}

/** The input a command's tool takes; throws for a command without one. */
function inputOf(spec: CommandSpec): z.ZodType {
  assert.ok(spec.tool, `${typed(spec)} has no tool`);
  const input = tool(spec.tool).input;
  assert.ok(input, `${spec.tool} has no input`);
  return input;
}

/** The supplier's name, assembled so this file doesn't carry it. */
const SUPPLIER = new RegExp(["hui" + "zhi", "汇" + "智"].join("|"), "i");

/** Every string in a value, however deep. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => [
      key,
      ...strings(item),
    ]);
  }
  return [];
}

const HTL = "htl_0123456789abcdefABCD";
const ORD = "ord_0123456789abcdefABCD";
const usd = (amount: string) => ({ amount, currency: "USD" });

const orderFixture = {
  orderId: ORD,
  reference: "FT-7KQ2MX",
  status: "awaiting_payment",
  createdAt: "2026-10-24T08:00:00Z",
  updatedAt: "2026-10-24T08:01:00Z",
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
              maxOccupancy: null,
              window: null,
            },
            meals: {
              known: false,
              included: null,
              unspecifiedMainMeals: null,
              allInclusive: null,
              guestsCoveredPerRoom: null,
              label: null,
            },
          },
        ],
        specialRequests: null,
        cancellation: {
          status: "unknown",
          readAt: "2026-10-24T08:00:00Z",
          freeCancellationEndsAt: null,
          penalties: [],
          timeZone: "Asia/Shanghai",
        },
        confirmation: null,
        payAtProperty: { disclosure: "incomplete", items: [] },
        confirmationNumber: null,
      },
    },
  ],
  total: usd("132.40"),
  payment: {
    status: "unpaid",
    url: "https://fortrip.ai/booking-status?session_id=cs_test_1",
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

const TOOL_NAMES = [
  "search_hotels",
  "get_hotel",
  "get_hotel_offers",
  "create_order",
  "get_order",
  "list_orders",
  "cancel_order",
  "pay_order",
] as const;

describe("TOOLS", () => {
  // Payment methods change; the currency text names the channel, not a list.
  it("currency says each currency has its own channel, and lists no payment methods", () => {
    for (const name of ["search_hotels", "get_hotel_offers"]) {
      const spec = TOOLS.find((t) => t.name === name)!;
      const json = z.toJSONSchema(spec.input, { io: "input" }) as unknown as { properties: { currency: { description: string } } };
      const text = json.properties.currency.description;
      assert.match(text, /Each currency is paid through its own channel, with its own payment methods; the order's payment page shows them\./, name);
      assert.match(text, /CNY is paid through payment channels in mainland China and suits a user who pays that way\./, name);
      assert.doesNotMatch(text, /Alipay|WeChat|bank card|currency_unavailable|where available/, name);
    }
  });

  it("lists the eight tools in call order", () => {
    assert.deepEqual(
      TOOLS.map((spec) => spec.name),
      [...TOOL_NAMES],
    );
  });

  // Titles are what MCP clients show people.
  it("titles every tool", () => {
    assert.deepEqual(
      Object.fromEntries(TOOLS.map((spec) => [spec.name, spec.title])),
      {
        search_hotels: "Search hotels",
        get_hotel: "Hotel details",
        get_hotel_offers: "Live offers",
        create_order: "Create order",
        get_order: "Get order",
        list_orders: "List orders",
        cancel_order: "Cancel order",
        pay_order: "Pay order",
      },
    );
  });

  // The fact stays here; which link the user then pays is a rule, and rides
  // on the offer_already_ordered error (render.test.ts).
  it("create_order says another order of a stay takes a new offer", () => {
    const create = TOOLS.find((t) => t.name === "create_order");
    assert.match(
      create?.description ?? "",
      /An offer is ordered once: another order of the stay \(another party, or a corrected guest name or contact\) takes a new offer\./,
    );
    assert.doesNotMatch(create?.description ?? "", /tell the user/);
  });

  it("pay_order describes paying by token: who can, for which order, what it takes and answers", () => {
    const pay = TOOLS.find((t) => t.name === "pay_order")?.description ?? "";
    assert.match(pay, /^Pay a USD order without its payment link, with a Stripe shared payment token: for an agent that can request one from the user's Link wallet/);
    // The order's text names what the token is requested with, by its label.
    assert.match(pay, /an order whose text has a "Pay without the link" line, which gives the business_profile and the usage limits to request the token with/);
    assert.match(pay, /It takes the orderId, the token as sharedPaymentToken and the order's total; a token pays one order\./);
    // Paid by token only: no trace of a method to choose, or of the wallets that left.
    assert.doesNotMatch(pay, /Alipay|WeChat|method/i);
    // Pinned by a paired eval (R4, pay consent): cut only once the eval covers the result text.
    assert.match(pay, /Call it only after the user confirmed the order's total and currency, the stay with each room's guests, the contact, any special requests and every term with a clear yes\./);
    assert.match(TOOLS.find((t) => t.name === "create_order")?.description ?? "", /on that page or with pay_order; anyone holding the link can pay/);
  });

  it("gives every tool a title and a description of at most 1,024 characters", () => {
    for (const spec of TOOLS) {
      assert.ok(spec.title.trim(), `${spec.name} title`);
      assert.ok(spec.description.trim(), `${spec.name} description`);
      assert.ok(
        spec.description.length <= 1024,
        `${spec.name}: ${spec.description.length} characters`,
      );
    }
  });

  // Spec §6: MCP tool inputs mirror the HTTP bodies and query exactly.
  it("every tool's input is the HTTP request schema", () => {
    assert.equal(tool("search_hotels").input, searchHotelsInput);
    assert.equal(tool("get_hotel").input, getHotelInput);
    assert.equal(tool("get_hotel_offers").input, hotelOffersInput);
    assert.equal(tool("create_order").input, createOrderInput);
    assert.equal(tool("get_order").input, getOrderInput);
    assert.equal(tool("list_orders").input, listOrdersInput);
    assert.equal(tool("cancel_order").input, cancelOrderInput);
    assert.equal(tool("pay_order").input, payOrderInput);
  });

  it("every tool has an output schema", () => {
    assert.equal(tool("search_hotels").output, searchResult);
    assert.equal(tool("get_hotel").output, hotel);
    assert.equal(tool("get_hotel_offers").output, hotelOffersResult);
    assert.equal(tool("create_order").output, order);
    assert.equal(tool("get_order").output, order);
    assert.equal(tool("list_orders").output, orderList);
    assert.equal(tool("cancel_order").output, order);
    assert.equal(tool("pay_order").output, order);
  });

  // Spec D2: an MCP result is one text block, so no tool answers a schema of
  // its own over MCP, and nothing carries a rule as a field.
  it("a tool's output is its HTTP answer: no MCP-only field", () => {
    for (const spec of TOOLS) {
      assert.equal(jsonOf(spec.output, "output").properties?.nextStep, undefined, spec.name);
    }
  });

  // Claude's connector review asks destructiveHint: true "for tools that
  // modify or delete data": every tool that writes is destructive, so the
  // client confirms each call that creates, pays for or cancels an order.
  it("states all four hints on every tool; create_order, cancel_order and pay_order write, and every tool that writes is destructive", () => {
    const writes = ["create_order", "cancel_order", "pay_order"];
    for (const spec of TOOLS) {
      assert.deepEqual(
        Object.keys(spec.annotations).sort(),
        ["destructiveHint", "idempotentHint", "openWorldHint", "readOnlyHint"],
        spec.name,
      );
      assert.equal(spec.annotations.readOnlyHint, !writes.includes(spec.name), spec.name);
      assert.equal(spec.annotations.destructiveHint, writes.includes(spec.name), spec.name);
      // The same call again answers the same order: none repeats its effect.
      assert.equal(spec.annotations.idempotentHint, true, spec.name);
    }
    assert.deepEqual(
      Object.fromEntries(
        TOOLS.map((spec) => [spec.name, spec.annotations.openWorldHint]),
      ),
      {
        search_hotels: true,
        get_hotel: true,
        get_hotel_offers: true,
        create_order: true,
        get_order: false,
        list_orders: false,
        cancel_order: true,
        pay_order: true,
      },
    );
  });

  // Spec D1: the same details answer the same order while the offer is held.
  it("create_order's and pay_order's hints are destructive, idempotent, open world", () => {
    for (const name of ["create_order", "pay_order"] as const) {
      assert.deepEqual(tool(name).annotations, {
        readOnlyHint: false,
        idempotentHint: true,
        openWorldHint: true,
        destructiveHint: true,
      });
    }
  });

  // C6: a replay answers the current order, so cancel_order is idempotent.
  it("cancel_order's hints are destructive, idempotent, open world", () => {
    assert.deepEqual(tool("cancel_order").annotations, {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
      destructiveHint: true,
    });
  });

  it("get_hotel_offers names the hotel limit and the default offers per hotel from the code", () => {
    const { description } = tool("get_hotel_offers");
    assert.ok(description.includes(`up to ${LIMITS.offersHotels} hotels`), description);
    assert.ok(
      description.includes(`default ${LIMITS.offersPerHotelDefault}`),
      description,
    );
  });

  // C2: the result is an unpaid order with a payment link.
  it("create_order says it answers an unpaid order with a payment link, and where changes go", () => {
    const { description } = tool("create_order");
    // A paired eval (Haiku, S6) lost bookings when these two were cut:
    // one guest per room is enough, and offer_changed needs the user again.
    assert.ok(description.includes("Send the contact and, for each room of the offer, at least one guest."));
    assert.ok(description.includes("the answer is offer_changed with every change and a new offer: show the changes and ask the user again before ordering it."));
    assert.match(description, /^Create an unpaid order for one offer from get_hotel_offers\./);
    assert.match(description, /payment link/);
    assert.ok(description.includes(SUPPORT_EMAIL), description);
    // Spec §5.7: create_order points to cancel_order instead.
    assert.doesNotMatch(description, /can't change or cancel/);
    assert.match(description, /cancel_order/);
  });

  // The first order call of a weaker model nested everything correctly and
  // also sent a top-level offerId, which a strict input refuses (39 of 39
  // runs). The shape says where the offer goes, three times over.
  it("create_order's input starts with items, and says the offer goes inside its item and nowhere else", () => {
    const json = jsonOf(createOrderInput);
    assert.deepEqual(Object.keys(json.properties ?? {}), ["items", "contact"]);
    assert.match(
      tool("create_order").description,
      /It takes items, one item with the offer's offerId inside it \(nowhere else in the arguments\) and hotel\.rooms, and contact\./,
    );
    assert.match(json.properties?.items?.description ?? "", /The offerId goes inside the item, not beside items\.$/);
    assert.match(
      fieldOf(json, "items.offerId")?.description ?? "",
      /It goes here, inside the item, and nowhere else in the request\.$/,
    );
  });

  it("cancel_order carries the consent rule, says what it takes and what it answers", () => {
    const { description } = tool("cancel_order");
    // Pinned by a paired eval (R2, cancel consent): cut only once the eval
    // covers the result text. It names the order's Cancel line, which the
    // model reads, not a field of the JSON it doesn't.
    assert.match(description, /only after the user confirmed the penalty and the refund on that line with a clear yes, pass maximumPenalty, that penalty exactly as shown\./);
    assert.match(description, /It takes the orderId and exactly one of maximumPenalty \(a paid order\) and close: true \(an unpaid one\)\./);
    assert.match(description, /The order becomes cancelling, then cancelled with the refund on its way, or confirmed again if the hotel refuses\./);
    assert.match(description, /the answer is cancellation_changed and nothing changed\./);
  });

  it("cancel_order says what closing does, and that neither mode ever does the other's work", () => {
    const { description, annotations } = tool("cancel_order");
    assert.match(description, /^Cancel a paid order under its terms, or close an unpaid one\./);
    assert.match(description, /close: true closes it: nothing is charged, and it can no longer be paid\./);
    assert.match(description, /answers order_not_cancellable, which says which mode applies now or what blocks both: nothing is cancelled or closed by the other mode\./);
    assert.match(description, /While a payment is under way the answer is payment_in_progress\./);
    assert.ok(description.length <= 1024, String(description.length));
    assert.equal(annotations.destructiveHint, true);
    assert.equal(annotations.idempotentHint, true);
  });

  it("a description names only tools there are", () => {
    const names = new Set<string>(TOOLS.map((spec) => spec.name));
    // Snake-case words a text may name besides tools: the contract's own
    // codes and enum values.
    const vocabulary = new Set<string>([
      ...Object.keys(ERROR_CODES),
      ...TOOLS.flatMap((spec) =>
        [
          spec.input && jsonOf(spec.input),
          spec.output && jsonOf(spec.output, "output"),
        ].flatMap((json) => (json ? strings(json) : [])),
      ),
    ]);
    const texts = [
      ...TOOLS.map((spec) => spec.description),
      ...TOOLS.flatMap((spec) =>
        [spec.input, spec.output].flatMap((schema) =>
          schema ? strings(jsonOf(schema)) : [],
        ),
      ),
      ORDER_NEXT_STEP,
      CANCEL_NEXT_STEP,
    ];
    for (const text of texts) {
      for (const [word] of text.matchAll(/\b(get|search|create|list|cancel|pay)_[a-z_]+\b/g)) {
        assert.ok(names.has(word) || vocabulary.has(word), `${word} in: ${text}`);
      }
    }
  });
});

describe("ORDER_NEXT_STEP", () => {
  // The consent phrases, for an order's payment link.
  it("tells the model to show the order, ask, and give the link only after a yes", () => {
    assert.match(
      ORDER_NEXT_STEP,
      /[Ss]how them [^.]*total[^.]*currency[^.]*stay[^.]*every term/,
    );
    assert.match(ORDER_NEXT_STEP, /end your reply by asking them to confirm, and wait for a clear yes/);
    assert.match(
      ORDER_NEXT_STEP,
      /Only after they say yes, give them the payment link exactly as shown\.$/,
    );
  });

  it("names no tool", () => {
    for (const name of TOOL_NAMES) {
      assert.ok(!ORDER_NEXT_STEP.includes(name), name);
    }
    assert.doesNotMatch(ORDER_NEXT_STEP, /\b[a-z]+_[a-z_]+\b/);
  });
});

describe("CANCEL_NEXT_STEP", () => {
  // Spec §5.7: the consent rule of a cancellation, shaped like the payment one.
  it("tells the model to show the stay, the penalty and the refund, ask, and wait for a yes", () => {
    assert.match(
      CANCEL_NEXT_STEP,
      /^Before you call cancel_order with maximumPenalty, show the user [^.]*stay[^.]*the penalty and the refund on its Cancel line \(amount and currency\)/,
    );
    assert.match(CANCEL_NEXT_STEP, /end your reply by asking them to confirm the cancellation, and wait for a clear yes/);
    // The penalty is the order's own, by the call on its Cancel line: the
    // paragraph gives no figure a model could pass in its place.
    assert.ok(
      CANCEL_NEXT_STEP.includes(
        "Then make the call that Cancel line gives, exactly as shown: its maximumPenalty is the penalty on that line, never a figure from anywhere else.",
      ),
    );
    assert.doesNotMatch(CANCEL_NEXT_STEP, /\d/);
    assert.match(CANCEL_NEXT_STEP, /Never state a refund the order's text does not show\./);
  });

  // Spec D7: the input picks the mode, and nothing is cancelled or closed by
  // the other one. The paragraph says which order takes which.
  it("says the rule is for a paid order, and how an unpaid one is closed instead", () => {
    assert.match(
      CANCEL_NEXT_STEP,
      /This is for a paid order, one whose Cancel line says it can be cancelled; an unpaid order is closed instead, with close: true and no maximumPenalty, only once the user says they no longer want it\.$/,
    );
    assert.match(cancelNextStep("cli"), /an unpaid order is closed instead, with --close and no --max-penalty, only once the user says they no longer want it\.$/);
  });
});

describe("SERVER_INFO", () => {
  // Spec D6: one constant for the hosted server and the CLI's bridge, which
  // says of the server what its MCP Registry entry says.
  it("is the registry entry's title, description, website and icon", () => {
    const entry = JSON.parse(
      readFileSync(new URL("../../../plugins/registry/server.json", import.meta.url), "utf8"),
    );
    assert.deepEqual(SERVER_INFO, {
      name: "fortrip",
      title: entry.title,
      description: entry.description,
      websiteUrl: entry.websiteUrl,
      icons: entry.icons,
    });
    assert.ok(SERVER_INFO.title && SERVER_INFO.description && SERVER_INFO.icons.length > 0);
  });
});

describe("META_KEYS", () => {
  // The hosted server and the CLI's bridge write the same keys, so both take them from here.
  it("names the three _meta keys of a result, under Fortrip's prefix", () => {
    assert.deepEqual(META_KEYS, {
      requestId: "ai.fortrip/requestId",
      replayed: "ai.fortrip/replayed",
      error: "ai.fortrip/error",
    });
    assert.equal(index.META_KEYS, META_KEYS);
  });
});

describe("COMMAND_GROUPS", () => {
  it("is the hotels and the orders group", () => {
    assert.deepEqual(
      COMMAND_GROUPS.map((group) => group.name),
      ["hotels", "orders"],
    );
    for (const group of COMMAND_GROUPS) {
      assert.ok(group.summary.trim(), `${group.name} summary`);
    }
  });

  it("every group has commands, and every command's group is listed", () => {
    const groups = new Set<string>(COMMAND_GROUPS.map((group) => group.name));
    for (const group of COMMAND_GROUPS) {
      assert.ok(
        COMMANDS.some((spec) => spec.group === group.name),
        `${group.name} has no commands`,
      );
    }
    for (const spec of COMMANDS) {
      if (spec.group !== null) assert.ok(groups.has(spec.group), typed(spec));
    }
  });

  // The CLI reads its first argument as a group before a command, so a
  // command named like a group could never run.
  it("no group is named like a command typed on its own, or like an option", () => {
    const topLevel = new Set<string>(
      COMMANDS.filter((spec) => spec.group === null).map((spec) => spec.name),
    );
    for (const group of COMMAND_GROUPS) {
      assert.equal(topLevel.has(group.name), false, group.name);
      assert.match(group.name, /^[a-z]+$/, group.name);
      assert.notEqual(group.name, "help");
    }
  });
});

describe("COMMANDS", () => {
  it("lists the thirteen commands, as typed, each with the tool it mirrors", () => {
    const tools: Record<string, ToolName | null> = {
      "hotels search": "search_hotels",
      "hotels get": "get_hotel",
      "hotels offers": "get_hotel_offers",
      "orders create": "create_order",
      "orders get": "get_order",
      "orders list": "list_orders",
      "orders cancel": "cancel_order",
      "orders pay": "pay_order",
      login: null,
      logout: null,
      whoami: null,
      mcp: null,
    };
    assert.deepEqual(COMMANDS.map(typed), Object.keys(tools));
    for (const spec of COMMANDS) {
      assert.ok(spec.summary.trim(), `${typed(spec)} summary`);
      assert.equal(spec.tool, tools[typed(spec)], typed(spec));
    }
  });

  it("names a command once within its group", () => {
    const invocations = COMMANDS.map(commandInvocation);
    assert.equal(new Set(invocations).size, invocations.length);
    for (const spec of COMMANDS) {
      assert.match(spec.name, /^[a-z]+$/, typed(spec));
    }
  });

  it("commandInvocation puts the group, if any, between fortrip and the name", () => {
    assert.equal(commandInvocation(command("orders list")), "fortrip orders list");
    assert.equal(commandInvocation(command("hotels offers")), "fortrip hotels offers");
    assert.equal(commandInvocation(command("whoami")), "fortrip whoami");
  });

  it("pins every flag to its field", () => {
    const fields = (name: string) =>
      Object.fromEntries(
        command(name).flags.map((flag) => [
          flag.flag,
          flag.sets
            ? `${flag.field} ${JSON.stringify(flag.sets)}`
            : flag.field,
        ]),
      );
    const kind = (value: string) => `{"destination.kind":"${value}"}`;
    assert.deepEqual(fields("hotels search"), {
      "place-name": `destination.name ${kind("place_name")}`,
      country: `destination.countryCode ${kind("place_name")}`,
      place: `destination.placeId ${kind("place")}`,
      locality: `destination.placeId ${kind("locality")}`,
      point: `destination.location ${kind("point")}`,
      "country-only": `destination.countryCode ${kind("country")}`,
      "radius-meters": "destination.radiusMeters",
      text: "text",
      "check-in": "stay.checkIn",
      "check-out": "stay.checkOut",
      room: "stay.rooms",
      pricing: "pricing",
      "stars-min": "filters.stars.min",
      "stars-max": "filters.stars.max",
      amenity: "filters.amenities",
      "price-max-per-room-night": "filters.price.maxPerRoomNight",
      sort: "sort",
      limit: "limit",
      cursor: "cursor",
      locale: "locale",
      currency: "currency",
    });
    assert.deepEqual(fields("hotels get"), {
      "room-types": "include",
      locale: "locale",
    });
    assert.deepEqual(fields("hotels offers"), {
      hotel: "hotelIds",
      "check-in": "stay.checkIn",
      "check-out": "stay.checkOut",
      room: "stay.rooms",
      "require-breakfast": "filters.requireBreakfast",
      "require-free-cancellation": "filters.requireFreeCancellation",
      "limit-per-hotel": "limitPerHotel",
      locale: "locale",
      currency: "currency",
    });
    assert.deepEqual(fields("orders create"), {
      offer: "items.offerId",
      guest: "items.hotel.rooms.guests",
      name: "contact.name",
      email: "contact.email",
      phone: "contact.phone",
      "special-requests": "items.hotel.specialRequests",
    });
    assert.deepEqual(fields("orders get"), { locale: "locale" });
    assert.deepEqual(fields("orders list"), {
      cursor: "cursor",
      limit: "limit",
      locale: "locale",
    });
    assert.deepEqual(fields("orders cancel"), { "max-penalty": "maximumPenalty", close: "close" });
    assert.deepEqual(fields("orders pay"), { token: "sharedPaymentToken", total: "total" });
    for (const name of ["login", "logout", "whoami", "mcp"]) {
      assert.deepEqual(command(name).flags, [], name);
    }
  });

  it("pins the positionals", () => {
    const positionals = Object.fromEntries(
      COMMANDS.map((spec) => [
        typed(spec),
        (spec.positionals ?? []).map(
          (p) => `<${p.name}> ${p.field}`,
        ),
      ]),
    );
    assert.deepEqual(positionals, {
      "hotels search": [],
      "hotels get": ["<hotelId> hotelId"],
      "hotels offers": [],
      "orders create": [],
      "orders get": ["<orderId> orderId"],
      "orders list": [],
      "orders cancel": ["<orderId> orderId"],
      "orders pay": ["<orderId> orderId"],
      login: [],
      logout: [],
      whoami: [],
      mcp: [],
    });
    for (const spec of COMMANDS) {
      for (const positional of spec.positionals ?? []) {
        assert.ok(positional.description.trim(), `${typed(spec)} ${positional.name}`);
      }
    }
  });

  it("repeats exactly the flags whose field is a list", () => {
    const repeated = COMMANDS.flatMap((spec) =>
      spec.flags.filter((flag) => flag.multiple).map((flag) => `${typed(spec)} ${flag.flag}`),
    );
    assert.deepEqual(repeated, [
      "hotels search room",
      "hotels search amenity",
      "hotels offers hotel",
      "hotels offers room",
      "orders create guest",
    ]);
  });

  it("spells flags in kebab case, once per command, one flag per field and variant", () => {
    for (const spec of COMMANDS) {
      const flags = spec.flags.map((flag) => flag.flag);
      for (const flag of flags) {
        assert.match(flag, /^[a-z]+(-[a-z]+)*$/, `${typed(spec)} --${flag}`);
      }
      assert.equal(new Set(flags).size, flags.length, typed(spec));
      const targets = spec.flags.map(
        (flag) => `${flag.field} ${JSON.stringify(flag.sets ?? {})}`,
      );
      assert.equal(new Set(targets).size, targets.length, typed(spec));
    }
  });

  it("every flag's field resolves in its tool's input JSON Schema, in the variant it picks", () => {
    for (const spec of COMMANDS) {
      if (!spec.tool || !tool(spec.tool).input) {
        assert.deepEqual(spec.flags, [], `${typed(spec)} takes no input`);
        continue;
      }
      const json = jsonOf(inputOf(spec));
      for (const flag of spec.flags) {
        const label = `${typed(spec)} --${flag.flag}`;
        assert.ok(fieldOf(json, flag.field, flag.sets), `${label}: no ${flag.field}`);
        for (const [key, value] of Object.entries(flag.sets ?? {})) {
          assert.equal(fieldOf(json, key, flag.sets)?.const, value, `${label}: ${key}`);
        }
      }
      for (const positional of spec.positionals ?? []) {
        if (positional.field === null) continue;
        assert.ok(fieldOf(json, positional.field), `${typed(spec)} <${positional.name}>`);
      }
    }
  });

  it("resolves dotted fields through objects, lists and union variants", () => {
    const search = jsonOf(searchHotelsInput);
    assert.equal(
      fieldOf(search, "destination.location.lat", { "destination.kind": "point" })?.description,
      "Latitude, WGS84.",
    );
    assert.equal(
      fieldOf(search, "destination.countryCode", { "destination.kind": "country" })?.description,
      "ISO 3166-1 alpha-2 country, e.g. JP.",
    );
    assert.equal(fieldOf(search, "destination.location", { "destination.kind": "place" }), undefined);
    assert.equal(fieldOf(search, "destination.nope"), undefined);
    const booking = jsonOf(createOrderInput);
    assert.match(
      fieldOf(booking, "items.hotel.rooms.guests.firstName")?.description ?? "",
      /first name/,
    );
  });

  it("every input field has a flag or a positional, so the CLI can send any valid request", () => {
    for (const spec of COMMANDS) {
      if (!spec.tool || !tool(spec.tool).input) continue;
      const json = jsonOf(inputOf(spec));
      const reachable = new Set([
        ...spec.flags.map((flag) => flag.field.split(".")[0]),
        ...(spec.positionals ?? []).map((p) => p.field),
      ]);
      assert.deepEqual(
        Object.keys(json.properties ?? {}).filter((key) => !reachable.has(key)),
        [],
        typed(spec),
      );
    }
  });

  it("types each flag after its field", () => {
    // One flag value the CLI parses into an object: `lat,lng`,
    // `adults[:age,…]`, an amount, `room:first:last`.
    const composite = new Set([
      "hotels search point",
      "hotels search room",
      "hotels search price-max-per-room-night",
      "orders pay total",
      "orders cancel max-penalty",
      "hotels offers room",
      "orders create guest",
    ]);
    for (const spec of COMMANDS) {
      if (!spec.flags.length) continue;
      const json = jsonOf(inputOf(spec));
      for (const flag of spec.flags) {
        const label = `${typed(spec)} --${flag.flag}`;
        const field = fieldOf(json, flag.field, flag.sets);
        assert.ok(field, label);
        assert.equal(Boolean(flag.multiple), field.type === "array", label);
        const item = field.type === "array" ? field.items : field;
        assert.ok(item, label);
        if (composite.has(`${typed(spec)} ${flag.flag}`)) {
          assert.equal(flag.type, "string", label);
          assert.equal(item.type, "object", label);
        } else if (flag.value !== undefined) {
          // A boolean flag that sends one value of a field that isn't boolean.
          assert.equal(flag.type, "boolean", label);
          assert.ok(item.enum?.includes(flag.value), label);
        } else if (flag.type === "number") {
          assert.ok(["number", "integer"].includes(item.type ?? ""), label);
        } else {
          assert.equal(item.type, flag.type, label);
        }
      }
    }
  });

  it("only --room-types sends a value instead of true", () => {
    const valued = COMMANDS.flatMap((spec) =>
      spec.flags
        .filter((flag) => flag.value !== undefined)
        .map((flag) => `${typed(spec)} --${flag.flag}=${flag.value}`),
    );
    assert.deepEqual(valued, ["hotels get --room-types=roomTypes"]);
    // Named as what it adds, a hotel's room types: `rooms` is a stay's rooms.
    assert.ok(!COMMANDS.some((spec) => spec.flags.some((flag) => flag.flag === "rooms")));
  });

  it("every flag description is non-empty", () => {
    for (const spec of COMMANDS) {
      for (const flag of spec.flags) {
        assert.ok(flag.description.trim(), `${typed(spec)} --${flag.flag}`);
      }
    }
  });

  it("every non-boolean flag has a placeholder, and a boolean flag has none", () => {
    for (const spec of COMMANDS) {
      for (const flag of spec.flags) {
        const label = `${typed(spec)} --${flag.flag}`;
        if (flag.type === "boolean") {
          assert.equal(flag.placeholder, undefined, label);
        } else {
          assert.ok(flag.placeholder?.trim(), label);
        }
      }
    }
  });

  it("a flag on an enum field lists the enum's values as its placeholder", () => {
    const listed: string[] = [];
    for (const spec of COMMANDS) {
      if (!spec.flags.length) continue;
      const json = jsonOf(inputOf(spec));
      for (const flag of spec.flags) {
        if (flag.type === "boolean") continue;
        const field = fieldOf(json, flag.field, flag.sets);
        const item = field?.type === "array" ? field.items : field;
        const values = item?.enum as string[] | undefined;
        if (!values) continue;
        const label = `${typed(spec)} --${flag.flag}`;
        listed.push(label);
        assert.equal(flag.placeholder, values.join("|"), label);
      }
    }
    assert.deepEqual(listed, [
      "hotels search --pricing",
      "hotels search --amenity",
      "hotels search --sort",
      "hotels search --locale",
      "hotels search --currency",
      "hotels get --locale",
      "hotels offers --locale",
      "hotels offers --currency",
      "orders get --locale",
      "orders list --locale",
    ]);
  });

  it("pins the placeholders of the flags that take ids, dates and composite values", () => {
    const placeholder = (name: string, flag: string) =>
      command(name).flags.find((f) => f.flag === flag)?.placeholder;
    assert.equal(placeholder("hotels search", "place-name"), "<name>");
    assert.equal(placeholder("hotels search", "country"), "<CC>");
    assert.equal(placeholder("hotels search", "place"), "<plc_>");
    assert.equal(placeholder("hotels search", "locality"), "<plc_>");
    assert.equal(placeholder("hotels search", "point"), "<lat,lng>");
    assert.equal(placeholder("hotels search", "country-only"), "<CC>");
    assert.equal(placeholder("hotels search", "room"), "<adults[:age,…]>");
    assert.equal(placeholder("hotels search", "price-max-per-room-night"), "<decimal>");
    assert.equal(placeholder("hotels search", "check-in"), "YYYY-MM-DD");
    assert.equal(placeholder("hotels offers", "hotel"), "<htl_>");
    assert.equal(placeholder("hotels offers", "room"), "<adults[:age,…]>");
    assert.equal(placeholder("orders create", "offer"), "<off_>");
    assert.equal(placeholder("orders create", "guest"), "<room>:<first>:<last>");
    assert.equal(placeholder("orders cancel", "max-penalty"), "<amount>");
  });

  it("no flag or positional description names an MCP tool", () => {
    const toolNames = new RegExp(TOOLS.map((spec) => spec.name).join("|"));
    for (const spec of COMMANDS) {
      for (const text of [
        ...spec.flags.map((flag) => flag.description),
        ...(spec.positionals ?? []).map((p) => p.description),
      ]) {
        assert.doesNotMatch(text, toolNames, typed(spec));
      }
    }
  });

  it("a flag description names a command as it is typed after fortrip", () => {
    const typedNames = new Set(COMMANDS.map(typed));
    const words = new Set<string>([
      ...COMMANDS.map((spec) => spec.name),
      ...COMMAND_GROUPS.map((group) => group.name),
    ]);
    const named: string[] = [];
    for (const spec of COMMANDS) {
      for (const flag of spec.flags) {
        for (const [, code] of flag.description.matchAll(/`([^`]+)`/g)) {
          if (!words.has(code?.split(" ")[0] ?? "")) continue;
          named.push(code as string);
          assert.ok(typedNames.has(code as string), `${typed(spec)} --${flag.flag}: \`${code}\``);
        }
      }
    }
    assert.ok(named.includes("hotels offers"), "the walk found the commands named");
  });

  it("offers have no occupancy defaults", () => {
    const stayJson = fieldOf(jsonOf(hotelOffersInput), "stay");
    assert.ok(stayJson?.required?.includes("rooms"));
    assert.equal(stayJson?.properties?.rooms?.default, undefined);
    for (const flag of command("hotels offers").flags) {
      if (flag.field !== "stay.rooms") continue;
      assert.doesNotMatch(flag.description, /default/i);
    }
  });

  it("nothing points to a runtime guide", () => {
    assert.equal(TOOLS.some((spec) => (spec.name as string) === "get_planning_guide"), false);
    assert.equal(COMMANDS.some((spec) => (spec.name as string) === "guide"), false);
  });
});

describe("CLI-only options", () => {
  const all = (flags: readonly { flag: string }[]) =>
    flags.map((flag) => flag.flag);

  it("GLOBAL_FLAGS are --help, --version and --json", () => {
    assert.deepEqual(
      GLOBAL_FLAGS.map((flag) => [flag.flag, flag.short, flag.type]),
      [
        ["help", "h", "boolean"],
        ["version", "v", "boolean"],
        ["json", undefined, "boolean"],
      ],
    );
  });

  // `orders cancel` sends its mode only from a flag (C7): the penalty the
  // user agreed to, or `--close`.
  it("--body is taken by the commands that send a body, but cancel, --no-browser by login", () => {
    const options = Object.fromEntries(
      COMMANDS.map((spec) => [typed(spec), all(spec.options ?? [])]),
    );
    assert.deepEqual(options, {
      "hotels search": ["body"],
      "hotels get": [],
      "hotels offers": ["body"],
      "orders create": ["body"],
      "orders get": [],
      "orders list": [],
      "orders cancel": [],
      "orders pay": [],
      login: ["no-browser"],
      logout: [],
      whoami: [],
      mcp: [],
    });
    assert.equal(command("login").options?.[0]?.type, "boolean");
    assert.equal(command("hotels search").options?.[0]?.type, "string");
  });

  it("describes every option and collides with no flag", () => {
    for (const spec of COMMANDS) {
      const taken = new Set<string>([
        ...spec.flags.map((flag: FlagSpec) => flag.flag),
        ...all(GLOBAL_FLAGS),
      ]);
      for (const option of [...(spec.options ?? []), ...GLOBAL_FLAGS]) {
        assert.ok(option.description.trim(), `${typed(spec)} --${option.flag}`);
      }
      for (const option of spec.options ?? []) {
        assert.equal(taken.has(option.flag), false, `${typed(spec)} --${option.flag}`);
      }
      for (const flag of spec.flags) {
        assert.equal(all(GLOBAL_FLAGS).includes(flag.flag), false, `${typed(spec)} --${flag.flag}`);
      }
    }
  });

  it("every option that takes a value has a placeholder", () => {
    for (const spec of COMMANDS) {
      for (const option of [...(spec.options ?? []), ...GLOBAL_FLAGS]) {
        const label = `${typed(spec)} --${option.flag}`;
        if (option.type === "boolean") {
          assert.equal(option.placeholder, undefined, label);
        } else {
          assert.ok(option.placeholder?.trim(), label);
        }
      }
    }
  });
});

describe("the specs", () => {
  it("no spec names the supplier", () => {
    const everything = [
      ...strings(TOOLS.map(({ input, output, ...rest }) => rest)),
      ...TOOLS.flatMap((spec) =>
        [spec.input, spec.output].flatMap((schema) =>
          schema ? strings(jsonOf(schema)) : [],
        ),
      ),
      ...strings(COMMANDS),
      ...strings(COMMAND_GROUPS),
      ...strings(GLOBAL_FLAGS),
      ORDER_NEXT_STEP,
      CANCEL_NEXT_STEP,
    ];
    assert.ok(everything.length > 100, "the walk found the specs' text");
    assert.deepEqual(everything.filter((text) => SUPPLIER.test(text)), []);
  });
});
