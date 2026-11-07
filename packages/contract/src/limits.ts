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
   *  (`payment.expiresAt`) for the order to offer a token or wallet payment
   *  (an entry of `payment.methods`). */
  payMinMinutesLeft: 15,
  /** `pay_order` refuses (`order_not_payable`), by token or wallet, when the
   *  order's payment window (`payment.expiresAt`) closes within this many
   *  minutes. */
  payCutoffMinutes: 2,
  tokensPerOrder: 5,
  wechatCodeMinutes: 120,
} as const;

/** Currencies a v1 request can price and charge in (USD is the default). */
export const CURRENCIES = ["USD", "CNY"] as const;

export type Currency = (typeof CURRENCIES)[number];

/** Where a person goes when an agent gets stuck. */
export const SUPPORT_EMAIL = "info@fortrip.ai";
