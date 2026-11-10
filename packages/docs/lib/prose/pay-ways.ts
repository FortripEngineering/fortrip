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
 * the server's behaviour: a token's PaymentIntent is manual capture, captured
 * when the hotel confirms and cancelled when it can't; a wallet's is automatic
 * capture, refunded in full when the hotel can't confirm.
 */
export const PAY_WAY_DOCS: Record<PayWay, PayWayDoc> = {
  payment_link: {
    title: "Payment link",
    short: "payment link",
    when: "Every order awaiting payment has one: `payment.url`.",
    charge:
      "The user pays through a Fortrip page. On a USD order, Alipay and WeChat Pay are charged at once and refunded in full if the hotel can't confirm; a card, Link or Amazon Pay, on Stripe Checkout, is held until the hotel confirms, then charged. A CNY order continues to a cashier in China (Alipay, WeChat Pay or a bank card from mainland China), charged at once and refunded in full if the hotel can't confirm.",
    body: "Give the user `payment.url` once they have confirmed. Only the signed-in owner can pay it when `requiresSignIn` is `true` (an order started on the Fortrip website).",
  },
  stripe_shared_payment_token: {
    title: "Link token",
    short: "Link token",
    when: "Only for agents that can request a shared payment token from the user's Stripe Link wallet (US and Canadian Link accounts). Otherwise use the payment link or Alipay or WeChat Pay. A token is offered only when the order's `payment.methods` has the `stripe_shared_payment_token` entry; that entry says why it can be absent. Never ask the user to type or paste a token.",
    charge:
      "The amount is held until the hotel confirms, then charged; if the hotel can't confirm, the hold is released.",
    body: `Request the token from the user's Link wallet with that entry's \`handler.config.business_profile\` and its \`limits\`. Then call ${PAY} (MCP \`pay_order\`, CLI \`fortrip orders pay --token\`) with \`sharedPaymentToken\` and \`total\`, the order's \`price.total\`. An agent that speaks [UCP](https://ucp.dev) can send the token as \`payment\`, in the form of UCP's Complete Checkout, instead; [\`pay_order\`](/mcp/pay-order#input) has its shape. A token pays one order only.`,
  },
  stripe_alipay_wechat_pay: {
    title: "Alipay or WeChat Pay",
    short: "Alipay or WeChat Pay",
    when: "Offered only when the order's `payment.methods` has the `stripe_alipay_wechat_pay` entry; that entry is absent when the order can't be paid this way.",
    charge:
      "Charged at once when the user pays; if the hotel can't confirm, the payment is refunded in full.",
    body: `Call ${PAY} (MCP \`pay_order\`, CLI \`fortrip orders pay --method\`) with \`method\` set to \`"stripe_alipay_wechat_pay"\` and \`total\`, the order's \`price.total\`. The answer is the order, whose \`stripe_alipay_wechat_pay\` entry of \`payment.methods\` holds a WeChat Pay code (\`wechatPay.qrData\` to draw, or \`wechatPay.qrImageUrl\`, a PNG) and an Alipay link and a WeChat Pay link. Show the user the code and both links; they pay once, by one of them. Then read the order until it is paid. See [The WeChat Pay code](#wechat-code).`,
  },
};
