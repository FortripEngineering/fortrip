// Reads the output of `next build`, which the package's test script runs first.
// Each assertion pins one statement the old docs got wrong (spec §8.1).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ERROR_ROWS } from "../lib/reference/error-docs.ts";
import { pageText } from "./built-page.ts";

const meaning = (code: string) => ERROR_ROWS.find((row) => row.code === code)?.meaning ?? "";

describe("stale statements stay fixed", () => {
  it("/api: three ways to pay, the wallet input, and no additive-only promise", () => {
    const text = pageText("/api");
    assert.doesNotMatch(text, /one of two ways/);
    assert.doesNotMatch(text, /changes only by adding/);
    assert.ok(text.includes("method"));
    assert.ok(text.includes("payment.wallets"));
    assert.ok(text.includes('"alipay_wechat_pay"'));
    // §8.1 item 2: exactly one of the three inputs.
    assert.match(text, /exactly one of sharedPaymentToken, payment and method/);
    // §8.1 item 3, the owner's ruling.
    assert.match(text, /[Uu]ntil general availability/);
    assert.match(text, /major version/);
    assert.match(text, /changelog/);
  });

  it("/mcp: content[0] is not always text", () => {
    const text = pageText("/mcp");
    assert.doesNotMatch(text, /content\[0\] is compact text/);
    assert.match(text, /WeChat Pay code/);
    assert.match(text, /content\[1\]/);
  });

  it("a tool page says where its text is", () => {
    assert.doesNotMatch(pageText("/mcp/pay-order"), /content\[0\] the same answer as compact text/);
    assert.match(pageText("/mcp/pay-order"), /image/);
  });

  it("the intro and quickstart name Alipay or WeChat Pay", () => {
    for (const route of ["/", "/quickstart"]) {
      assert.match(pageText(route), /Alipay|WeChat Pay/, route);
    }
  });

  it("the payment errors cover Alipay and WeChat Pay (checked against the pay handler)", () => {
    // payment_total_changed: the wallet path checks the total before it opens.
    assert.match(meaning("payment_total_changed"), /same token/);
    assert.match(meaning("payment_total_changed"), /Alipay or WeChat Pay/);
    assert.match(meaning("payment_total_changed"), /charged nothing/);
    // payment_method_unavailable: the wallet's own refusals, and a token
    // refused while a wallet payment is open.
    assert.match(meaning("payment_method_unavailable"), /`method`/);
    assert.match(meaning("payment_method_unavailable"), /Alipay or WeChat Pay/);
    assert.match(meaning("payment_method_unavailable"), /`payment\.wallets`/);
  });

  it("/regions states no share its data can't show", () => {
    assert.doesNotMatch(pageText("/regions"), /\d\s?%/);
  });
});
