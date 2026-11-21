// #4490 P5 — the guest's table pick, read from the same map the guest sees
// (pg_venue_available_tables). Co-located so it is unit-testable without
// importing the serve()-on-load entry.
// #4490 P5: the picked table's state at that time on the guest map
// ('free' | 'taken' | 'not_pickable' | 'not_fit' | 'table_pick_unavailable' |
// 'not_found').
type RpcClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export const TABLE_HOLD_PAYMENT_MAX_MINOR = 2147483647;

/** The database owns the hold amount; the edge only enforces one-payment size. */
export function tableHoldCharge(raw: unknown): {
  amountMinor: number;
  error: "amount_too_large" | null;
} {
  const hold = Number(raw);
  if (Number.isFinite(hold) && hold > TABLE_HOLD_PAYMENT_MAX_MINOR) {
    return { amountMinor: 0, error: "amount_too_large" };
  }
  return {
    amountMinor: Number.isFinite(hold) && hold > 0 ? Math.round(hold) : 0,
    error: null,
  };
}

export async function tablePickStatus(
  supabase: RpcClient,
  venueId: string,
  reservedForIso: string,
  partySize: number,
  tableIds: string[],
): Promise<string> {
  const wanted = [...tableIds].sort().join(",");
  const baseDate = new Date(reservedForIso);
  let sawMap = false;
  for (const deltaDays of [0, -1, 1]) {
    const d = new Date(baseDate.getTime() + deltaDays * 86400000);
    const { data, error } = await supabase.rpc("pg_venue_available_tables", {
      p_venue_id: venueId,
      p_date: d.toISOString().slice(0, 10),
      p_party_size: partySize,
      p_slot_start: reservedForIso,
    });
    if (error !== null || !Array.isArray(data)) continue;
    if (data.length > 0) sawMap = true;
    for (const row of data as Array<Record<string, unknown>>) {
      const ids = Array.isArray(row.table_ids)
        ? (row.table_ids as string[]).map((x) => String(x).toLowerCase())
          .sort().join(",")
        : "";
      if (ids !== wanted) continue;
      const status = String(row.status ?? "");
      if (status === "free") return "free";
      if (status === "taken") return "table_taken";
      if (status === "not_pickable") return "table_not_pickable";
      return "table_not_fit";
    }
  }
  return sawMap ? "table_not_fit" : "table_pick_unavailable";
}
