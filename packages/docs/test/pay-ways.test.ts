// Reads the output of `next build`, which the package's test script runs first.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAY_INPUT_WAYS, PAY_WAYS } from "@fortrip/agent-contract";

import { PAY_WAY_DOCS } from "../lib/prose/pay-ways.ts";
import { pageText } from "./built-page.ts";

describe("ways to pay", () => {
  it("documents exactly the contract's ways, in its order", () => {
    assert.deepEqual(Object.keys(PAY_WAY_DOCS), [...PAY_WAYS]);
  });

  it("says when each way charges", () => {
    assert.match(PAY_WAY_DOCS.shared_payment_token.charge, /held until the hotel confirms/);
    assert.match(PAY_WAY_DOCS.alipay_wechat_pay.charge, /at once/);
    assert.match(PAY_WAY_DOCS.alipay_wechat_pay.charge, /refunded in full/);
    assert.match(PAY_WAY_DOCS.payment_link.charge, /Stripe/);
  });

  it("each pay input is named in the way it pays by, and the API page lists them all", () => {
    for (const [input, way] of Object.entries(PAY_INPUT_WAYS)) {
      assert.ok(PAY_WAY_DOCS[way].body.includes(`\`${input}\``), `${way}: ${input}`);
    }
    const inputs = Object.keys(PAY_INPUT_WAYS);
    const list = `${inputs.slice(0, -1).join(", ")} and ${inputs.at(-1)}`;
    assert.ok(pageText("/api").includes(`exactly one of ${list},`), list);
  });

  for (const route of ["/", "/api"]) {
    it(`${route} names every way`, () => {
      const text = pageText(route);
      for (const way of PAY_WAYS) {
        assert.ok(text.includes(PAY_WAY_DOCS[way].title), `${route}: ${PAY_WAY_DOCS[way].title}`);
      }
    });
  }
});
