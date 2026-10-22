const reasonStatuses = {
  already_booked: [409],
  price_or_terms_changed: [409],
  rate_unavailable: [422],
  refused: [422],
  supplier_unavailable: [503, 504],
} as const;

export type ErrorReason = keyof typeof reasonStatuses;

/**
 * The `reason` an agent error can carry, each with the HTTP statuses it is
 * sent with. Typed as plain number lists so `ERROR_REASONS[reason].includes(status)`
 * type-checks for a status read off a response.
 */
export const ERROR_REASONS: { readonly [R in ErrorReason]: readonly number[] } =
  reasonStatuses;
