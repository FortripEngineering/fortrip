import { z } from "zod";

/**
 * What `book_hotel` / `POST /api/agent/v1/hotels/bookings` answers with.
 * Its JSON Schema allows no other keys, so a caller that parses its answer
 * through this schema drops a field the server adds until it is added here,
 * rather than failing a strict client's validation. The MCP tool adds a
 * `nextStep` to it; the HTTP answer has none.
 */
export const bookingResult = z.object({
  agentOrderId: z.string(),
  paymentUrl: z
    .string()
    .describe(
      "Fortrip page that recaps the booking and continues to payment. Anyone holding it can pay",
    ),
  amount: z
    .number()
    .nullable()
    .describe("What the user will be charged, in currency"),
  currency: z.string(),
  orderUrl: z.string().describe("The signed-in order page"),
  statusUrl: z
    .string()
    .optional()
    .describe("The booking status page; the same page as paymentUrl"),
  stay: z
    .object({
      hotelId: z.number(),
      hotelName: z.string().nullable(),
      roomName: z.string().nullable(),
      checkIn: z.string(),
      checkOut: z.string(),
      nights: z.number(),
      rooms: z.number(),
      adultsPerRoom: z.number(),
      childrenAgesPerRoom: z.array(z.number()),
    })
    .describe("The stay as booked; every room has the same occupancy"),
  terms: z
    .object({
      boardCode: z.string(),
      boardCount: z.number(),
      refundable: z.boolean(),
      freeCancelUntil: z.string().nullable(),
      cancellation: z.array(z.object({ amount: z.number(), from: z.string() })),
      isInstantConfirm: z.boolean(),
      confirmByMins: z.number().nullable(),
      payAtHotelFees: z.array(
        z.object({
          type: z.string(),
          isMandatory: z.boolean(),
          amount: z.number(),
          currency: z.string(),
        }),
      ),
    })
    .nullable(),
});

export type BookingResult = z.infer<typeof bookingResult>;

/** `GET /api/agent/v1/me`: the signed-in user. */
export const meResult = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
});

export type MeResult = z.infer<typeof meResult>;

/**
 * `GET /api/agent/v1/auth/config` (public): where and how the CLI signs in
 * with the device flow. `scopes` is one space-separated string.
 */
export const authConfig = z.object({
  issuer: z.string(),
  clientId: z.string(),
  scopes: z.string(),
  deviceAuthorizationEndpoint: z.string(),
  tokenEndpoint: z.string(),
  revocationEndpoint: z.string(),
});

export type AuthConfig = z.infer<typeof authConfig>;
