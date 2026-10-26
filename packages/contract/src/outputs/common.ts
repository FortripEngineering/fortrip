import { z } from "zod";

import { localDate } from "../conventions/time.ts";
import { openEnum, openObject } from "../conventions/open.ts";

/*
 * Pieces every v1 response shares (spec §6): bilingual names, free text with
 * its locale, WGS84 points and the echoed stay. All open: objects keep
 * unknown fields, enums take any string.
 */

/** Both forms of a bilingual name; `null` where the catalogue lacks one. */
export const names = openObject({
  en: z.string().nullable(),
  zh: z.string().nullable(),
});

/** A WGS84 point. */
export const latLng = openObject({ lat: z.number(), lng: z.number() });

const LOCALES = ["en", "zh"] as const;

/** Free text whose language is known. */
export const knownLocaleText = openObject({
  text: z.string(),
  locale: openEnum(LOCALES),
});

/**
 * A hotel photo on a first-party URL (3.1). `caption` is the catalogue's,
 * with its locale; `null` without one.
 */
export const photo = openObject({
  url: z.string(),
  caption: knownLocaleText.nullable(),
});

/** Free text whose language may be unknown (`locale: null`). */
export const localizedText = openObject({
  text: z.string(),
  locale: openEnum(LOCALES).nullable(),
});

/** The stay as the request gave it. */
export const stayEcho = openObject({
  checkIn: localDate,
  checkOut: localDate,
  rooms: z
    .array(
      openObject({
        adults: z.number().int(),
        childrenAges: z.array(z.number().int()),
      }),
    )
    .min(1),
});
