import { z } from "zod";

import * as account from "../src/outputs/account.ts";
import * as errorDetails from "../src/outputs/error-details.ts";
import * as hotel from "../src/outputs/hotel.ts";
import * as offer from "../src/outputs/offer.ts";
import * as order from "../src/outputs/order.ts";
import * as place from "../src/outputs/place.ts";
import * as search from "../src/outputs/search.ts";
import { MCP_OUTPUT } from "../src/tools.ts";

/*
 * Every published v1 output schema, found by module export so a new schema
 * cannot be left out of the openness, unknown-is-not-no and snapshot checks,
 * plus the MCP output schemas. Keyed `module.export`.
 */

const MODULES: Record<string, Record<string, unknown>> = {
  account,
  "error-details": errorDetails,
  hotel,
  offer,
  order,
  place,
  search,
};

function isSchema(value: unknown): value is z.ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    "_zod" in value &&
    typeof (value as { _zod: { def?: unknown } })._zod.def === "object"
  );
}

export const OUTPUT_SCHEMAS: Readonly<Record<string, z.ZodType>> =
  Object.fromEntries(
    Object.entries(MODULES).flatMap(([module, exports]) =>
      Object.entries(exports)
        .filter(([, value]) => isSchema(value))
        .map(([name, value]) => [`${module}.${name}`, value as z.ZodType]),
    ).concat(
      Object.entries(MCP_OUTPUT).map(([tool, schema]) => [
        `tools.MCP_OUTPUT.${tool}`,
        schema,
      ]),
    ),
  );

/**
 * The response schemas the API publishes, by name, and the MCP output
 * schemas: the snapshot and the unknown-is-not-no walk cover these (their
 * components are inside them).
 */
export const PUBLISHED_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  searchResult: search.searchResult,
  hotel: hotel.hotel,
  hotelOffersResult: offer.hotelOffersResult,
  order: order.order,
  orderList: order.orderList,
  meResult: account.meResult,
  authConfig: account.authConfig,
  errorEnvelope: errorDetails.errorEnvelope,
  "MCP_OUTPUT.book_hotel": MCP_OUTPUT.book_hotel,
  "MCP_OUTPUT.get_order": MCP_OUTPUT.get_order,
  "MCP_OUTPUT.list_orders": MCP_OUTPUT.list_orders,
  "MCP_OUTPUT.cancel_order": MCP_OUTPUT.cancel_order,
};

export type JsonSchema = Record<string, unknown>;

/** The published JSON Schema of an output schema. */
export function jsonSchemaOf(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { io: "output" }) as JsonSchema;
}
