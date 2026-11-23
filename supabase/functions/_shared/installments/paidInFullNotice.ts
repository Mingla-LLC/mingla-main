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

/**
 * issue #4522 pass 6 (S9-2) — a paid-in-full email whose claim could not be
 * answered once is sent by the next instalment run: the run lists paid plan
 * orders with no claim (issue_4522_unsent_paid_in_full) and claims each here,
 * so it still goes out exactly once. Before the #4522 schema: nothing to do.
 */
export async function sendUnsentPaidInFullNotices(
  supabase: RpcClient,
  send: (orderId: string) => Promise<unknown>,
  limit = 50,
): Promise<number> {
  if (!(await planV2SchemaAvailable(supabase))) return 0;
  const { data, error } = await supabase.rpc("issue_4522_unsent_paid_in_full", { p_limit: limit });
  if (error !== null) throw new Error(`unsent_paid_in_full_failed:${error.message ?? error.code ?? "unknown"}`);
  let sent = 0;
  for (const row of (Array.isArray(data) ? data : []) as unknown[]) {
    const orderId = typeof row === "string"
      ? row
      : String((row as Record<string, unknown>)?.issue_4522_unsent_paid_in_full ?? "");
    if (orderId !== "" && await claimPaidInFullNotice(supabase, orderId, "instalment_run_retry")) {
      await send(orderId);
      sent += 1;
    }
  }
  return sent;
}
