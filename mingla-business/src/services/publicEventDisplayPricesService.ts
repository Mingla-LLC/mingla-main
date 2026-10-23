import { supabase } from "./supabase";

interface PublicEventPriceRow {
  id: string;
  event_type: string | null;
  display_price_cents?: number | null;
  display_sale_price_cents?: number | null;
  display_sale_ends_at?: string | null;
}

/** #3872 — add public list/sale prices without growing the eager boot chunk. */
export async function addPublicEventDisplayPrices<
  T extends { row: PublicEventPriceRow },
>(visible: T[]): Promise<T[]> {
  const { data, error } = await supabase.rpc("pg_public_event_display_prices", {
    p_event_ids: visible
      .filter(({ row }) => row.event_type === "event")
      .map(({ row }) => row.id),
  });
  if (error) throw error;
  const saleByEventId = new Map<
    string,
    {
      display_price_cents: number | null;
      display_sale_price_cents: number | null;
      display_sale_ends_at: string | null;
    }
  >(
    (
      (data ?? []) as Array<{
        event_id: string;
        display_price_cents: number | null;
        display_sale_price_cents: number | null;
        display_sale_ends_at: string | null;
      }>
    ).map((price) => [price.event_id, price]),
  );
  return visible.map((item) => {
    const sale = saleByEventId.get(item.row.id);
    return sale === undefined
      ? item
      : {
          ...item,
          row: {
            ...item.row,
            display_price_cents: sale.display_price_cents,
            display_sale_price_cents: sale.display_sale_price_cents,
            display_sale_ends_at: sale.display_sale_ends_at,
          },
        };
  });
}
