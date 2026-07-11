/**
 * partner-paystack-split-retry — ORCH-1331 [partner Paystack payout rail].
 *
 * Cron sweep (every 30 min — migration 20261228000000 registers the schedule)
 * that re-attempts pending Paystack partner splits. This is the mechanism that
 * absorbs T+1 balance funding (SPEC §4.1): a split created at sale time is
 * typically paid by the sweep within one cycle after settlement lands.
 *
 * Logic (SPEC §4.7):
 *   1. Up to 20 rows: provider='paystack', status='pending', older than 10
 *      minutes, attempt_count < cap — oldest first.
 *   2. Per row: a transfer_code present → reconcile via GET /transfer/{code}
 *      first (success → transferred + push; failed/reversed → §4.5.3
 *      semantics; pending/otp → skip). No transfer yet → attemptTransferForSplit.
 *   3. Per-row try/catch — one row's failure never stops the sweep.
 *   4. Rows at the attempt cap are finalized 'failed' + a single ops alert
 *      (idempotent: the status flip means the row is never re-selected).
 *
 * Auth: service-role only (verify_jwt=false in config.toml; the Authorization
 * header must carry SUPABASE_SERVICE_ROLE_KEY — mirrors
 * reconcile-stuck-checkouts). Invoke manually:
 *   curl -X POST <fn-url> -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  attemptTransferForSplit,
  defaultPaystackPartnerSplitDeps,
  handlePaystackTransferEvent,
  MAX_PAYSTACK_TRANSFER_ATTEMPTS,
  paystackPartnerAlertRecipients,
  resolveActivePaystackRecipient,
  type PaystackPartnerSplitDeps,
} from "../_shared/paystackPartnerSplits.ts";

const SWEEP_BATCH = 20;
const MIN_AGE_MINUTES = 10;

interface SweepRow {
  id: string;
  stripe_application_fee_id: string;
  order_id: string;
  brand_id: string;
  partner_account_id: string;
  partner_share_cents: number;
  attempt_count: number;
  error_message: string | null;
  stripe_transfer_id: string | null;
}

interface SweepResult {
  scanned: number;
  transferred: number;
  retried: number;
  skipped: number;
  failed: number;
}

export async function runPartnerPaystackSplitSweep(
  supabase: SupabaseClient,
  deps: PaystackPartnerSplitDeps = defaultPaystackPartnerSplitDeps(),
): Promise<SweepResult> {
  const result: SweepResult = {
    scanned: 0,
    transferred: 0,
    retried: 0,
    skipped: 0,
    failed: 0,
  };
  const cutoffIso = new Date(Date.now() - MIN_AGE_MINUTES * 60_000)
    .toISOString();

  // §4.7.4 — finalize rows already at the cap (single alert; idempotent via
  // the status flip: once 'failed' they are never selected again).
  const { data: cappedRows, error: cappedErr } = await supabase
    .from("partner_splits")
    .select("id, stripe_application_fee_id, order_id, error_message")
    .eq("provider", "paystack")
    .eq("status", "pending")
    .gte("attempt_count", MAX_PAYSTACK_TRANSFER_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(SWEEP_BATCH);
  if (cappedErr) {
    throw new Error(`sweep capped-rows select failed: ${cappedErr.message}`);
  }
  for (const raw of cappedRows ?? []) {
    const row = raw as Record<string, unknown>;
    try {
      await supabase.rpc("mark_partner_split_failed", {
        p_application_fee_id: String(row.stripe_application_fee_id),
        p_reason: "failed",
        p_error_message: `retry_cap_exhausted: ${
          String(row.error_message ?? "no prior error")
        }`.slice(0, 1000),
      });
      await deps.sendOpsAlert({
        subject: "[Mingla ops] Paystack partner split failed permanently",
        paragraphs: [
          `Partner split ${String(row.id)} (order ${
            String(row.order_id)
          }) exhausted ${MAX_PAYSTACK_TRANSFER_ATTEMPTS} transfer attempts and is finalized 'failed'.`,
          `Last error: ${String(row.error_message ?? "none recorded").slice(0, 500)}`,
        ],
        recipients: paystackPartnerAlertRecipients(),
      });
      result.failed += 1;
    } catch (rowErr) {
      console.error(
        "[partner-paystack-split-retry] cap finalize failed (row continues):",
        String(row.id),
        rowErr instanceof Error ? rowErr.message : String(rowErr),
      );
    }
  }

  // §4.7.1 — the retry batch.
  const { data: rows, error: selectErr } = await supabase
    .from("partner_splits")
    .select(
      "id, stripe_application_fee_id, order_id, brand_id, partner_account_id, partner_share_cents, attempt_count, error_message, stripe_transfer_id",
    )
    .eq("provider", "paystack")
    .eq("status", "pending")
    .lt("created_at", cutoffIso)
    .lt("attempt_count", MAX_PAYSTACK_TRANSFER_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(SWEEP_BATCH);
  if (selectErr) {
    throw new Error(`sweep select failed: ${selectErr.message}`);
  }

  for (const raw of rows ?? []) {
    const row = raw as unknown as SweepRow;
    result.scanned += 1;
    try {
      if (row.stripe_transfer_id) {
        // §4.7.2 — a transfer is already in flight: reconcile before retrying
        // so we never double-initiate. GET /transfer/{code}.
        const transfer = await deps.fetchTransfer(row.stripe_transfer_id);
        const status = String(
          (transfer as Record<string, unknown>).status ?? "",
        ).toLowerCase();
        if (status === "success") {
          await handlePaystackTransferEvent(supabase, "transfer.success", {
            reference: `psplit_${row.id}_a${row.attempt_count}`,
            transfer_code: row.stripe_transfer_id,
          }, deps);
          result.transferred += 1;
        } else if (status === "failed") {
          await handlePaystackTransferEvent(supabase, "transfer.failed", {
            reference: `psplit_${row.id}_a${row.attempt_count}`,
            transfer_code: row.stripe_transfer_id,
            reason: `sweep reconcile: transfer status ${status}`,
          }, deps);
          result.retried += 1;
        } else if (status === "reversed") {
          // Reconcile-reversed on a still-pending row (we missed the success
          // webhook): definitive for THIS reference — bump (new reference)
          // and clear the transfer code so the next sweep re-attempts.
          await supabase.rpc("bump_paystack_partner_split_attempt", {
            p_key: row.stripe_application_fee_id,
            p_error: "transfer_reversed_by_bank",
          });
          const { error: clearErr } = await supabase
            .from("partner_splits")
            .update({ stripe_transfer_id: null })
            .eq("id", row.id)
            .eq("status", "pending");
          if (clearErr) {
            throw new Error(`reversed transfer_code clear failed: ${clearErr.message}`);
          }
          result.retried += 1;
        } else {
          // pending / otp / queued — leave it; the webhook or next sweep settles it.
          result.skipped += 1;
        }
        continue;
      }

      // No transfer initiated yet — eligibility, then attempt.
      const recipient = await resolveActivePaystackRecipient(
        supabase,
        row.partner_account_id,
      );
      if (!recipient) {
        await supabase.rpc("mark_partner_split_failed", {
          p_application_fee_id: row.stripe_application_fee_id,
          p_reason: "blocked_no_paystack",
          p_error_message: "Partner has no active Paystack payout account.",
        });
        result.failed += 1;
        continue;
      }
      const outcome = await attemptTransferForSplit(supabase, {
        id: row.id,
        key: row.stripe_application_fee_id,
        orderId: row.order_id,
        brandId: row.brand_id,
        partnerAccountId: row.partner_account_id,
        partnerShareCents: row.partner_share_cents,
        attemptCount: row.attempt_count,
        errorMessage: row.error_message,
        recipientCode: recipient.recipientCode,
      }, deps);
      if (outcome === "transferred") result.transferred += 1;
      else if (outcome === "failed") result.failed += 1;
      else result.retried += 1;
    } catch (rowErr) {
      // §4.7.3 — one row's failure never stops the sweep.
      console.error(
        "[partner-paystack-split-retry] row failed (sweep continues):",
        row.id,
        rowErr instanceof Error ? rowErr.message : String(rowErr),
      );
      result.skipped += 1;
    }
  }

  return result;
}

export async function handler(req: Request): Promise<Response> {
  // Service-role gate — mirrors reconcile-stuck-checkouts/index.ts.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (serviceKey.length === 0 || !auth.includes(serviceKey)) {
    return new Response("unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    const result = await runPartnerPaystackSplitSweep(supabase);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[partner-paystack-split-retry] sweep failed:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

if (import.meta.main) {
  serve(handler);
}
