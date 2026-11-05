import { type OrderStatus, type PaymentStatus, SUPPORT_EMAIL } from "@fortrip/agent-contract";

/**
 * What each order status means, keyed by the contract's `OrderStatus`, so a
 * status the contract gains fails the typecheck until it is described.
 * Checked against the server (fortrip-ai `lib/api/v1/orders/status.ts`,
 * `lib/workflows/book-hotel-workflow.ts`, the cancellation progress under `lib/orders/`,
 * `app/(service)/api/stripe/webhook/route.ts`).
 */
export const ORDER_STATUS_DOCS: Record<OrderStatus, string> = {
  awaiting_payment:
    "Created and unpaid; nothing is charged. It can be paid until `payment.expiresAt`, by `payment.url` or another way the order offers.",
  expired:
    "The time to pay ran out with nothing paid, and nothing was charged. It can't be paid any more: get offers again and order anew.",
  confirming:
    "Paid, or the amount held, and the booking is with the hotel. Next comes `confirmed` once the hotel confirms and the payment is charged, `failed` if the hotel can't confirm, or `needs_attention` if a person has to resolve it.",
  confirmed:
    "The hotel confirmed the booking and the payment is charged. `confirmationNumber` is the hotel's number, `null` until the hotel gives one.",
  failed:
    "No stay was booked. `payment.status` says what became of the money: `released` when a hold was let go, `refund_pending` then `refunded` when a charge is refunded in full, `unpaid` when the payment never went through.",
  cancelling:
    "A cancellation is under way with the hotel. If the hotel refuses it, the order reads as it did before, with `cancel.reason` `refused`.",
  cancelled:
    "Cancelled under its terms. The refund is what was paid less the penalty: `payment.status` is `refund_pending` then `refunded`, `released` when the amount was only held, or stays `paid` when the penalty takes the whole amount.",
  needs_attention: `Something needs a person to resolve, and Fortrip is looking into it. The user can email ${SUPPORT_EMAIL} with the order's \`reference\`.`,
};

/**
 * What each payment status means, keyed by the contract's `PaymentStatus`.
 * Checked against the server's mapping (fortrip-ai `lib/api/v1/orders/status.ts`)
 * and where each state is written: a token is held (`lib/orders/spt-payment.ts`),
 * a card on the link is held and a method that can't be held is charged at once
 * (`lib/services/stripe/checkout-sessions.ts`, `upfront-payment.ts`), a wallet
 * payment is charged at once
 * (`lib/orders/wallet-payment.ts`), and a cancellation refunds what was
 * paid less the penalty (`lib/orders/cancellation-refund.ts`).
 */
export const PAYMENT_STATUS_DOCS: Record<PaymentStatus, string> = {
  unpaid: "Nothing is charged or held.",
  authorized:
    "The amount is held, not charged: a shared payment token, or a card on the payment link. It is charged when the hotel confirms, and released if the hotel can't.",
  paid: "Charged. Alipay and WeChat Pay, and a method on the payment link that can't be held, are charged at once, before the hotel confirms.",
  released: "A hold was let go; nothing was charged.",
  refund_pending: "A refund is under way and hasn't completed yet.",
  refunded:
    "Refunded: in full when no stay was booked, or what was paid less the penalty when the order was cancelled.",
};
