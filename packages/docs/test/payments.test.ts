// Reads the output of `next build`, which the package's test script runs first.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANCEL_BLOCKERS,
  FAILURE_REASONS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  SUPPORT_EMAIL,
} from "@fortrip/agent-contract";

import { fact } from "../components/fact.tsx";
import {
  CANCEL_BLOCKER_DOCS,
  FAILURE_REASON_DOCS,
  ORDER_STATUS_DOCS,
  PAYMENT_STATUS_DOCS,
} from "../lib/prose/order-statuses.ts";
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

  it("has no WeChat Pay code section, and leaves the token's conditions to payment.token", () => {
    const text = pageText("/payments");
    assert.doesNotMatch(text, /The WeChat Pay code|qrData/);
    assert.ok(!text.includes(`$${fact("LIMITS.tokenPaymentMaxUsd")}`));
    assert.match(text, /A token can pay only while the order's payment\.token is set; that field says when it is null/);
  });

  it("says the payment page, not the agent, offers Alipay and WeChat Pay", () => {
    const text = pageText("/payments");
    assert.match(text, /A USD order: a card, through Stripe Checkout, or Alipay or WeChat Pay\./);
    assert.match(text, /An agent doesn't open or choose any of these: it gives the link, and the user pays\./);
    assert.match(text, /answers payment_method_unavailable with reason payment_open_on_page/);
  });

  it("tells cancel from close, and describes exactly the contract's cancel blockers and failure reasons", () => {
    assert.deepEqual(Object.keys(CANCEL_BLOCKER_DOCS), [...CANCEL_BLOCKERS]);
    assert.deepEqual(Object.keys(FAILURE_REASON_DOCS), [...FAILURE_REASONS]);
    const html = pageHtml("/payments");
    for (const value of [...CANCEL_BLOCKERS, ...FAILURE_REASONS]) {
      assert.ok(html.includes(`<td><code>${value}</code></td>`), value);
    }
    const text = pageText("/payments");
    assert.match(text, /Send exactly one of maximumPenalty and close\. Nothing is ever cancelled or closed by the other mode/);
    assert.match(text, /close on an order paid meanwhile, answers order_not_cancellable with the order's cancel as it is now/);
    assert.match(text, /Exactly one of action and blockedBy is set\./);
    assert.match(text, /A cancelled order's cancelled holds what the cancellation kept and returned: \{ at, penalty, refund \}/);
    // A failed order never reads failure: null (the contract refuses it).
    assert.match(text, /Every failed order has failure: a reason that isn't on record is unknown\. On any other order failure is null\./);
    // The blockers that changed meaning say their one situation.
    assert.match(CANCEL_BLOCKER_DOCS.non_refundable, /takes no cancellation for this order at all, even one that keeps the whole total/);
    assert.match(CANCEL_BLOCKER_DOCS.expired, /its time to pay ran out/);
    assert.match(CANCEL_BLOCKER_DOCS.closed, /closed at the caller's request/);
  });

  it("shows the offer_changed details and says to order the new offer, and what happens to the data sent", () => {
    const text = pageText("/payments");
    assert.match(text, /"worse": (true|false)/);
    assert.match(text, /order details\.offer\.offerId; there is no need to fetch offers again/);
    assert.match(text, /go to the hotel to make the booking/);
    assert.match(text, /emails the booking confirmation to the contact/);
    assert.match(pageHtml("/payments"), /href="https:\/\/fortrip\.ai\/privacy"/);
  });

  it("says to pay one way only", () => {
    assert.match(pageText("/payments"), /Pay one way only/);
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
