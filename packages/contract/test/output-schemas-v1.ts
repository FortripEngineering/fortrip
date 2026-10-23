import { z } from "zod";

import * as account from "../src/outputs-v1/account.ts";
import * as errorDetails from "../src/outputs-v1/error-details.ts";
import * as hotel from "../src/outputs-v1/hotel.ts";
import * as offer from "../src/outputs-v1/offer.ts";
import * as order from "../src/outputs-v1/order.ts";
import * as place from "../src/outputs-v1/place.ts";
import * as search from "../src/outputs-v1/search.ts";

/*
 * Every published v1 output schema, found by module export so a new schema
 * cannot be left out of the openness, unknown-is-not-no and snapshot checks.
 * Keyed `module.export`.
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
    ),
  );

export type JsonSchema = Record<string, unknown>;

/** The published JSON Schema of an output schema. */
export function jsonSchemaOf(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { io: "output" }) as JsonSchema;
}
