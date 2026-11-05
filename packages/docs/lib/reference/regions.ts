import { ENABLED_REGIONS, type EnabledRegion } from "@fortrip/agent-contract/regions";

export interface RegionGroup {
  countryCode: string;
  country: string;
  regions: EnabledRegion[];
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

/** The regions by country, countries and regions in English name order. */
export function regionGroups(regions: readonly EnabledRegion[] = ENABLED_REGIONS): RegionGroup[] {
  const groups = new Map<string, RegionGroup>();
  for (const region of regions) {
    const group = groups.get(region.countryCode) ?? {
      countryCode: region.countryCode,
      country: countryNames.of(region.countryCode) ?? region.countryCode,
      regions: [],
    };
    group.regions.push(region);
    groups.set(region.countryCode, group);
  }
  const byName = (a: string, b: string) => a.localeCompare(b, "en");
  return [...groups.values()]
    .sort((a, b) => byName(a.country, b.country))
    .map((group) => ({
      ...group,
      regions: group.regions.sort((a, b) => byName(a.name, b.name)),
    }));
}
