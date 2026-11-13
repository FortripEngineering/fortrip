import { z } from "zod";

import { COMMANDS, commandInvocation } from "../commands.ts";
import { openObject, parseOpen } from "../conventions/open.ts";
import type { Hotel } from "../outputs/hotel.ts";
import type { HotelOffersResult } from "../outputs/offer.ts";
import { type Order, order as orderSchema } from "../outputs/order.ts";
import type { SearchResult } from "../outputs/search.ts";
import {
  cancelNextStep,
  ORDER_NEXT_STEP,
  payNextStep,
  PRESENTATION_HINT,
  type RenderSurface,
  TOOLS,
  type ToolName,
} from "../tools.ts";
import { raw } from "./format.ts";
import { renderHotel } from "./hotel.ts";
import { renderOffers } from "./offers.ts";
import { readableOrder, renderOrder, renderOrderList, UnreadableOrder } from "./order.ts";
import { readableSearch, renderSearch } from "./search.ts";
import { ours, own } from "./third-party.ts";

export { renderError } from "./errors.ts";

/*
 * The text of a tool result (spec D2): the one text block an MCP result
 * holds, and what the CLI prints by default. Pure functions of the public
 * object and the surface: a next call is a tool's arguments over MCP, a
 * command and its flags on the CLI.
 */

export type RenderedTool = ToolName;

/** The tools whose MCP text ends with how to present hotels. */
const HOTEL_TOOLS = new Set<RenderedTool>(["search_hotels", "get_hotel", "get_hotel_offers"]);

/**
 * The whole model-facing text of `data`, the answer of `tool`, on `surface`:
 * tools (`mcp`, the default) or commands (`cli`). Whoever sends it adds
 * nothing: the hosted server and the CLI's bridge send this as the result's
 * one text block.
 *
 * `data` is parsed with the tool's open output schema: unknown fields are
 * ignored, and an unknown value is shown as it came only when it reads as a
 * code. A result that does not parse is shown as JSON, never thrown. A list
 * of orders degrades per order: one that does not parse is JSON on its one
 * line, and the others are shown in full. An optional part that does not
 * parse costs neither: a note's details, and what an order says of a
 * cancellation, a failure or a token request, are then read as not there
 * (`readableSearch`, `readableOrder`).
 *
 * After the data come the rules it governs, each a paragraph, last:
 * - the cancel rule (`cancelNextStep`) when a result holds an order that can
 *   be cancelled now (one that can be closed carries none: closing has no
 *   penalty), for every order tool but `create_order`, whose answer is an
 *   order just made or made before, not one read to cancel;
 * - then the consent rule (`ORDER_NEXT_STEP`) whenever the result holds a
 *   payment link, whichever tool answered, so that it ends the text; only
 *   the pay rule (`payNextStep`) follows it, when an order has a "Pay
 *   without the link" line, and that one repeats it;
 * - on MCP, how to present hotels (`PRESENTATION_HINT`) for `search_hotels`,
 *   `get_hotel` and `get_hotel_offers`. The CLI's text carries none: there
 *   the rule is the skill's, as before.
 */
export function renderToolResult(
  tool: RenderedTool,
  data: unknown,
  surface: RenderSurface = "mcp",
): string {
  const text = resultText(tool, data, surface);
  return surface === "mcp" && HOTEL_TOOLS.has(tool) ? `${text}\n\n${PRESENTATION_HINT}` : text;
}

/** A page of orders, whatever its orders are: each is read on its own. */
const orderPage = openObject({ data: z.array(z.unknown()), nextCursor: z.string().nullable() });

function resultText(tool: RenderedTool, data: unknown, surface: RenderSurface): string {
  const schema = tool === "list_orders" ? orderPage : TOOLS.find((t) => t.name === tool)?.output;
  let parsed: unknown;
  try {
    if (!schema) throw new Error(`no output schema for ${tool}`);
    const readable = READABLE[tool];
    parsed = parseOpen(schema, readable ? readable(data) : data);
  } catch {
    const spec = COMMANDS.find((command) => command.tool === tool);
    const name = surface === "cli" && spec ? commandInvocation(spec) : tool;
    // One line, after our words: the JSON's strings are the data's, in JSON's quotes.
    const text = ours`This ${own(name)} result is not in the expected shape; as JSON: ${raw(data)}`;
    return withRules(text, surface, {
      cancel: CANCEL_TOOLS.has(tool) && holdsCancellable(data),
      consent: ORDER_TOOLS.has(tool) && holdsPaymentUrl(data),
      pay: ORDER_TOOLS.has(tool) && holdsTokenRequest(data),
    });
  }
  switch (tool) {
    case "search_hotels":
      return renderSearch(parsed as SearchResult, surface);
    case "get_hotel":
      return renderHotel(parsed as Hotel);
    case "get_hotel_offers":
      return renderOffers(parsed as HotelOffersResult, surface);
    case "create_order":
    case "get_order":
    case "cancel_order":
    case "pay_order": {
      const order = parsed as Order;
      return withConsent(tool, surface, renderOrder(order, surface), [order]);
    }
    case "list_orders": {
      const page = parsed as z.output<typeof orderPage>;
      const orders = page.data.map((value) => {
        const read = orderSchema.safeParse(readableOrder(value));
        return read.success ? read.data : new UnreadableOrder(value);
      });
      return withConsent(tool, surface, renderOrderList({ ...page, data: orders }, surface), orders);
    }
  }
}

/** How a result is read before it is parsed: without the optional parts
 *  that do not parse. A list's orders are read one by one, after. */
const READABLE: Partial<Record<RenderedTool, (data: unknown) => unknown>> = {
  search_hotels: readableSearch,
  create_order: readableOrder,
  get_order: readableOrder,
  cancel_order: readableOrder,
  pay_order: readableOrder,
};

/** The tools that answer orders: their texts carry the consent rule and the
 *  pay rule by what they hold. */
const ORDER_TOOLS = new Set<RenderedTool>(["create_order", "get_order", "list_orders", "cancel_order", "pay_order"]);

/** Those that carry the cancel rule too: every one but `create_order`. */
const CANCEL_TOOLS = new Set<RenderedTool>(["get_order", "list_orders", "cancel_order", "pay_order"]);

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

/** Whether a raw value holds a `payment.tokenRequest` object anywhere inside it. */
function holdsTokenRequest(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);
  const payment = (value as { payment?: unknown }).payment;
  const request =
    typeof payment === "object" && payment !== null
      ? (payment as { tokenRequest?: unknown }).tokenRequest
      : undefined;
  if (typeof request === "object" && request !== null) return true;
  return Object.values(value).some((v) => holdsTokenRequest(v, seen));
}

/** Whether a raw value holds an order whose `cancel.action` is `cancel`:
 *  a paid one that can be cancelled now, for a penalty. */
function holdsCancellable(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);
  const cancel = (value as { cancel?: unknown }).cancel;
  if (typeof cancel === "object" && cancel !== null && (cancel as { action?: unknown }).action === "cancel") {
    return true;
  }
  return Object.values(value).some((v) => holdsCancellable(v, seen));
}

/** The rules an order's text is followed by. An order of a list that did
 *  not parse is looked through as it came, as a whole result that did not. */
function withConsent(
  tool: RenderedTool,
  surface: RenderSurface,
  text: string,
  orders: (Order | UnreadableOrder)[],
): string {
  const some = (read: (o: Order) => boolean, held: (value: unknown) => boolean) =>
    orders.some((o) => (o instanceof UnreadableOrder ? held(o.value) : read(o)));
  return withRules(text, surface, {
    cancel: CANCEL_TOOLS.has(tool) && some((o) => o.cancel.action === "cancel", holdsCancellable),
    consent: some((o) => o.payment.url !== null, holdsPaymentUrl),
    pay: some((o) => o.payment.tokenRequest !== null, holdsTokenRequest),
  });
}

/**
 * `text` and the rules that apply to it, in the one order they come in: the
 * cancel rule first, then the consent rule, then the pay rule that repeats
 * it. So a result that holds a payment link ends with the rule about giving
 * that link, whatever else it holds.
 */
function withRules(
  text: string,
  surface: RenderSurface,
  applies: { cancel: boolean; consent: boolean; pay: boolean },
): string {
  return [
    text,
    applies.cancel ? cancelNextStep(surface) : "",
    applies.consent ? ORDER_NEXT_STEP : "",
    applies.pay ? payNextStep(surface) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
