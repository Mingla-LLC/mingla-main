/**
 * ORCH-1186-C — venue MENU builder data service (read-shape + mappers).
 *
 * Reads the brand's `menus` + `menu_items` (RLS: brand-member read) and
 * assembles them into nested `Menu[]` for the builder. Mutations live in the
 * hook (useMenus) as direct RLS-gated upserts/deletes — this service is
 * read-shape + mappers only (mirrors useVenueReservationSettings).
 *
 * AMENDED at #1767 Phase 1 (issue #1789): the DEC-C display-only clause is
 * retired — this menu becomes an ordering surface. What survives is that the
 * menu surface never does money itself (SPEC #1788 P-20 / P-61 SET-B). The
 * #1789 depth columns (allows_notes, prep_station, cost_cents, service windows)
 * are read here; nothing about them is priced on the client.
 *
 * This service NEVER touches experience_stops / experiences / the snap-menu
 * parser (I-PROPOSED-1186C-MENU-NOT-EXPERIENCE-STOPS).
 *
 * Error contract: throws on `error !== null` (matches fetchVenueReservationSettings).
 */

import { supabase } from "./supabase";

// ---- snake_case row shapes (the table columns) ----
export interface MenuRow {
  id: string;
  brand_id: string;
  venue_id: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  // Issue #1789 (SPEC #1788 P-12) — service windows, evaluated in VENUE-LOCAL
  // time server-side. `end < start` means the window WRAPS MIDNIGHT.
  service_window_start: string | null;
  service_window_end: string | null;
  service_days: number[] | null;
}

export interface MenuItemRow {
  id: string;
  menu_id: string;
  brand_id: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  currency: string;
  is_available: boolean;
  sort_order: number;
  // Issue #1789 (SPEC #1788 P-12) — menu depth.
  allows_notes: boolean;
  prep_station: "kitchen" | "bar" | "other" | null;
  cost_cents: number | null;
}

// ---- camelCase domain shapes (what the builder UI consumes) ----
export interface MenuItem {
  id: string;
  menuId: string;
  brandId: string;
  name: string;
  description: string | null;
  priceCents: number | null;
  currency: string;
  isAvailable: boolean;
  sortOrder: number;
  /** Issue #1789 — whether a guest may attach a kitchen note to this line. */
  allowsNotes: boolean;
  /** Issue #1789 — Phase-5 kiosk routing seam. Nullable, never required. */
  prepStation: "kitchen" | "bar" | "other" | null;
  /** Issue #1789 — opt-in food cost. NEVER public; the only honest margin input. */
  costCents: number | null;
}

export interface Menu {
  id: string;
  brandId: string;
  /** Optional only for legacy in-memory fixtures; persisted rows always set it. */
  venueId?: string | null;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  /** Issue #1789 — "HH:MM" (or "HH:MM:SS" as Postgres returns it); null = always. */
  serviceWindowStart: string | null;
  serviceWindowEnd: string | null;
  /** Issue #1789 — ISO day-of-week 1..7; null = every day. */
  serviceDays: number[] | null;
  items: MenuItem[];
}

// Single string literals, deliberately: supabase-js infers the row shape from
// the LITERAL type of the select string, and a `+` concatenation erases it.
const MENU_SELECT =
  "id, brand_id, venue_id, name, description, sort_order, is_active, service_window_start, service_window_end, service_days";
const MENU_ITEM_SELECT =
  "id, menu_id, brand_id, name, description, price_cents, currency, is_available, sort_order, allows_notes, prep_station, cost_cents";

export const mapMenuRow = (row: MenuRow): Omit<Menu, "items"> => ({
  id: row.id,
  brandId: row.brand_id,
  venueId: row.venue_id,
  name: row.name,
  description: row.description,
  sortOrder: row.sort_order,
  isActive: row.is_active,
  serviceWindowStart: row.service_window_start,
  serviceWindowEnd: row.service_window_end,
  serviceDays: row.service_days,
});

export const mapMenuItemRow = (row: MenuItemRow): MenuItem => ({
  id: row.id,
  menuId: row.menu_id,
  brandId: row.brand_id,
  name: row.name,
  description: row.description,
  priceCents: row.price_cents,
  currency: row.currency,
  isAvailable: row.is_available,
  sortOrder: row.sort_order,
  allowsNotes: row.allows_notes,
  prepStation: row.prep_station,
  costCents: row.cost_cents,
});

/**
 * Builder read: all of a brand's menus + items, assembled into nested Menu[]
 * ordered by sort_order. Includes INACTIVE menus + UNAVAILABLE items (the owner
 * manages them in the builder — only the public view filters those out).
 * When a venue is selected, legacy unassigned rows are included so saving one
 * assigns it to that venue; they remain absent from every public read.
 */
export const fetchBrandMenus = async (
  brandId: string,
  venueId?: string | null,
): Promise<Menu[]> => {
  let menusQuery = supabase
    .from("menus")
    .select(MENU_SELECT)
    .eq("brand_id", brandId);
  if (venueId !== undefined && venueId !== null) {
    menusQuery = menusQuery.or(`venue_id.eq.${venueId},venue_id.is.null`);
  }
  const [menusRes, itemsRes] = await Promise.all([
    menusQuery
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("menu_items")
      .select(MENU_ITEM_SELECT)
      .eq("brand_id", brandId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);
  if (menusRes.error !== null) throw menusRes.error;
  if (itemsRes.error !== null) throw itemsRes.error;

  const itemsByMenu = new Map<string, MenuItem[]>();
  for (const row of (itemsRes.data ?? []) as MenuItemRow[]) {
    const item = mapMenuItemRow(row);
    const bucket = itemsByMenu.get(item.menuId);
    if (bucket === undefined) itemsByMenu.set(item.menuId, [item]);
    else bucket.push(item);
  }

  return ((menusRes.data ?? []) as MenuRow[]).map((menuRow) => ({
    ...mapMenuRow(menuRow),
    items: itemsByMenu.get(menuRow.id) ?? [],
  }));
};
