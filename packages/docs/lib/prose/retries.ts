import { type ErrorCode, ORDER_HTTP, type ToolName } from "@fortrip/agent-contract";

/** What sending a call again does. */
export interface RetryDoc {
  /** The calls, by tool; a row of reads names them by title. */
  tools: readonly ToolName[];
  /** Read calls, named together in one row. */
  reads?: true;
  again: string;
}

/** What to do after a pay call timed out. The one statement of it: the retry
 *  table and the MCP page's timeouts both render it. */
export const PAY_AFTER_TIMEOUT =
  "read the order (`get_order`). If it is still `awaiting_payment`, pay again with the same token, never a new one.";

/**
 * How to retry each code a retry can help: once with the same details, again
 * until it answers (the first call is still running), or by reading the order
 * (another payment is under way). error-docs.test.ts checks these are exactly
 * the codes `ERROR_CODES` marks retryable.
 */
export const RETRY_WAYS = {
  once: ["rate_limited", "ordering_paused", "service_unavailable", "supplier_unavailable"],
  untilAnswered: ["order_in_progress"],
  readOrder: ["payment_in_progress"],
} as const satisfies Record<string, readonly ErrorCode[]>;

/**
 * What a repeated call answers, for the HTTP API and the MCP tools alike.
 * Checked against the server's behaviour: an order's request is matched by
 * its offer and the canonical contact, guests per room and special requests
 * (names with spacing and apostrophes normalized, the email lowercased, the
 * phone as its digits and a leading `+`); an offer is ordered once, and its
 * order answers it whatever its status; a token pays once and its replay answers
 * the first call's outcome; the same cancel mode repeated on an order it
 * already cancelled or closed answers that order.
 */
export const RETRY_DOCS: readonly RetryDoc[] = [
  {
    tools: ["create_order"],
    again: `Safe. The same details answer the same order: HTTP ${ORDER_HTTP.replayedStatus} with \`${ORDER_HTTP.replayedHeader}: true\`, or \`_meta["ai.fortrip/replayed"]\` over MCP. The same details are the same \`offerId\`, contact, guests in each room and special requests; spacing in a name, the email's letter case, and spaces and punctuation in the phone don't count (a leading \`+\` does). Other details answer \`offer_already_ordered\`, even when the offer's order failed or expired. While the first call is still running, the answer is \`order_in_progress\`: send it again after \`retryAfterSeconds\`.`,
  },
  {
    tools: ["pay_order"],
    again: `Safe with the same token: it answers what the first call answered, and the order is never charged twice. After a timeout, ${PAY_AFTER_TIMEOUT} While another payment of the order is under way, the answer is \`payment_in_progress\`: read the order after \`retryAfterSeconds\`.`,
  },
  {
    tools: ["cancel_order"],
    again: "Safe with the same mode. A repeated cancellation answers the order as it is now: `cancelling`, then `cancelled`. A repeated close answers the order, `expired`. The other mode is never applied: `close` on an order paid meanwhile answers `order_not_cancellable`.",
  },
  {
    tools: ["search_hotels", "get_hotel", "get_hotel_offers", "get_order", "list_orders"],
    reads: true,
    again: "Safe. They change nothing; each call counts against its [rate limit](/errors#rate-limits).",
  },
];
