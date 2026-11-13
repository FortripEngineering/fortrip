import type { META_KEYS, ToolName } from "@fortrip/agent-contract";

/**
 * Which results carry each `_meta` key and what it holds, keyed by the
 * contract's `META_KEYS`, so a key the contract gains fails the typecheck
 * until it is described.
 */
export const META_KEY_DOCS: Record<keyof typeof META_KEYS, { on: string; value: string }> = {
  requestId: { on: "Every successful result", value: "The request id to quote to support." },
  replayed: {
    on: "`create_order`",
    value: "`true` when the answer is an order the same details already created.",
  },
  error: { on: "Every error", value: "The [error envelope](/errors#format), as the HTTP API answers it." },
};

/** A paragraph of rules that ends a tool's result text, after the data it
 *  governs (the contract's `renderToolResult` adds each). */
type Rule =
  /** The contract's `PRESENTATION_HINT`: how to show hotels to the user. */
  | "presentation"
  /** The contract's `ORDER_NEXT_STEP`: consent before the payment link. */
  | "consent"
  /** The contract's `PAY_NEXT_STEP`: how to pay with a token. */
  | "pay"
  /** The contract's `CANCEL_NEXT_STEP`: consent before a cancellation. */
  | "cancel";

/**
 * The rules that can end each tool's result text, in the order they come,
 * keyed by the contract's tools so a new tool fails the typecheck until it
 * is described. A successful result is one text block on every tool: the
 * answer, then these paragraphs. The consent rule ends a text that holds a
 * payment link, with only the pay rule, which repeats it, after it; the
 * cancel rule comes before. Checked against `renderToolResult`.
 */
export const MCP_TEXT_RULES: Record<ToolName, readonly Rule[]> = {
  search_hotels: ["presentation"],
  get_hotel: ["presentation"],
  get_hotel_offers: ["presentation"],
  create_order: ["consent", "pay"],
  get_order: ["cancel", "consent", "pay"],
  list_orders: ["cancel", "consent", "pay"],
  cancel_order: [],
  pay_order: [],
};

/** What each rule is, and when the text carries it. */
export const RULE_DOCS: Record<Rule, { name: string; when: string | null; says: string }> = {
  presentation: {
    name: "the presentation hint",
    when: null,
    says: "it asks the model to show only what Fortrip returned, as cards where the client can draw them",
  },
  consent: {
    name: "the consent rule",
    when: "the answer holds a payment link",
    says: "it tells the model what to show the user, and to wait for a clear yes, before it gives the link",
  },
  pay: {
    name: "the pay rule",
    when: 'an order has a "Pay without the link" line',
    says: "it says how to request a shared payment token for the order and pay with `pay_order`, after the same yes",
  },
  cancel: {
    name: "the cancel rule",
    when: "an order can be cancelled now",
    says: "it tells the model to show the penalty and the refund, and to wait for a clear yes, before it cancels",
  },
};

/** "a", "a and b", "a, b and c". */
const series = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items.join("");

/** What `tool`'s result holds, in words: one text block, the answer and the
 *  rules that can end it. */
export function contentSentence(tool: ToolName): string {
  const rules = MCP_TEXT_RULES[tool].map((rule) => {
    const { name, when } = RULE_DOCS[rule];
    return when ? `${name} when ${when}` : name;
  });
  const ending = rules.length > 0 ? `, then ${series(rules)}` : "";
  return `The result is one text block, \`content[0]\`: the answer as compact text${ending}.`;
}
