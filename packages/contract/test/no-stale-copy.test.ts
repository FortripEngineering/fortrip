import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agentSources } from "./agent-texts.ts";

/*
 * Statements that stopped being true in contract 5 (one currency per search
 * and order, cancel_order's Money, the planning guide's removal, one order
 * per offer) and names that left in contract 6 stay out of every text an
 * agent reads: the tool descriptions and schemas, the CLI's commands, the
 * next steps, the guide, every result and error as rendered, the generated
 * skills and the plugins. The docs pages have the same list
 * (packages/docs/test/stale-copy.test.ts).
 */

const STALE: readonly RegExp[] = [
  /payment is in USD/,
  /Charged in USD/,
  /in USD for offers/,
  /total in USD/,
  /the USD total/,
  // A request's money "must be USD or CNY" is the rule, and stays.
  /must be USD(?! or)/,
  /displayCurrency/,
  /display-currency/,
  /\bapprox\b/,
  /--wallet/,
  /payment\.wallets/,
  /payment\.handlers/,
  /credentialLimits/,
  /cancel\.penalty\.amount/,
  /get_planning_guide/,
  /fortrip guide/,
  /US dollars/,
  /(?<!stripe_)alipay_wechat_pay/,
  // One offer is one order: no per-stay check, cap or removed order.
  /order_exists/,
  /order_removed/,
  /order_attempts_exhausted/,
  /ordersPerStay/,
  /[Oo]rders per stay/,
  // Contract 6: agents open no Alipay or WeChat Pay payment, and the total
  // an order refuses has not changed.
  /stripe_alipay_wechat_pay/,
  /Pay with Alipay or WeChat Pay/,
  /wechatPay/,
  /payment_total_changed/,
  // A failed order's reason is one the server can tell apart.
  /details_refused/,
  // Contract 6: the tool and the command that create an order were renamed,
  // an MCP result is text alone, and these names left the shapes.
  /book_hotel/,
  /hotels book/,
  /nextStep/,
  /payment\.methods/,
  /payment\.instruments/,
  /price\.total/,
  /price\.fromPerRoomNight/,
  /perNightAllRooms/,
  /chargeCurrency/,
  /cancel\.(?:available|reason)/,
  /\bmaxAmount\b/,
  /\bhub(?:Total)?\b/,
  /include: "rooms"/,
];

/** Only the token is USD-only: "in USD" is said of it alone. */
const IN_USD = /\bin USD\b/;

describe("no stale copy in what agents read", () => {
  const sources = agentSources();
  const texts = Object.values(sources).flat();

  it("collects the tools, commands, next steps, guide, results, errors, skills and plugins", () => {
    for (const [name, source] of Object.entries(sources)) {
      assert.ok(source.length > 0 && source.every((t) => t.text.trim()), name);
    }
    assert.ok(texts.length > 300, String(texts.length));
    // The exemptions are not vacuous: each holds a statement in USD.
    for (const where of [
      "PAY_NEXT_STEP",
      "renderGuide cli main (Paying without the link)",
      "skills/fortrip-cli/SKILL.md (Paying without the link)",
    ]) {
      assert.match(texts.find((t) => t.where === where)?.text ?? "", IN_USD, where);
    }
  });

  it("states none of the old facts", () => {
    const found = texts.flatMap(({ where, text }) =>
      STALE.filter((pattern) => pattern.test(text)).map((pattern) => `${where}: ${pattern}`),
    );
    assert.deepEqual(found, []);
  });

  it('says "in USD" only of the token', () => {
    const found = texts
      .filter(({ text, usdAllowed }) => !usdAllowed && IN_USD.test(text))
      .map(({ where, text }) => `${where}: …${text.slice(Math.max(0, text.search(IN_USD) - 60), text.search(IN_USD) + 20)}…`);
    assert.deepEqual(found, []);
  });
});
