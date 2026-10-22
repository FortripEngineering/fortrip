import { z } from "zod";

import { isIsoDate } from "./dates.ts";

/*
 * Zod pieces for the agent-facing inputs (the `/api/agent/v1` bodies and the
 * MCP tool arguments), each carrying its own message. zod is
 * `sideEffects: false`, so the production bundle never runs the
 * `config(en())` that installs its English messages, and any check without
 * one of its own reads "Invalid input" there.
 */

/** An object that names the keys it doesn't know instead of dropping them. */
export function strictInput<T extends z.core.$ZodLooseShape>(shape: T) {
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? `Unknown argument(s): ${issue.keys.join(", ")}`
        : "Expected a JSON object",
  });
}

export function wholeNumber(name: string, min: number, max: number) {
  const error = `${name} must be a whole number from ${min} to ${max}`;
  return z
    .number({ error })
    .int({ error })
    .min(min, { error })
    .max(max, { error });
}

export function positiveId(name: string) {
  const error = `${name} must be a positive whole number`;
  return z.number({ error }).int({ error }).positive({ error });
}

export function isoDate(name: string) {
  const error = `${name} must be a real yyyy-MM-dd calendar date`;
  return z.string({ error }).refine(isIsoDate, { error });
}

export function nonEmpty(name: string) {
  const error = `${name} must be a non-empty string`;
  return z.string({ error }).min(1, { error });
}

export function text(name: string, min: number, max: number) {
  const error = `${name} must be text of ${min} to ${max} characters`;
  return z.string({ error }).min(min, { error }).max(max, { error });
}

export function oneOf<const T extends readonly [string, ...string[]]>(
  name: string,
  values: T,
) {
  return z.enum(values, {
    error: `${name} must be one of: ${values.join(", ")}`,
  });
}

export function flag(name: string) {
  return z.boolean({ error: `${name} must be true or false` });
}

/** Each child's age in one room, up to `max` children. */
export function childrenAges(max: number) {
  const error = `childrenAges must list each child's age (0 to 17) in one room, at most ${max}`;
  return z
    .array(wholeNumber("Each child's age", 0, 17), { error })
    .max(max, { error });
}
