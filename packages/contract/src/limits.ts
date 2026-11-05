/** The ceilings and floors every agent surface enforces and documents (spec §15). */
export const LIMITS = {
  rooms: 8,
  adultsPerRoom: 8,
  childrenPerRoom: 4,
  childAgeMax: 17,
  nightsFortrip: 30,
  nightsSupplier: 15,
  offersHotels: 15,
  offersPerHotelDefault: 10,
  offersPerHotelMax: 20,
  pageSizeDefault: 20,
  pageSizeMax: 50,
  textLength: 128,
  radiusMetersMax: 80_000,
  radiusMetersDefault: 8_000,
  amenityFilters: 9,
  guestName: 60,
  contactFirstName: 59,
  contactLastName: 59,
  contactPhoneMin: 3,
  contactPhoneMax: 40,
  specialRequests: 500,
  poolLimit: 3_000,
  candidatesShown: 8,
  candidatesCounted: 200,
  localitiesShown: 8,
  tokenPaymentMaxUsd: 500,
  /** Minutes that must be left before the order's payment window closes
   *  (`payment.expiresAt`) to start a token or wallet payment. */
  payMinMinutesLeft: 15,
  tokensPerOrder: 5,
  wechatCodeMinutes: 120,
} as const;

/** Currencies a v1 response can show prices in (USD is also what is paid). */
export const DISPLAY_CURRENCIES = ["USD", "CNY"] as const;

/** Where a person goes when an agent gets stuck. */
export const SUPPORT_EMAIL = "info@fortrip.ai";
