/** The `reason` an agent error can carry, each with the HTTP status it is sent with. */
export const ERROR_REASONS = {
  already_booked: 409,
  price_or_terms_changed: 409,
  rate_unavailable: 422,
  refused: 422,
  supplier_unavailable: 503,
} as const;

export type ErrorReason = keyof typeof ERROR_REASONS;
