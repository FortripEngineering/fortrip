import { parseOpen } from "../conventions/open.ts";
import type { Hotel } from "../outputs/hotel.ts";
import type { HotelOffersResult } from "../outputs/offer.ts";
import type { Order, OrderList } from "../outputs/order.ts";
import type { SearchResult } from "../outputs/search.ts";
import { ORDER_NEXT_STEP, TOOLS, type ToolName } from "../tools.ts";
import { raw } from "./format.ts";
import { renderHotel } from "./hotel.ts";
import { renderOffers } from "./offers.ts";
import { renderOrder, renderOrderList } from "./order.ts";
import { renderSearch } from "./search.ts";

export { renderError } from "./errors.ts";

/*
 * The compact text of a tool result (spec §12): what MCP sends as
 * `content[0]` and what the CLI prints by default. Pure functions of the
 * public object.
 */

export type RenderedTool = Exclude<ToolName, "get_planning_guide">;

/**
 * Renders `data`, the answer of `tool`, after parsing it with the tool's
 * open output schema: unknown fields are ignored and unknown values shown
 * as they came. A result that does not parse is shown as JSON, never thrown.
 * The consent rule (`ORDER_NEXT_STEP`) is the last paragraph whenever the
 * result holds a non-null `payment.url`.
 */
export function renderToolResult(tool: RenderedTool, data: unknown): string {
  const schema = TOOLS.find((t) => t.name === tool)?.output;
  let parsed: unknown;
  try {
    if (!schema) throw new Error(`no output schema for ${tool}`);
    parsed = parseOpen(schema, data);
  } catch {
    return `This ${tool} result is not in the expected shape; as JSON:\n${raw(data)}`;
  }
  switch (tool) {
    case "search_hotels":
      return renderSearch(parsed as SearchResult);
    case "get_hotel":
      return renderHotel(parsed as Hotel);
    case "get_hotel_offers":
      return renderOffers(parsed as HotelOffersResult);
    case "book_hotel":
    case "get_order": {
      const order = parsed as Order;
      return withConsent(renderOrder(order), [order]);
    }
    case "list_orders": {
      const list = parsed as OrderList;
      return withConsent(renderOrderList(list), list.data);
    }
  }
}

function withConsent(text: string, orders: Order[]): string {
  return orders.some((o) => o.payment.url !== null)
    ? `${text}\n\n${ORDER_NEXT_STEP}`
    : text;
}
