import type { DiscoverFiltersV2, DiscoverFacetGroup } from "../../types/discoverFeed";

const FIELD_BY_GROUP: Record<DiscoverFacetGroup["id"], string> = {
  when: "when",
  price: "price",
  partyType: "partyTypes",
  vibe: "vibeTags",
  music: "musicGenres",
  goodFor: "goodFor",
  destination: "destination",
  leavingFrom: "leavingFrom",
  checkIn: "checkIn",
  propertyKind: "propertyKinds",
  guests: "guests",
};

export function discoverFilterSelectionCount(filters: DiscoverFiltersV2): number {
  return Object.entries(filters.f).reduce((count, [key, value]) => {
    if (key === "guests" && value === 2) return count;
    if (Array.isArray(value)) return count + value.length;
    return value == null ? count : count + 1;
  }, 0);
}
export function selectedDiscoverFilterLabels(
  filters: DiscoverFiltersV2,
  groups: DiscoverFacetGroup[],
): string[] {
  const out: string[] = [];
  for (const group of groups) {
    const field = FIELD_BY_GROUP[group.id];
    const value = (filters.f as Record<string, unknown>)[field];
    for (const option of group.options) {
      if (value === option.id || (Array.isArray(value) && value.includes(option.id))) {
        out.push(option.label ?? option.id);
      }
    }
  }
  return out;
}

export function updateDiscoverFilter(
  filters: DiscoverFiltersV2,
  group: DiscoverFacetGroup,
  optionId: string,
): DiscoverFiltersV2 {
  const field = FIELD_BY_GROUP[group.id];
  const next = { ...(filters.f as Record<string, unknown>) };
  const current = next[field];
  if (!group.multi) {
    if (current === optionId) delete next[field];
    else next[field] = optionId;
  } else {
    const values = Array.isArray(current) ? current.filter((value): value is string => typeof value === "string") : [];
    next[field] = values.includes(optionId)
      ? values.filter((value) => value !== optionId)
      : [...values, optionId];
    if ((next[field] as string[]).length === 0) delete next[field];
  }
  return { kind: filters.kind, f: next } as DiscoverFiltersV2;
}

export function setDiscoverGuests(filters: DiscoverFiltersV2, guests: number): DiscoverFiltersV2 {
  if (filters.kind !== "stays") return filters;
  return { kind: "stays", f: { ...filters.f, guests: Math.max(1, Math.min(8, guests)) } };
}
