// Facts the docs prose states; the docs site and the server both read them here.

/** How a search resolves and ranks places. */
export const SEARCH_RULES = {
  largeSettlementPopulation: 50_000,
  dominanceRatio: 100,
  nearDuplicateMeters: 5_000,
  hubIncludes: 3,
} as const;

/** How `POST /v1/orders` answers a success: `201` for a new order, `200` with the header for a replay. */
export const ORDER_HTTP = {
  createdStatus: 201,
  replayedStatus: 200,
  replayedHeader: "Idempotent-Replayed",
} as const;

/** The scope each identity field of `GET /v1/me` needs; without it the field is null. */
export const ME_SCOPES = { email: "email", name: "profile" } as const;
