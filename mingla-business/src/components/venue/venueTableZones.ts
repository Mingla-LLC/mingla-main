/**
 * #4420 (decision 11-14) — the zone-grouped Tables view. Pure, so the
 * grouping is unit-tested without the module's hooks.
 */
import type { VenueTable } from "../../types/venueReservation";

const ZONE_LABEL: Record<string, string> = {
  indoor: "Indoor",
  outdoor: "Outdoor",
  private_room: "Private room",
  bar: "Bar",
  patio: "Patio",
};

/** #4420 (decision 11-14) — the zone order of the grouped Tables view. */
const ZONE_ORDER: readonly string[] = ["indoor", "outdoor", "patio", "bar", "private_room"];

export interface VenueTableZoneGroup {
  /** The zone key, or `null` for tables with no zone. */
  zone: string | null;
  label: string;
  tables: VenueTable[];
}

/**
 * #4420 — the zone-grouped Tables view (the seating map comes later, #3729).
 * Known zones in a fixed order, then any unknown zone, then "No zone" last.
 * Table order inside a zone is the order the server returned. Pure.
 */
export function groupTablesByZone(tables: readonly VenueTable[]): VenueTableZoneGroup[] {
  const byZone = new Map<string | null, VenueTable[]>();
  for (const t of tables) {
    const key = t.zone ?? null;
    const list = byZone.get(key) ?? [];
    list.push(t);
    byZone.set(key, list);
  }
  const rank = (zone: string | null): number => {
    if (zone === null) return Number.MAX_SAFE_INTEGER;
    const at = ZONE_ORDER.indexOf(zone);
    return at === -1 ? ZONE_ORDER.length : at;
  };
  return [...byZone.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([zone, list]) => ({
      zone,
      label: zone === null ? "No zone" : ZONE_LABEL[zone] ?? zone,
      tables: list,
    }));
}

