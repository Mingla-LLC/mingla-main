/**
 * issue #4522 — mint a "Pay toward your balance" link for an order whose v2
 * plan lets the traveler pay any amount. Returns null for every other order
 * (legacy plans, flexible payments off, paid in full, cancelled) and on any
 * error, so an email simply goes out without the link. The raw token lives
 * only in the URL; the database keeps its SHA-256 (issue_4522_issue_balance_link,
 * one live link per order, 30 days).
 */
// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../businessWebOrigin.ts";
import {
  mintPayLinkToken,
  payLinkTokenHashHex,
} from "./installmentPayLinks.ts";
import { planV2SchemaAvailable } from "./planV2Schema.ts";

export async function balanceLinkUrlForOrder(
  supabase: SupabaseClient,
  orderId: string,
  mintToken: () => string = () => mintPayLinkToken(),
): Promise<string | null> {
  // issue #4522 (F6) — before the #4522 migrations there is no balance link
  // (and no payment_plan_terms column): every email stays as it was.
  if (!(await planV2SchemaAvailable(supabase))) return null;
  const { data: order, error } = await supabase.from("orders")
    .select("payment_plan_terms").eq("id", orderId).maybeSingle();
  if (error !== null || order === null) return null;
  const terms =
    (order as { payment_plan_terms?: Record<string, unknown> | null })
      .payment_plan_terms;
  if (terms?.v !== 2 || terms?.flex_enabled !== true) return null;
  const token = mintToken();
  const { data, error: issueError } = await supabase.rpc(
    "issue_4522_issue_balance_link",
    { p_order_id: orderId, p_token_hash: await payLinkTokenHashHex(token) },
  );
  if (issueError !== null || (data as { ok?: boolean } | null)?.ok !== true) {
    return null;
  }
  return `${PRODUCTION_BUSINESS_WEB_ORIGIN}/pay/balance/${token}`;
}
