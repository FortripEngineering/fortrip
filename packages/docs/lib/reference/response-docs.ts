import {
  hotel,
  hotelOffersResult,
  meResult,
  order,
  orderList,
  searchResult,
  type ToolName,
} from "@fortrip/agent-contract";
import type { z } from "zod";
import { ENDPOINTS } from "./api-docs.ts";
import { type FieldRow, outputRows } from "./schema-rows.ts";

export interface ResponseDoc {
  /** The anchor on the schemas page. */
  id: string;
  title: string;
  /** The endpoints that answer it, `POST /v1/orders`. */
  http: string[];
  tools: ToolName[];
  /** The command that prints it, as its page slug. */
  cliSlugs: string[];
  /** Over MCP the answer also carries `nextStep`, the consent rule. */
  mcpNextStep?: boolean;
  /** The id of the object this answer is: its section only points there,
   *  and links to it go there. */
  sameAs?: string;
  /** A list answer: `data` holds objects of the response with this id. */
  listOf?: string;
  schema: z.ZodType;
  rows: FieldRow[];
}

const doc = (d: Omit<ResponseDoc, "rows" | "http">): ResponseDoc => ({
  ...d,
  http: ENDPOINTS.filter((e) => d.cliSlugs.includes(e.cliSlug)).map(
    (e) => `${e.method} ${e.path}`,
  ),
  rows: outputRows(d.schema),
});

/** Every response object, its rows generated from the contract's output
 *  schema. `response-docs.test.ts` fails when a tool answers a schema that
 *  isn't listed here. */
export const RESPONSE_DOCS: ResponseDoc[] = [
  doc({
    id: "search-result",
    title: "Search result",
    tools: ["search_hotels"],
    cliSlugs: ["hotels-search"],
    schema: searchResult,
  }),
  doc({
    id: "hotel",
    title: "Hotel",
    tools: ["get_hotel"],
    cliSlugs: ["hotels-get"],
    schema: hotel,
  }),
  doc({
    id: "offers",
    title: "Offers result",
    tools: ["get_hotel_offers"],
    cliSlugs: ["hotels-offers"],
    schema: hotelOffersResult,
  }),
  doc({
    id: "order",
    title: "Order",
    tools: ["book_hotel", "get_order"],
    cliSlugs: ["hotels-book", "orders-get"],
    mcpNextStep: true,
    schema: order,
  }),
  doc({
    id: "order-cancelled",
    title: "Order (cancel)",
    tools: ["cancel_order"],
    cliSlugs: ["orders-cancel"],
    schema: order,
    sameAs: "order",
  }),
  doc({
    id: "order-paid",
    title: "Order (pay)",
    tools: ["pay_order"],
    cliSlugs: ["orders-pay"],
    schema: order,
    sameAs: "order",
  }),
  doc({
    id: "order-list",
    title: "Order list",
    tools: ["list_orders"],
    cliSlugs: ["orders-list"],
    mcpNextStep: true,
    schema: orderList,
    listOf: "order",
  }),
  doc({
    id: "account",
    title: "Account",
    tools: [],
    cliSlugs: ["whoami"],
    schema: meResult,
  }),
];

export function responseDocFor(tool: ToolName): ResponseDoc | undefined {
  return RESPONSE_DOCS.find((d) => d.tools.includes(tool));
}

export function responseDocForCommand(slug: string): ResponseDoc | undefined {
  return RESPONSE_DOCS.find((d) => d.cliSlugs.includes(slug));
}

/** The response `id` names. */
export function responseDoc(id: string): ResponseDoc {
  const doc = RESPONSE_DOCS.find((d) => d.id === id);
  if (!doc) throw new Error(`no response ${id}`);
  return doc;
}

/** Where a link to an answer goes: the object it is, for one that is the
 *  same as another. */
export const schemaHref = (d: ResponseDoc) => `/schemas#${d.sameAs ?? d.id}`;

/** What a link to an answer reads: the title of the object it is. */
export const schemaTitle = (d: ResponseDoc) => (d.sameAs ? responseDoc(d.sameAs).title : d.title);
