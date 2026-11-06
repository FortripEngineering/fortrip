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
    const list = `${inputs.slice(0, -1).join(", ")} or ${inputs.at(-1)}`;
    assert.ok(pageText("/api").includes(`exactly one of ${list}, for the way it pays.`), list);
  });

  it("/ names every way in one sentence", () => {
    const names = PAY_WAYS.map((way) => PAY_WAY_DOCS[way].short);
    assert.ok(
      pageText("/").includes(`The user pays in one of these ways: ${names.slice(0, -1).join(", ")}, or ${names.at(-1)}. Nothing is charged before that.`),
    );
  });

  it("the Link token way is for agents that can request one, and leaves its conditions to payment.handlers", () => {
    const { when, body } = PAY_WAY_DOCS.shared_payment_token;
    assert.match(when, /^Only for agents that can request a shared payment token from the user's Stripe Link wallet/);
    assert.match(when, /`payment\.handlers` isn't empty; that field says why it can be empty/);
    // The eligibility conditions are the field's (A8), not repeated here.
    assert.doesNotMatch(`${when} ${body}`, /requiresSignIn|negotiated price|tokens tried/);
    assert.doesNotMatch(body, /instruments|stripe_payment_token/);
  });
});
