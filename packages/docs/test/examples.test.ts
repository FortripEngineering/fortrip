// Holds the example requests the API reference and the OpenAPI document send
// (examples/bodies/ and `EXAMPLE_REQUESTS`) to the contract, so they can't
// drift from it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  containsCardNumber,
  createSearchHotelsInput,
  HTTP_ROUTES,
  type HttpToolName,
  PAY_WAYS,
  TOOLS,
} from "@fortrip/agent-contract";

import { EXAMPLE_REQUESTS } from "../lib/reference/examples.ts";
import { EXAMPLE_IDS } from "../lib/reference/responses.ts";

const root = new URL("../examples/bodies/", import.meta.url).pathname;

// Ids in the contract's formats: a prefix and 20 letters or digits.
const HOTEL = "htl_Qm3xK9vT2pLw7Hn4Rb8Z";
const OFFER = "off_Bz6yN1cD5fGh8JkM2pQs";
const ORDER = "ord_Wr4tY7uI0oPa3SdF6gHj";
const CLAIM = "clm_Hk5vN8cR2xTq6Wm9Lp3Z";

interface Example {
  name: string;
  /** The tool whose input schema the request must satisfy. */
  tool: HttpToolName;
  /** Fields the path and query carry, which are not in the body. */
  fromUrl?: Record<string, unknown>;
  /** The shared body, examples/bodies/<name>.json. */
  body?: boolean;
}

const EXAMPLES: Example[] = [
  { name: "search", tool: "search_hotels", body: true },
  { name: "offers", tool: "get_hotel_offers", body: true },
  { name: "order", tool: "create_order", body: true },
  { name: "price-match", tool: "request_price_match", body: true },
  { name: "get-price-match", tool: "get_price_match", fromUrl: { claimId: CLAIM } },
  { name: "pay-token", tool: "pay_order", fromUrl: { orderId: ORDER }, body: true },
  { name: "get-order", tool: "get_order", fromUrl: { orderId: ORDER } },
  { name: "list-orders", tool: "list_orders", fromUrl: { limit: 10 } },
  { name: "cancel", tool: "cancel_order", fromUrl: { orderId: ORDER }, body: true },
];

const bodyText = (name: string) => readFileSync(join(root, `${name}.json`), "utf8");
const bodyOf = (name: string): Record<string, unknown> => JSON.parse(bodyText(name));

describe("example requests", () => {
  it("every body file belongs to an example, and every example with a body has one", () => {
    assert.deepEqual(
      readdirSync(root).sort(),
      EXAMPLES.filter((e) => e.body).map((e) => `${e.name}.json`).sort(),
    );
  });

  it("each request is valid input for its tool, with the path and query fields added", () => {
    for (const example of EXAMPLES) {
      const input = { ...example.fromUrl, ...(example.body ? bodyOf(example.name) : {}) };
      const schema =
        example.tool === "search_hotels"
          ? createSearchHotelsInput(() => Date.parse("2026-11-05T00:00:00Z"))
          : TOOLS.find((tool) => tool.name === example.tool)?.input;
      assert.ok(schema, example.name);
      const result = schema.safeParse(input);
      assert.ok(result.success, `${example.name}: ${JSON.stringify(result.error?.issues)}`);
      // No field is sent in the body that the route carries in its path.
      if (example.body) {
        for (const field of HTTP_ROUTES[example.tool].pathFields) assert.ok(!(field in bodyOf(example.name)), field);
      }
    }
  });

  it("the API reference sends the same requests", () => {
    for (const example of EXAMPLES) {
      const sent = Object.values(EXAMPLE_REQUESTS)
        .flat()
        .find((request) => request.name === example.name);
      assert.ok(sent, example.name);
      assert.deepEqual(sent.params ?? {}, example.fromUrl ?? {}, example.name);
      assert.deepEqual(sent.body, example.body ? bodyOf(example.name) : undefined, example.name);
    }
    assert.deepEqual(Object.values(EXAMPLE_IDS).sort(), [HOTEL, OFFER, ORDER, CLAIM].sort());
  });

  it("the sample ids are the ones in the contract's formats", () => {
    const text = EXAMPLES.map((e) => JSON.stringify({ ...e.fromUrl, ...(e.body ? bodyOf(e.name) : {}) })).join("\n");
    for (const [prefix, id] of [["htl", HOTEL], ["off", OFFER], ["ord", ORDER], ["clm", CLAIM]] as const) {
      assert.match(id, new RegExp(`^${prefix}_[0-9A-Za-z]{20}$`));
    }
    const used = new Set(text.match(/\b(?:htl|off|ord|clm)_[0-9A-Za-z]+/g));
    assert.deepEqual([...used].sort(), [HOTEL, OFFER, ORDER, CLAIM].sort());
  });

  it("the pay example covers the one way that has a pay request", () => {
    assert.deepEqual(PAY_WAYS.filter((way) => way !== "payment_link"), ["stripe_shared_payment_token"]);
    assert.deepEqual(Object.keys(bodyOf("pay-token")).sort(), ["sharedPaymentToken", "total"]);
  });

  it("no body holds a card number", () => {
    for (const example of EXAMPLES.filter((e) => e.body)) assert.ok(!containsCardNumber(bodyText(example.name)), example.name);
  });
});
