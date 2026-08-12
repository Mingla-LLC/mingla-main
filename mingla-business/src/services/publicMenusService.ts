/**
 * ORCH-1186-C — PUBLIC venue menu read service (anon-safe).
 *
 * Reads `public_menus_view` (security-definer, gated on claim_status='verified'
 * + deleted_at IS NULL + is_available + is_active) and groups the flat rows into
 * `PublicMenuGroup[]` — the SHARED brand-rendering shape, so the business web
 * wrapper + consumer app can pass the result straight through to <PublicBrandPage>.
 *
 * DISPLAY-ONLY (DEC-C): no ordering/cart/checkout. This service NEVER touches
 * experience_stops / experiences / the snap-menu parser
 * (I-PROPOSED-1186C-MENU-NOT-EXPERIENCE-STOPS).
 *
 * Anon-safe: a logged-out buyer-web visitor reads the definer view directly
 * (no auth, no client token). Returns [] (never null) for non-venues / venues
 * with no public menu. Throws on error.
 */

import type { PublicMenuGroup } from "@mingla/brand-rendering";

import { supabase } from "./supabase";

/** Flat row shape from public_menus_view (one row per available item). */
export interface MenuItemPublicRow {
  id: string;
  menu_id: string;
  brand_id: string;
  brand_slug: string;
  venue_id: string;
  venue_slug: string;
  menu_name: string;
  menu_description: string | null;
  menu_sort_order: number;
  item_name: string;
  item_description: string | null;
  price_cents: number | null;
  currency: string;
  item_sort_order: number;
  // Issue #1789 (SPEC #1788 P-14) appended these to the view; #1793 is the
  // first reader. OPTIONAL, because a client running against a deployment whose
  // view predates the migration receives no such key and must read that as "no
  // note allowed" and "no window" rather than throw.
  allows_notes?: boolean | null;
  service_window_start?: string | null;
  service_window_end?: string | null;
  service_days?: number[] | null;
}

const PUBLIC_MENU_SELECT =
  "id, menu_id, brand_id, brand_slug, venue_id, venue_slug, menu_name, menu_description, menu_sort_order, item_name, item_description, price_cents, currency, item_sort_order, allows_notes, service_window_start, service_window_end, service_days";

/** Issue #1793 — a menu's service window, venue-local (SPEC #1788 P-13). */
export interface PublicMenuWindow {
  start: string | null;
  end: string | null;
  days: number[] | null;
}

/**
 * Issue #1793 — the groups AND their windows, from ONE read.
 *
 * The window belongs to the MENU, not to the group of items a renderer draws,
 * and the display-only pane has no use for it at all — so it travels beside the
 * groups rather than inside them. Ordering needs it: a breakfast menu must stop
 * offering an "Add" button at 11:01 in the VENUE's timezone, or a guest builds a
 * basket the kitchen is going to refuse.
 */
export interface PublicMenuBundle {
  groups: PublicMenuGroup[];
  windows: Record<string, PublicMenuWindow>;
}

/**
 * Public read: all available items of a verified venue's active menus, grouped
 * into PublicMenuGroup[] ordered by menu_sort_order then item_sort_order. The
 * view itself only returns verified-venue rows, so a non-venue / unverified
 * brand yields []. Throws on error.
 */
export const fetchPublicMenus = async (
  brandSlug: string,
  venueSlug: string,
): Promise<PublicMenuGroup[]> =>
  (await fetchPublicMenuBundle(brandSlug, venueSlug)).groups;

/** The ONE read. `fetchPublicMenus` is this, minus the windows. */
export const fetchPublicMenuBundle = async (
  brandSlug: string,
  venueSlug: string,
): Promise<PublicMenuBundle> => {
  const { data, error } = await supabase
    .from("public_menus_view")
    .select(PUBLIC_MENU_SELECT)
    .eq("brand_slug", brandSlug)
    .eq("venue_slug", venueSlug)
    .order("menu_sort_order", { ascending: true })
    .order("item_sort_order", { ascending: true });
  if (error !== null) throw error;

  const groups: PublicMenuGroup[] = [];
  const windows: Record<string, PublicMenuWindow> = {};
  const byMenuId = new Map<string, PublicMenuGroup>();
  for (const row of (data ?? []) as MenuItemPublicRow[]) {
    let group = byMenuId.get(row.menu_id);
    if (group === undefined) {
      group = {
        menuId: row.menu_id,
        menuName: row.menu_name,
        menuDescription: row.menu_description,
        items: [],
      };
      byMenuId.set(row.menu_id, group);
      groups.push(group);
      windows[row.menu_id] = {
        start: row.service_window_start ?? null,
        end: row.service_window_end ?? null,
        days: Array.isArray(row.service_days)
          ? row.service_days.map(Number)
          : null,
      };
    }
    group.items.push({
      id: row.id,
      name: row.item_name,
      description: row.item_description,
      priceCents: row.price_cents,
      currency: row.currency,
      // `=== true`, so a NULL from a pre-#1789 row reads as "no notes" rather
      // than "notes, probably".
      allowsNotes: row.allows_notes === true,
    });
  }
  return { groups, windows };
};
