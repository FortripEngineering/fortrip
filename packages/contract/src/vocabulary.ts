/*
 * Vocabularies that requests and responses share, so neither module imports
 * the other.
 */

/** Amenity codes a search can filter by (§7.7), in the order they are listed. */
export const FILTERABLE_AMENITIES = [
  "parking",
  "wifi",
  "laundry",
  "restaurant",
  "room_service",
  "bar",
  "non_smoking",
  "business_center",
  "pool",
] as const;

/** Every amenity code a response can carry: the filterable ones, then the
 *  response-only ones and `other`. A search that filters by a response-only
 *  code is refused by the service with details (§7.7). */
export const AMENITY_CODES = [
  ...FILTERABLE_AMENITIES,
  "airport_shuttle",
  "spa",
  "gym",
  "accessible",
  "ev_charging",
  "air_conditioning",
  "pets_allowed",
  "kitchen",
  "other",
] as const;

export type FilterableAmenity = (typeof FILTERABLE_AMENITIES)[number];
export type AmenityCode = (typeof AMENITY_CODES)[number];

/** Orders a hotel search can be sorted in (§7.1). */
export const SEARCH_SORTS = [
  "distance",
  "relevance",
  "stars_desc",
  "price_asc",
  "price_desc",
] as const;
