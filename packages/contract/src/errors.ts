/** Every code the v1 error envelope can carry (spec §11). */
export type ErrorCode =
  | "invalid_request"
  | "cursor_invalid"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "order_removed"
  | "offer_expired"
  | "offer_changed"
  | "offer_already_ordered"
  | "order_exists"
  | "order_in_progress"
  | "order_attempts_exhausted"
  | "cancellation_changed"
  | "order_not_cancellable"
  | "destination_ambiguous"
  | "destination_not_found"
  | "search_too_broad"
  | "stay_unsupported"
  | "stay_in_past"
  | "offer_unavailable"
  | "rate_limited"
  | "ordering_paused"
  | "service_unavailable"
  | "supplier_unavailable"
  | "internal";

/** The HTTP statuses each code is sent with, and whether a retry can help. */
export const ERROR_CODES: Readonly<
  Record<ErrorCode, { status: readonly number[]; retryable: boolean }>
> = {
  invalid_request: { status: [400], retryable: false },
  cursor_invalid: { status: [400], retryable: false },
  unauthenticated: { status: [401], retryable: false },
  forbidden: { status: [403], retryable: false },
  not_found: { status: [404], retryable: false },
  order_removed: { status: [410], retryable: false },
  offer_expired: { status: [409], retryable: false },
  offer_changed: { status: [409], retryable: false },
  offer_already_ordered: { status: [409], retryable: false },
  order_exists: { status: [409], retryable: false },
  order_in_progress: { status: [409], retryable: true },
  order_attempts_exhausted: { status: [409], retryable: false },
  cancellation_changed: { status: [409], retryable: false },
  order_not_cancellable: { status: [409], retryable: false },
  destination_ambiguous: { status: [422], retryable: false },
  destination_not_found: { status: [422], retryable: false },
  search_too_broad: { status: [422], retryable: false },
  stay_unsupported: { status: [422], retryable: false },
  stay_in_past: { status: [422], retryable: false },
  offer_unavailable: { status: [422], retryable: false },
  rate_limited: { status: [429], retryable: true },
  ordering_paused: { status: [503], retryable: true },
  service_unavailable: { status: [503], retryable: true },
  supplier_unavailable: { status: [503, 504], retryable: true },
  internal: { status: [500], retryable: false },
};
