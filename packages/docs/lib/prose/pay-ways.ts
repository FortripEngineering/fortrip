import { HTTP_ROUTES, type PayWay } from "@fortrip/agent-contract";

export interface PayWayDoc {
  title: string;
  /** The way's name inside a sentence. */
  short: string;
  /** When the way is open to an order. */
  when: string;
  /** When the money moves. */
  charge: string;
  /** How to pay this way. */
  body: string;
}

const PAY = `\`${HTTP_ROUTES.pay_order.method} ${HTTP_ROUTES.pay_order.path}\``;

/**
 * The ways an order is paid, keyed by the contract's `PayWay`, so a way the
 * contract gains fails the typecheck until it is described. Checked against
 * the server's behaviour: a token's payment is held, charged when the hotel
 * confirms and released when it can't.
 */
export const PAY_WAY_DOCS: Record<PayWay, PayWayDoc> = {
  payment_link: {
    title: "Payment link",
    short: "payment link",
    when: "Every order awaiting payment has one: `payment.url`.",
    charge:
      "The user pays on a Fortrip page, which shows the ways to pay for the order's currency. On a USD order, a card on Stripe Checkout is held until the hotel confirms, then charged; Alipay and WeChat Pay are charged at once and refunded in full if the hotel can't confirm. A CNY order continues to a cashier in mainland China, charged at once and refunded in full if the hotel can't confirm.",
    body: "Give the user `payment.url` once they have confirmed. Only the signed-in owner can pay it when `requiresSignIn` is `true` (an order started on the Fortrip website).",
  },
  stripe_shared_payment_token: {
    title: "Link token",
    short: "Link token",
    when: "Only for agents that can request a shared payment token from the user's Stripe Link wallet (US and Canadian Link accounts). Otherwise use the payment link. A token can pay only while the order's `payment.token` is set; that field says when it is `null`. Never ask the user to type or paste a token.",
    charge:
      "The amount is held until the hotel confirms, then charged; if the hotel can't confirm, the hold is released.",
    body: `Request the token from the user's Link wallet with \`payment.token.handler.config.business_profile\` and \`payment.token.usageLimits\`, copied as they are. Then call ${PAY} (MCP \`pay_order\`, CLI \`fortrip orders pay --token\`) with \`sharedPaymentToken\` and \`total\`, the order's \`total\`. A token pays one order only.`,
  },
};
