import type { ErrorBody } from "./outputs/error-details.ts";

/** A `rate_limited` error names the limit that was hit by this scope. */
export type RateLimitScope = NonNullable<
  ErrorBody<"rate_limited">["details"]
>["scope"];

/** Requests one token may make per scope in a window. */
export const RATE_LIMITS: Record<
  RateLimitScope,
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
