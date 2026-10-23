import { z } from "zod";

import { openObject } from "../conventions/open.ts";

/* `GET /v1/me` and `GET /v1/auth/config`, with 2.0's semantics (spec §6, Auth). */

/** The signed-in user. */
export const meResult = openObject({
  userId: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
});

export type MeResult = z.infer<typeof meResult>;

/**
 * Public: where and how the CLI signs in with the device flow. `scopes` is
 * one space-separated string.
 */
export const authConfig = openObject({
  issuer: z.string(),
  clientId: z.string(),
  scopes: z.string(),
  deviceAuthorizationEndpoint: z.string(),
  tokenEndpoint: z.string(),
  revocationEndpoint: z.string(),
});

export type AuthConfig = z.infer<typeof authConfig>;
