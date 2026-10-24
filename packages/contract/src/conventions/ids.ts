import { z } from "zod";

/** Opaque prefixed ids: a prefix plus 20 base62 characters. */
function prefixed(prefix: string, name: string) {
  const error = `${name} must be ${prefix}_ followed by 20 letters or digits`;
  return z
    .string({ error })
    .regex(new RegExp(`^${prefix}_[0-9A-Za-z]{20}$`), { error });
}

export const hotelId = prefixed("htl", "hotelId");
export const offerId = prefixed("off", "offerId");
export const orderId = prefixed("ord", "orderId");

/** `plc_` plus the GeoNames id in decimal (1 to 12 digits). */
export const placeId = z
  .string({ error: "placeId must be plc_ followed by 1 to 12 digits" })
  .regex(/^plc_\d{1,12}$/, {
    error: "placeId must be plc_ followed by 1 to 12 digits",
  });
