import { z } from "zod";

import { isIsoDate } from "../dates.ts";

/** RFC 3339 in UTC, ending in `Z`; names for these fields end in `At`. */
export const instant = z
  .string({ error: "must be an RFC 3339 UTC instant such as 2026-10-23T08:00:00Z" })
  .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/, {
    error: "must be an RFC 3339 UTC instant such as 2026-10-23T08:00:00Z",
  })
  .refine((s) => isIsoDate(s.slice(0, 10)), { error: "must be a real instant" });

/** A calendar date in the hotel's calendar. */
export const localDate = z
  .string({ error: "must be a real yyyy-MM-dd calendar date" })
  .refine(isIsoDate, { error: "must be a real yyyy-MM-dd calendar date" });

/** A local time of day. */
export const localTime = z
  .string({ error: "must be a local time such as 14:00" })
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, {
    error: "must be a local time such as 14:00",
  });

function isIanaZone(s: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(s)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: s });
    return true;
  } catch {
    return false;
  }
}

/** An IANA time zone name such as `Asia/Shanghai`. */
export const timeZone = z
  .string({ error: "must be an IANA time zone such as Asia/Shanghai" })
  .refine(isIanaZone, { error: "must be an IANA time zone such as Asia/Shanghai" });
