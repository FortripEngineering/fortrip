// Reads the output of `next build`, which the package's test script runs first.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAY_WAYS } from "@fortrip/agent-contract";

import { PAY_WAY_DOCS } from "../lib/prose/pay-ways.ts";
import { pageText } from "./built-page.ts";

describe("ways to pay", () => {
  it("documents exactly the contract's ways, in its order", () => {
    assert.deepEqual(Object.keys(PAY_WAY_DOCS), [...PAY_WAYS]);
  });

  it("says when each way charges", () => {
    assert.match(PAY_WAY_DOCS.stripe_shared_payment_token.charge, /held until the hotel confirms/);
    assert.match(PAY_WAY_DOCS.payment_link.charge, /at once/);
    assert.match(PAY_WAY_DOCS.payment_link.charge, /refunded in full/);
    assert.match(PAY_WAY_DOCS.payment_link.charge, /Stripe/);
  });

  it("the pay input is named in the way it pays by, and on the API page", () => {
    assert.ok(PAY_WAY_DOCS.stripe_shared_payment_token.body.includes("`sharedPaymentToken`"));
    assert.ok(
      pageText("/api").includes(
        "takes sharedPaymentToken, the token the user approved for the order, and total, the order's price.total exactly as returned.",
      ),
    );
  });

  it("/ names every way in one sentence", () => {
    const names = PAY_WAYS.map((way) => PAY_WAY_DOCS[way].short);
    assert.ok(
      pageText("/").includes(`The user pays in one of these ways: ${names.slice(0, -1).join(", ")}, or ${names.at(-1)}. Nothing is charged before that.`),
    );
  });

  it("the Link token way is for agents that can request one, and leaves its conditions to its payment.methods entry", () => {
    const { when, body } = PAY_WAY_DOCS.stripe_shared_payment_token;
    assert.match(when, /^Only for agents that can request a shared payment token from the user's Stripe Link wallet/);
    assert.match(when, /`payment\.methods` has the `stripe_shared_payment_token` entry; that entry says why it can be absent/);
    // The eligibility conditions are the field's (A8), not repeated here.
    assert.doesNotMatch(`${when} ${body}`, /requiresSignIn|negotiated price|tokens tried/);
    assert.doesNotMatch(body, /instruments|stripe_payment_token/);
  });
});
