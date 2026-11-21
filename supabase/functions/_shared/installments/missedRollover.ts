/**
 * issue #4522 (D-7) — after the last automatic retry of a planned row fails,
 * a v2 order with auto-adjust moves that payment onto its later rows
 * (`issue_4522_missed_rollover`) instead of flagging the booking at risk.
 *
 * Returns true only when the database rolled it over. Any other answer — a
 * legacy plan, no later row, an RPC error — returns false, and the caller
 * flags the booking at risk exactly as it always has (fail safe: a missed
 * payment is never silently dropped).
 */
// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function rollOverMissedPayment(
  supabase: SupabaseClient,
  installmentId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("issue_4522_missed_rollover", {
    p_installment_id: installmentId,
  });
  if (error !== null) {
    console.error("[installment] missed rollover failed; flagging at risk", {
      installmentId,
      error: error.message,
    });
    return false;
  }
  return (data as { rolledOver?: boolean } | null)?.rolledOver === true;
}
