// Reads the output of `next build`, which the package's test script runs first.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ORDER_STATUSES, PAYMENT_STATUSES, SUPPORT_EMAIL } from "@fortrip/agent-contract";

import { fact } from "../components/fact.tsx";
import { ORDER_STATUS_DOCS, PAYMENT_STATUS_DOCS } from "../lib/prose/order-statuses.ts";
import { pageHtml, pageText } from "./built-page.ts";

describe("order and payment guide", () => {
  it("describes exactly the contract's order and payment statuses, in its order", () => {
    assert.deepEqual(Object.keys(ORDER_STATUS_DOCS), [...ORDER_STATUSES]);
    assert.deepEqual(Object.keys(PAYMENT_STATUS_DOCS), [...PAYMENT_STATUSES]);
  });

  it("renders every status as a row of its table", () => {
    const html = pageHtml("/payments");
    for (const status of [...ORDER_STATUSES, ...PAYMENT_STATUSES]) {
      assert.ok(html.includes(`<td><code>${status}</code></td>`), status);
    }
  });

  it("states the WeChat Pay code's lifetime from the contract, and leaves the token's conditions to payment.handlers", () => {
    const text = pageText("/payments");
    assert.ok(text.includes(`${fact("LIMITS.wechatCodeMinutes")} minutes`));
    assert.ok(!text.includes(`$${fact("LIMITS.tokenPaymentMaxUsd")}`));
    assert.match(text, /payment\.handlers isn't empty; that field says why it can be empty/);
  });

  it("shows the offer_changed details and says to order the new offer, and what happens to the data sent", () => {
    const text = pageText("/payments");
    assert.match(text, /"worse": (true|false)/);
    assert.match(text, /order details\.offer\.offerId; there is no need to fetch offers again/);
    assert.match(text, /go to the hotel to make the booking/);
    assert.match(text, /emails the booking confirmation to the contact/);
    assert.match(pageHtml("/payments"), /href="https:\/\/fortrip\.ai\/privacy"/);
  });

  it("says to pay one way only, and that WeChat can't scan a code on its own screen", () => {
    const text = pageText("/payments");
    assert.match(text, /Pay one way only/);
    assert.match(text, /can't scan a code shown on the same phone/);
    assert.match(text, /Alipay link/);
  });

  it("covers after payment: confirmation number, manageUrl, support, and the cancel pages", () => {
    const text = pageText("/payments");
    assert.ok(text.includes("confirmationNumber"));
    assert.ok(text.includes("manageUrl"));
    assert.ok(text.includes(SUPPORT_EMAIL));
    const html = pageHtml("/payments");
    for (const href of ["/mcp/cancel-order", "/cli/orders-cancel"]) {
      assert.ok(html.includes(`href="${href}"`), href);
    }
  });
});
