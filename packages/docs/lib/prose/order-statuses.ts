import {
  type CancelBlocker,
  type FailureReason,
  type OrderStatus,
  type PaymentStatus,
  SUPPORT_EMAIL,
} from "@fortrip/agent-contract";

/**
 * What each order status means, keyed by the contract's `OrderStatus`, so a
 * status the contract gains fails the typecheck until it is described.
 * Checked against the server's behaviour.
 */
export const ORDER_STATUS_DOCS: Record<OrderStatus, string> = {
  awaiting_payment:
    "Created and unpaid; nothing is charged. It can be paid until `payment.expiresAt`: by `payment.url`, or with a token while `payment.token` is set.",
  expired:
    "Not paid: the time to pay ran out, or the order was closed, and nothing was charged. It can't be paid any more: get offers again and order anew.",
  confirming:
    "Paid, or the amount held, and the booking is with the hotel. Next comes `confirmed` once the hotel confirms and the payment is charged, `failed` if the hotel can't confirm, or `needs_attention` if a person has to resolve it.",
  confirmed:
    "The hotel confirmed the booking and the payment is charged. `confirmationNumber` is the hotel's number, `null` until the hotel gives one.",
  failed:
    "No stay was booked. `failure.reason` says why, and `payment.status` what became of the money: `released` when a hold was let go, `refund_pending` then `refunded` when a charge is refunded in full, `unpaid` when the payment never went through.",
  cancelling:
    "A cancellation is under way with the hotel. If the hotel refuses it, the order reads as it did before, with `cancel.blockedBy` `refused`.",
  cancelled:
    "Cancelled under its terms. `cancelled` holds what the cancellation kept (`penalty`) and returned (`refund`): `payment.status` is `refund_pending` then `refunded`, `released` when the amount was only held, or stays `paid` when the penalty takes the whole amount.",
  needs_attention: `Something needs a person to resolve, and Fortrip is looking into it. The user can email ${SUPPORT_EMAIL} with the order's \`reference\`.`,
};

/**
 * What each payment status means, keyed by the contract's `PaymentStatus`.
 * Checked against the server's behaviour: a token is held, a card on the link
 * is held, a method on the payment page that can't be held is charged at
 * once, and a cancellation refunds what was paid less the penalty.
 */
export const PAYMENT_STATUS_DOCS: Record<PaymentStatus, string> = {
  unpaid: "Nothing is charged or held.",
  authorized:
    "The amount is held, not charged: a shared payment token, or a card on the payment link. It is charged when the hotel confirms, and released if the hotel can't.",
  paid: "Charged. On the payment page, Alipay, WeChat Pay and any other method that can't be held are charged at once, before the hotel confirms.",
  released: "A hold was let go; nothing was charged.",
  refund_pending: "A refund is under way and hasn't completed yet.",
  refunded:
    "Refunded: in full when no stay was booked, or what was paid less the penalty when the order was cancelled.",
};

const SUPPORT = `the user emails ${SUPPORT_EMAIL} with the order's \`reference\``;

/**
 * What each value of an order's `cancel.blockedBy` means and what to do,
 * keyed by the contract's `CancelBlocker`, so a value the contract gains or
 * renames fails the typecheck until it is described.
 */
export const CANCEL_BLOCKER_DOCS: Record<CancelBlocker, string> = {
  payment_in_progress: "Unpaid, with a payment under way. Read the order again shortly.",
  website_checkout:
    "Unpaid, on the Fortrip website's own checkout. It can't be closed here: it expires at `payment.expiresAt` unless the user pays there.",
  expired: "Unpaid, and its time to pay ran out: nothing is booked, and there is nothing to cancel or close.",
  closed: "Unpaid, and closed at the caller's request: nothing is booked, and there is nothing to cancel or close.",
  failed: "No stay was booked, so there is nothing to cancel.",
  confirming: "Paid or held, and the booking is still with the hotel. Read the order again later.",
  cancelling: "A cancellation is already under way. Read the order again later.",
  already_cancelled: "It is already cancelled; `cancelled` says what that kept and returned.",
  stay_started: `The stay has started. For help, ${SUPPORT}.`,
  non_refundable: `The hotel takes no cancellation for this order at all, even one that keeps the whole total, and the booking stands. A rate that only keeps the whole total is not this: it reads \`action: "cancel"\` with a \`penalty\` equal to the total. For help, ${SUPPORT}.`,
  refused: `The hotel refused a cancellation, and the booking stands. For help, ${SUPPORT}.`,
  terms_unknown: `The cancellation terms are not on record. For help, ${SUPPORT}.`,
  support_only: `The booking stands, and it can't be cancelled here. To cancel it, ${SUPPORT}.`,
  needs_attention: `The order's status is \`needs_attention\`: Fortrip is looking into it. For help, ${SUPPORT}.`,
};

/**
 * What each value of a failed order's `failure.reason` means and what to do,
 * keyed by the contract's `FailureReason`.
 */
export const FAILURE_REASON_DOCS: Record<FailureReason, string> = {
  rate_unavailable:
    "The rate could no longer be booked when the hotel was asked. Get offers again and let the user choose again.",
  hotel_refused: `The hotel's booking system refused this order, and would refuse the same order again. Check the guest names with the user, as on the passport, before ordering again; for help, ${SUPPORT}.`,
  unknown: `The reason is not on record. For help, ${SUPPORT}.`,
};
