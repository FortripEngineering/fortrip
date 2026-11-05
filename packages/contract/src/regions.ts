import regions from "./regions.json" with { type: "json" };

/** A place Fortrip searches by region. */
export interface EnabledRegion {
  placeId: string;
  countryCode: string;
  name: string;
}

/** The regions a search can be scoped to. Its own entry point so the CLI bundle never loads it. */
export const ENABLED_REGIONS: readonly EnabledRegion[] = regions;
