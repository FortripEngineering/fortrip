import { parseOpen } from "../conventions/open.ts";
import type { Hotel } from "../outputs/hotel.ts";
import type { HotelOffersResult } from "../outputs/offer.ts";
import type { Order, OrderList } from "../outputs/order.ts";
import type { SearchResult } from "../outputs/search.ts";
import {
  CANCEL_NEXT_STEP,
  ORDER_NEXT_STEP,
  TOOLS,
  type ToolName,
} from "../tools.ts";
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
 * result holds a non-null `payment.url`; the cancel rule (`CANCEL_NEXT_STEP`)
 * follows it when a `get_order` or `list_orders` result holds an order with
 * `cancel.available`.
 */
export function renderToolResult(tool: RenderedTool, data: unknown): string {
  const schema = TOOLS.find((t) => t.name === tool)?.output;
  let parsed: unknown;
  try {
    if (!schema) throw new Error(`no output schema for ${tool}`);
    parsed = parseOpen(schema, data);
  } catch {
    const text = `This ${tool} result is not in the expected shape; as JSON:\n${raw(data)}`;
    return [
      text,
      ORDER_TOOLS.has(tool) && holdsPaymentUrl(data) ? ORDER_NEXT_STEP : "",
      CANCEL_TOOLS.has(tool) && holdsCancellable(data) ? CANCEL_NEXT_STEP : "",
    ]
      .filter(Boolean)
      .join("\n\n");
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
      return withConsent(tool, renderOrder(order), [order]);
    }
    case "list_orders": {
      const list = parsed as OrderList;
      return withConsent(tool, renderOrderList(list), list.data);
    }
    case "cancel_order":
      return renderOrder(parsed as Order);
  }
}

const ORDER_TOOLS = new Set<RenderedTool>(["book_hotel", "get_order", "list_orders"]);

/** The reads that carry the cancel rule; `cancel_order`'s own answer doesn't. */
const CANCEL_TOOLS = new Set<RenderedTool>(["get_order", "list_orders"]);

/** Whether a raw value holds a `payment.url` string anywhere inside it. */
function holdsPaymentUrl(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);
  const payment = (value as { payment?: unknown }).payment;
  if (
    typeof payment === "object" &&
    payment !== null &&
    typeof (payment as { url?: unknown }).url === "string" &&
    (payment as { url: string }).url !== ""
  ) {
    return true;
  }
  return Object.values(value).some((v) => holdsPaymentUrl(v, seen));
}

/** Whether a raw value holds an order whose `cancel.available` is true. */
function holdsCancellable(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);
  const cancel = (value as { cancel?: unknown }).cancel;
  if (
    typeof cancel === "object" &&
    cancel !== null &&
    (cancel as { available?: unknown }).available === true
  ) {
    return true;
  }
  return Object.values(value).some((v) => holdsCancellable(v, seen));
}

function withConsent(tool: RenderedTool, text: string, orders: Order[]): string {
  return [
    text,
    orders.some((o) => o.payment.url !== null) ? ORDER_NEXT_STEP : "",
    CANCEL_TOOLS.has(tool) && orders.some((o) => o.cancel?.available === true)
      ? CANCEL_NEXT_STEP
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
