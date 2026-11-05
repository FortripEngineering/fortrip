import { HTTP_ROUTES, type PayWay } from "@fortrip/agent-contract";

import { fact } from "../../components/fact.tsx";

export interface PayWayDoc {
  title: string;
  /** When the way is open to an order. */
  when: string;
  /** When the money moves. */
  charge: string;
  /** How to pay this way. */
  body: string;
}

const PAY = `\`${HTTP_ROUTES.pay_order.method} ${HTTP_ROUTES.pay_order.path}\``;
const minutesLeft = fact("LIMITS.tokenPaymentMinOfferMinutes");

/**
 * The ways an order is paid, keyed by the contract's `PayWay`, so a way the
 * contract gains fails the typecheck until it is described. Checked against
 * the server (fortrip-ai `lib/api/v1/orders/pay.ts`, `lib/orders/spt-eligibility.ts`,
 * `lib/orders/wallet-eligibility.ts`, `lib/services/stripe/{shared-payment,wallet-payment,upfront-payment}.ts`):
 * a token's PaymentIntent is manual capture, captured when the hotel
 * confirms and cancelled when it can't; a wallet's is automatic capture,
 * refunded in full when the hotel can't confirm.
 */
export const PAY_WAY_DOCS: Record<PayWay, PayWayDoc> = {
  payment_link: {
    title: "Payment link",
    when: "Every order awaiting payment has one: `payment.url`.",
    charge:
      "The user pays on Stripe Checkout, reached through a Fortrip page. A card is held until the hotel confirms, then charged; a method that can't be held is charged at once and refunded in full if the hotel can't confirm.",
    body: "Show the user the total and every term, wait for a clear yes, then give them `payment.url` exactly as returned. Anyone holding it can pay, except when `requiresSignIn` is `true` (an order started on the Fortrip website): then only the signed-in owner can, on the Fortrip booking page. It stays open until the order is paid, whichever way, or until `payment.expiresAt`.",
  },
  shared_payment_token: {
    title: "Link shared payment token",
    when: "When `payment.handlers` isn't empty and your agent can request a Stripe shared payment token from the user's Link wallet (US and Canadian Link accounts). Never ask the user to type or paste a token.",
    charge:
      "The amount is held until the hotel confirms, then charged; if the hotel can't confirm, the hold is released.",
    body: `Request the token from the user's Link wallet with the handler's \`config.business_profile\` and the order's \`payment.credentialLimits\`, then call ${PAY} (MCP \`pay_order\`, CLI \`fortrip orders pay --token\`) with \`sharedPaymentToken\`, or \`payment\` as UCP's Complete Checkout sends it (\`payment.instruments\`, whose selected instrument is a \`stripe_payments\` \`card\` with a \`stripe_payment_token\` credential), and \`total\`, the order's \`price.total\`. A token pays one order only. \`payment.handlers\` is empty, and \`payment.credentialLimits\` \`null\`, unless the order is charged in USD, at most $${fact("LIMITS.tokenPaymentMaxUsd")}, paid on a page that needs no sign-in (\`requiresSignIn: false\`), without a negotiated price, with at least ${minutesLeft} minutes left to pay, fewer than ${fact("LIMITS.tokensPerOrder")} tokens tried, no token payment under way and no Alipay or WeChat Pay payment opened.`,
  },
  alipay_wechat_pay: {
    title: "Alipay or WeChat Pay",
    when: `When \`payment.wallets\` isn't \`null\`: the order is charged in USD, paid on a page that needs no sign-in, without a negotiated price, with at least ${minutesLeft} minutes left to pay and no token payment under way.`,
    charge:
      "Charged at once when the user pays; if the hotel can't confirm, the payment is refunded in full.",
    body: `Call ${PAY} (MCP \`pay_order\`, CLI \`fortrip orders pay --wallet\`) with \`method\` set to \`"alipay_wechat_pay"\` and \`total\`, the order's \`price.total\`. The answer is the order, whose \`payment.wallets\` holds a WeChat Pay code (\`wechatPay.qrData\` to draw, or \`wechatPay.qrImageUrl\`, a PNG) and a link for each wallet. Show the user the code and both links; they pay once, by one of them. A WeChat Pay code lasts ${fact("LIMITS.wechatCodeMinutes")} minutes; after that the WeChat Pay link opens a new one, or call again. Calling again while the payment is open answers the same payment. Then read the order until it is paid.`,
  },
};
