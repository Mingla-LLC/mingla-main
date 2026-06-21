/**
 * ORCH-1186-C — venue MENU builder data service (read-shape + mappers).
 *
 * Reads the brand's `menus` + `menu_items` (RLS: brand-member read) and
 * assembles them into nested `Menu[]` for the builder. Mutations live in the
 * hook (useMenus) as direct RLS-gated upserts/deletes — this service is
 * read-shape + mappers only (mirrors useVenueReservationSettings).
 *
 * DISPLAY-ONLY (DEC-C): no ordering/cart/checkout. This service NEVER touches
 * experience_stops / experiences / the snap-menu parser
 * (I-PROPOSED-1186C-MENU-NOT-EXPERIENCE-STOPS).
 *
 * Error contract: throws on `error !== null` (matches fetchVenueReservationSettings).
 */

import { supabase } from "./supabase";

// ---- snake_case row shapes (the table columns) ----
export interface MenuRow {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
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
}

export interface Menu {
  id: string;
  brandId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  items: MenuItem[];
}

const MENU_SELECT = "id, brand_id, name, description, sort_order, is_active";
const MENU_ITEM_SELECT =
  "id, menu_id, brand_id, name, description, price_cents, currency, is_available, sort_order";

export const mapMenuRow = (row: MenuRow): Omit<Menu, "items"> => ({
  id: row.id,
  brandId: row.brand_id,
  name: row.name,
  description: row.description,
  sortOrder: row.sort_order,
  isActive: row.is_active,
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
});

/**
 * Builder read: all of a brand's menus + items, assembled into nested Menu[]
 * ordered by sort_order. Includes INACTIVE menus + UNAVAILABLE items (the owner
 * manages them in the builder — only the public view filters those out).
 */
export const fetchBrandMenus = async (brandId: string): Promise<Menu[]> => {
  const [menusRes, itemsRes] = await Promise.all([
    supabase
      .from("menus")
      .select(MENU_SELECT)
      .eq("brand_id", brandId)
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
