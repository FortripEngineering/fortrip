import type { ToolName } from "@fortrip/agent-contract";

/** One block of a successful MCP tool result's `content`. */
type Block =
  /** The answer as compact text (the contract's `renderToolResult`). */
  | "text"
  /** The planning guide, as Markdown. */
  | "guide"
  /** The contract's `PRESENTATION_HINT`: how to show hotels to the user. */
  | "presentation_hint"
  /** The WeChat Pay code as a PNG, while the answer holds a live one and
   *  the server could fetch the image (it is left out otherwise). */
  | "wechat_code";

/**
 * The `content` of each tool's successful result, in order, keyed by the
 * contract's tools so a new tool fails the typecheck until it is described.
 * Checked against the server (fortrip-ai `app/(public-api)/api/public/mcp/tools.ts`:
 * `toolResult`, `PRESENTED`, and `walletQrImage` prepended for `pay_order`).
 */
export const MCP_CONTENT: Record<ToolName, readonly Block[]> = {
  get_planning_guide: ["guide"],
  search_hotels: ["text", "presentation_hint"],
  get_hotel: ["text", "presentation_hint"],
  get_hotel_offers: ["text", "presentation_hint"],
  book_hotel: ["text"],
  get_order: ["text"],
  list_orders: ["text"],
  cancel_order: ["text"],
  pay_order: ["wechat_code", "text"],
};

const WHAT: Record<Block, string> = {
  text: "the answer as compact text",
  guide: "the planning guide, as Markdown",
  presentation_hint: "the presentation hint: how to show hotels to the user",
  wechat_code: "the WeChat Pay code as a PNG image",
};

/** The blocks as "`content[0]` is …, and `content[1]` is …". */
const list = (blocks: readonly Block[]) =>
  blocks.map((block, i) => `\`content[${i}]\` is ${WHAT[block]}`).join(", and ");

/** Where each block of `tool`'s content usually is, in words. A WeChat Pay
 *  code is there only while the answer holds a live one and its image could
 *  be fetched; without it, the blocks after it move up one. */
export function contentSentence(tool: ToolName): string {
  const blocks = MCP_CONTENT[tool];
  if (blocks[0] !== "wechat_code") return `${list(blocks)}.`;
  return `When the answer holds a live WeChat Pay code, ${list(blocks)}, unless the image couldn't be fetched; otherwise ${list(blocks.slice(1))}. Find the blocks by \`type\`, not by position.`;
}
