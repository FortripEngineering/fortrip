import { z } from "zod";

import { placeId } from "../conventions/ids.ts";
import { openEnum, openObject } from "../conventions/open.ts";
import { latLng, names } from "./common.ts";

/* Places (spec §7.2, §7.8). */

export const PLACE_KINDS = [
  "country",
  "region",
  "district",
  "settlement",
  "neighbourhood",
  "island",
] as const;

/** A place named in passing: its id and names. */
export const placeRef = openObject({
  placeId,
  name: z.string(),
  names,
});

export type PlaceRef = z.infer<typeof placeRef>;

export const place = openObject({
  placeId,
  name: z.string(),
  names,
  kind: openEnum(PLACE_KINDS),
  scope: openEnum(["area", "radius"]),
  cityLike: z.boolean().nullable(),
  population: z.number().int().nullable(),
  region: placeRef.nullable(),
  countryCode: z.string(),
  location: latLng,
});

export type Place = z.infer<typeof place>;

export const CENTER_BASES = [
  "seat",
  "capital",
  "busiest_settlement",
  "hub",
  "point",
] as const;

/** A search's reference point and where it came from. */
export const center = openObject({
  location: latLng,
  place: placeRef.nullable(),
  basis: openEnum(CENTER_BASES),
});

export type Center = z.infer<typeof center>;
