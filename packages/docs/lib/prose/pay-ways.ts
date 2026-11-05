import { HTTP_ROUTES, type PayWay } from "@fortrip/agent-contract";

import { fact } from "../../components/fact.tsx";

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
const minutesLeft = fact("LIMITS.payMinMinutesLeft");

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
      "The user pays on Stripe Checkout, reached through a Fortrip page. A card is held until the hotel confirms, then charged; a method that can't be held is charged at once and refunded in full if the hotel can't confirm.",
    body: "Show the user the total and every term, wait for a clear yes, then give them `payment.url` exactly as returned. Anyone holding it can pay, except when `requiresSignIn` is `true` (an order started on the Fortrip website): then only the signed-in owner can, on the Fortrip booking page. It stays open until the order is paid, whichever way, or until `payment.expiresAt`.",
  },
  shared_payment_token: {
    title: "Link token",
    short: "Link token",
    when: "Only for agents that can request a shared payment token from the user's Stripe Link wallet (US and Canadian Link accounts). Otherwise use the payment link or Alipay or WeChat Pay. A token is offered only when the order's `payment.handlers` isn't empty; that field says why it can be empty. Never ask the user to type or paste a token.",
    charge:
      "The amount is held until the hotel confirms, then charged; if the hotel can't confirm, the hold is released.",
    body: `Request the token from the user's Link wallet with the handler's \`config.business_profile\` and the order's \`payment.credentialLimits\`. Then call ${PAY} (MCP \`pay_order\`, CLI \`fortrip orders pay --token\`) with \`sharedPaymentToken\` and \`total\`, the order's \`price.total\`. An agent that speaks [UCP](https://ucp.dev) can send the token as \`payment\`, in the form of UCP's Complete Checkout, instead; [\`pay_order\`](/mcp/pay-order#input) has its shape. A token pays one order only.`,
  },
  alipay_wechat_pay: {
    title: "Alipay or WeChat Pay",
    short: "Alipay or WeChat Pay",
    when: `When \`payment.wallets\` isn't \`null\`: the order is charged in USD, paid on a page that needs no sign-in, without a negotiated price, with at least ${minutesLeft} minutes left to pay and no token payment under way.`,
    charge:
      "Charged at once when the user pays; if the hotel can't confirm, the payment is refunded in full.",
    body: `Call ${PAY} (MCP \`pay_order\`, CLI \`fortrip orders pay --wallet\`) with \`method\` set to \`"alipay_wechat_pay"\` and \`total\`, the order's \`price.total\`. The answer is the order, whose \`payment.wallets\` holds a WeChat Pay code (\`wechatPay.qrData\` to draw, or \`wechatPay.qrImageUrl\`, a PNG) and an Alipay link and a WeChat Pay link. Show the user the code and both links; they pay once, by one of them. A WeChat Pay code lasts ${fact("LIMITS.wechatCodeMinutes")} minutes; after that the WeChat Pay link opens a new one, or call again. Calling again while the payment is open answers the same payment. Then read the order until it is paid.`,
  },
};
