/** The ceilings and floors every agent surface enforces and documents. */
export const LIMITS = {
  rooms: 8,
  adultsPerRoom: 8,
  childrenPerRoom: 8,
  childAgeMax: 17,
  nights: 15,
  ratesHotels: 15,
  facilities: 10,
  queryLength: 128,
  nearRadiusKm: 200,
  page: 100,
  pageSize: 50,
  guestName: 60,
  contactName: 120,
  contactPhoneMin: 3,
  contactPhoneMax: 40,
  specialRequests: 500,
  maxRoomsPerHotel: 200,
} as const;

/** The v1 ceilings and floors (spec §15). Task 4 renames this to `LIMITS`. */
export const LIMITS_V1 = {
  rooms: 8,
  adultsPerRoom: 8,
  childrenPerRoom: 4,
  childAgeMax: 17,
  nightsFortrip: 30,
  nightsSupplier: 15,
  offersHotels: 15,
  offersPerHotelDefault: 5,
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
} as const;

/** Currencies a v1 response can show prices in (USD is also what is paid). */
export const DISPLAY_CURRENCIES = ["USD", "CNY"] as const;

/** Board (meal plan) codes a rate can carry and a search can ask for. */
export const BOARD_CODES = [
  "RO",
  "BB",
  "HB",
  "FB",
  "BL",
  "BD",
  "HBBL",
  "HBLD",
  "AI",
] as const;

/** Currencies prices can be shown and paid in. */
export const CURRENCIES = ["CNY", "USD"] as const;

/** Orders a hotel search can be sorted in. */
export const SEARCH_SORTS = [
  "recommended",
  "price-asc",
  "price-desc",
  "star-desc",
  "distance",
] as const;

/** Where a person goes when an agent gets stuck. */
export const SUPPORT_EMAIL = "info@fortrip.ai";
