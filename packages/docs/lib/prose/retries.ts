import { ORDER_HTTP, type ToolName } from "@fortrip/agent-contract";

/** What sending a call again does. */
export interface RetryDoc {
  /** The calls, by tool; a row of reads names them by title. */
  tools: readonly ToolName[];
  /** Read calls, named together in one row. */
  reads?: true;
  again: string;
}

/**
 * What a repeated call answers, for the HTTP API and the MCP tools alike.
 * Checked against the server's behaviour: an order's request is matched by
 * its offer and the canonical contact, guests per room and special requests
 * (names with spacing and apostrophes normalized, the email lowercased, the
 * phone as its digits); a token pays once and its replay answers the first
 * call's outcome; an open Alipay or WeChat Pay payment is resumed; a
 * cancellation under way or done is answered as the order reads.
 */
export const RETRY_DOCS: readonly RetryDoc[] = [
  {
    tools: ["book_hotel"],
    again: `Safe. The same details answer the same order: HTTP ${ORDER_HTTP.replayedStatus} with \`${ORDER_HTTP.replayedHeader}: true\`, or \`_meta["ai.fortrip/replayed"]\` over MCP. The same details are the same \`offerId\`, contact, guests in each room and special requests; spacing in a name, the email's letter case and how the phone is written don't count. Other details answer \`offer_already_ordered\`. While the first call is still running, the answer is \`order_in_progress\`: send it again after \`retryAfterSeconds\`.`,
  },
  {
    tools: ["pay_order"],
    again:
      "Safe with the same token: it answers what the first call answered, and the order is never charged twice. After a timeout, send the same token again, never a new one. With `method`, a call while the Alipay or WeChat Pay payment is open answers the same payment, with the same WeChat Pay code while it is live. While another payment of the order is under way, the answer is `payment_in_progress`: read the order after `retryAfterSeconds`.",
  },
  {
    tools: ["cancel_order"],
    again: "Safe. It answers the order as it is now: `cancelling`, then `cancelled`.",
  },
  {
    tools: ["search_hotels", "get_hotel", "get_hotel_offers", "get_order", "list_orders"],
    reads: true,
    again: "Safe. They change nothing; each call counts against its [rate limit](/errors#rate-limits).",
  },
];
