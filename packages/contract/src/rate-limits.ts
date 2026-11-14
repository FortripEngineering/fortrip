import type { ErrorBody } from "./outputs/error-details.ts";

/** The name of a rate limit: a `rate_limited` error names the one that was
 *  hit as `details.rateLimit`. */
export type RateLimitName = NonNullable<
  ErrorBody<"rate_limited">["details"]
>["rateLimit"];

/** Requests one token may make against each rate limit in a window. */
export const RATE_LIMITS: Record<
  RateLimitName,
  { limit: number; windowSeconds: number }
> = {
  search: { limit: 10, windowSeconds: 60 },
  offers: { limit: 20, windowSeconds: 60 },
  hotel: { limit: 30, windowSeconds: 60 },
  orders_create: { limit: 20, windowSeconds: 60 },
  orders_read: { limit: 60, windowSeconds: 60 },
  orders_cancel: { limit: 10, windowSeconds: 60 },
  orders_pay: { limit: 10, windowSeconds: 60 },
};
