import { supabase } from "./supabase";

export interface MenuSaleRow {
  menu_item_id: string;
  sale_price_cents: number | null;
  sale_ends_at: string | null;
  sale_name: string | null;
}

export async function fetchPublicMenuSales(
  venueId: string,
): Promise<Map<string, MenuSaleRow>> {
  const { data, error } = await supabase.rpc("pg_public_menu_item_sales", {
    p_venue_id: venueId,
  });
  return new Map(
    error === null && Array.isArray(data)
      ? (data as MenuSaleRow[]).map((sale) => [sale.menu_item_id, sale])
      : [],
  );
}
