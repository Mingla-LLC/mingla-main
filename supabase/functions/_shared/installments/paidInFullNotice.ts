/**
 * issue #4522 (rework N7) — the paid-in-full email goes out once per order,
 * whichever path completes the balance: the normal webhook, a retried
 * settle, a late success or the sweep's verification. With the #4522 schema
 * every path claims first (issue_4522_claim_paid_in_full_notice: true only
 * once, and only when nothing is left to pay); before the schema exists the
 * pre-#4522 behaviour is kept exactly (send).
 */
import { planV2SchemaAvailable } from "./planV2Schema.ts";

interface RpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

/** Whether this caller should send the paid-in-full email now. */
export async function claimPaidInFullNotice(
  supabase: RpcClient,
  orderId: string,
  source: string,
): Promise<boolean> {
  if (orderId === "") return false;
  if (!(await planV2SchemaAvailable(supabase))) return true;
  const { data, error } = await supabase.rpc("issue_4522_claim_paid_in_full_notice", {
    p_order_id: orderId,
    p_source: source,
  });
  if (error !== null) {
    // Never twice: an unanswered claim sends nothing (logged for ops).
    console.error(JSON.stringify({
      event: "paid_in_full_claim_failed",
      orderId,
      source,
      reason: error.message ?? error.code ?? "unknown",
    }));
    return false;
  }
  return data === true;
}
