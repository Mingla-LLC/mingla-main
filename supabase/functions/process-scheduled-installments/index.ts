/**
 * ORCH-0869 [Tr3 Installment Payments] — Stage 1 cron edge function.
 *
 * Per SPEC §3.2.1.
 *
 * CONTRACT (per I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER):
 * - This cron calls the shared `_shared/installments/createInstallmentPI.ts`
 *   helper, which is the SINGLE OWNER of installment PI creation. No other
 *   code path may create a PaymentIntent that carries metadata
 *   `mingla_installment_id`.
 * - PI metadata MUST include mingla_installment_id, mingla_installment_ordinal,
 *   mingla_order_id, mingla_brand_id (webhook router discriminates on these).
 * - Idempotency key MUST include retry_count so each retry attempt is
 *   independently idempotent (Stripe returns existing PI on duplicate; new PI
 *   on next retry attempt).
 * - Customer + PaymentMethod live on the CONNECTED account — Stripe-Account
 *   header on every API call (no exceptions).
 * - Application fee = Math.round(amount * 0.015) per ORCH-0843 rate.
 * - At-risk flag flips on retry_count >= 3 + cron halts further retries.
 * - Dunning email fires on each failure attempt until success or at_risk.
 *
 * Refund logic = Tr4 scope, NOT here.
 *
 * Invoked by pg_cron schedule 'orch-0869-process-scheduled-installments'
 * every 6 hours (see migration 20260610000000_tr3_installments.sql). Safe
 * to invoke twice — Stripe idempotency + DB predicate UPDATE serialise.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createInstallmentPI,
  MAX_RETRY_ATTEMPTS,
  type BrandRow,
  type InstallmentRow,
  type OrderRow,
  type StripeAccount,
} from "../_shared/installments/createInstallmentPI.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const DEFAULT_BATCH_LIMIT = 500 as const;

type EventRow = {
  id: string;
  brand_id: string;
};

type ProcessResult = {
  processed: number;
  collected: number;
  failed: number;
  at_risk_flagged: number;
  errors: Array<{ installment_id: string; reason: string }>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  if (SUPABASE_URL === undefined || SUPABASE_SERVICE_ROLE_KEY === undefined) {
    return jsonResponse({ error: "supabase_env_missing" }, 500);
  }

  // Service-role auth check: pg_cron's net.http_post sends the
  // SUPABASE_SERVICE_ROLE_KEY in the authorization header. Reject any other
  // caller. (For local Deno tests, the test fixture sets the same header.)
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  if (authHeader !== expected) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body: { dryRun?: boolean; limit?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const dryRun = body.dryRun === true;
  const limit = typeof body.limit === "number" && body.limit > 0 && body.limit <= 5000
    ? body.limit
    : DEFAULT_BATCH_LIMIT;

  // [TRANSITIONAL] Typed as untyped SupabaseClient because order_installments
  // + new orders columns (at_risk, saved_payment_method_id, etc.) don't exist
  // in the regenerated DB types until the operator runs `supabase db push` on
  // migration 20260610000000_tr3_installments.sql. Tighten generic after that.
  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Query 1: due scheduled installments (initial attempts).
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — belt-and-braces filter
  // `is("cancelled_at", null)` per I-PROPOSED-TR4-CANCELLED-INSTALLMENT-NEVER-CHARGED.
  // The DB-level CHECK constraint order_installments_cancelled_at_status_consistent
  // already enforces (status='cancelled') ⟺ (cancelled_at IS NOT NULL), so the
  // existing status='scheduled' filter would already exclude cancelled rows.
  // The explicit cancelled_at filter is defense-in-depth against transaction-
  // visibility lag during a rare race between cancel-trip-booking commit and
  // this cron query.
  const { data: dueRows, error: dueError } = await supabase
    .from("order_installments")
    .select(`
      id, order_id, ordinal, amount_cents, currency, due_at, status,
      retry_count, stripe_payment_intent_id
    `)
    .eq("status", "scheduled")
    .is("cancelled_at", null)
    .lte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true })
    .limit(limit);

  if (dueError !== null) {
    console.error("[process-scheduled-installments] due query failed", dueError);
    return jsonResponse({ error: "due_query_failed", detail: dueError.message }, 500);
  }

  // Query 2: failed-then-retry-eligible installments.
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — same belt-and-braces
  // cancelled_at filter as Query 1 (I-PROPOSED-TR4-CANCELLED-INSTALLMENT-NEVER-CHARGED).
  const { data: retryRows, error: retryError } = await supabase
    .from("order_installments")
    .select(`
      id, order_id, ordinal, amount_cents, currency, due_at, status,
      retry_count, stripe_payment_intent_id
    `)
    .eq("status", "failed")
    .is("cancelled_at", null)
    .lte("next_retry_at", new Date().toISOString())
    .lt("retry_count", MAX_RETRY_ATTEMPTS)
    .order("next_retry_at", { ascending: true })
    .limit(Math.max(0, limit - (dueRows?.length ?? 0)));

  if (retryError !== null) {
    console.error("[process-scheduled-installments] retry query failed", retryError);
    return jsonResponse({ error: "retry_query_failed", detail: retryError.message }, 500);
  }

  // Flip retry rows back to 'scheduled' for processing (matches biz_retry_installment shape).
  const retryIds = (retryRows ?? []).map((r) => r.id);
  if (retryIds.length > 0) {
    await supabase
      .from("order_installments")
      .update({ status: "scheduled", updated_at: new Date().toISOString() })
      .in("id", retryIds)
      .eq("status", "failed");
  }

  const allRows: InstallmentRow[] = [...(dueRows ?? []), ...(retryRows ?? [])] as InstallmentRow[];

  const result: ProcessResult = {
    processed: 0,
    collected: 0,
    failed: 0,
    at_risk_flagged: 0,
    errors: [],
  };

  for (const installment of allRows) {
    result.processed += 1;
    try {
      // Per-row joins (small N per run; could batch-join in future if N grows)
      const { data: order } = await supabase
        .from("orders")
        .select("id, event_id, stripe_customer_id_on_connected_account, saved_payment_method_id, buyer_user_id, buyer_email, at_risk")
        .eq("id", installment.order_id)
        .maybeSingle();
      if (order === null) {
        result.errors.push({ installment_id: installment.id, reason: "order_not_found" });
        continue;
      }
      // orders has no brand_id column — resolve via events FK.
      const { data: eventRow } = await supabase
        .from("events")
        .select("id, brand_id")
        .eq("id", (order as OrderRow).event_id)
        .maybeSingle();
      if (eventRow === null) {
        result.errors.push({ installment_id: installment.id, reason: "event_not_found" });
        continue;
      }
      const brandId = String((eventRow as Record<string, unknown>).brand_id);
      const { data: brand } = await supabase
        .from("brands")
        .select("id, contact_email, name")
        .eq("id", brandId)
        .maybeSingle();
      if (brand === null) {
        result.errors.push({ installment_id: installment.id, reason: "brand_not_found" });
        continue;
      }
      const { data: stripeAccount } = await supabase
        .from("stripe_connect_accounts")
        .select("brand_id, stripe_account_id")
        .eq("brand_id", brandId)
        .is("detached_at", null)
        .maybeSingle();
      if (stripeAccount === null) {
        result.errors.push({ installment_id: installment.id, reason: "stripe_account_missing" });
        continue;
      }

      const outcome = await createInstallmentPI({
        installmentId: installment.id,
        brandId,
        supabase,
        installment,
        order: order as OrderRow,
        brand: brand as BrandRow,
        stripeAccount: stripeAccount as StripeAccount,
        dryRun,
      });

      switch (outcome.outcome) {
        case "collected":
          result.collected += 1;
          break;
        case "failed":
          result.failed += 1;
          break;
        case "at_risk_flagged":
          result.failed += 1;
          result.at_risk_flagged += 1;
          break;
        case "skipped":
          // do not count toward collected/failed; skip silently
          break;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.errors.push({ installment_id: installment.id, reason });
      console.error(
        `[process-scheduled-installments] row processing crashed for ${installment.id}:`,
        reason,
      );
    }
  }

  console.log(
    `[process-scheduled-installments] run complete: processed=${result.processed} collected=${result.collected} failed=${result.failed} at_risk=${result.at_risk_flagged} errors=${result.errors.length}`,
  );

  return jsonResponse(result, 200);
});
