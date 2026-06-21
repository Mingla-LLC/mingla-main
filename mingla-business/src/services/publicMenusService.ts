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
  menu_name: string;
  menu_description: string | null;
  menu_sort_order: number;
  item_name: string;
  item_description: string | null;
  price_cents: number | null;
  currency: string;
  item_sort_order: number;
}

const PUBLIC_MENU_SELECT =
  "id, menu_id, brand_id, brand_slug, menu_name, menu_description, menu_sort_order, item_name, item_description, price_cents, currency, item_sort_order";

/**
 * Public read: all available items of a verified venue's active menus, grouped
 * into PublicMenuGroup[] ordered by menu_sort_order then item_sort_order. The
 * view itself only returns verified-venue rows, so a non-venue / unverified
 * brand yields []. Throws on error.
 */
export const fetchPublicMenus = async (
  brandSlug: string,
): Promise<PublicMenuGroup[]> => {
  const { data, error } = await supabase
    .from("public_menus_view")
    .select(PUBLIC_MENU_SELECT)
    .eq("brand_slug", brandSlug)
    .order("menu_sort_order", { ascending: true })
    .order("item_sort_order", { ascending: true });
  if (error !== null) throw error;

  const groups: PublicMenuGroup[] = [];
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
    }
    group.items.push({
      id: row.id,
      name: row.item_name,
      description: row.item_description,
      priceCents: row.price_cents,
      currency: row.currency,
    });
  }
  return groups;
};
