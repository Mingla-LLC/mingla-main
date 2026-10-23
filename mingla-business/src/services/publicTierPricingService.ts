export interface PublicTierPricing {
  allInCents: number | null;
  saleBaseCents: number | null;
  saleAllInCents: number | null;
  saleEndsAt: string | null;
  saleName: string | null;
  saleRemaining: number | null;
}

/** #3872 — deferred row mapping; the canonical service retains RPC ownership. */
export const mapPublicTierPricingRows = (
  data: unknown,
): Map<string, PublicTierPricing> => {
  const map = new Map<string, PublicTierPricing>();
  if (!Array.isArray(data)) return map;
  for (const row of data as Array<{
    ticket_type_id?: string;
    all_in_cents?: number;
    sale_base_cents?: number | null;
    sale_all_in_cents?: number | null;
    sale_ends_at?: string | null;
    sale_name?: string | null;
    sale_remaining?: number | null;
  }>) {
    if (row?.ticket_type_id != null) {
      map.set(row.ticket_type_id, {
        allInCents:
          typeof row.all_in_cents === "number" ? row.all_in_cents : null,
        saleBaseCents: row.sale_base_cents ?? null,
        saleAllInCents: row.sale_all_in_cents ?? null,
        saleEndsAt: row.sale_ends_at ?? null,
        saleName: row.sale_name ?? null,
        saleRemaining: row.sale_remaining ?? null,
      });
    }
  }
  return map;
};
