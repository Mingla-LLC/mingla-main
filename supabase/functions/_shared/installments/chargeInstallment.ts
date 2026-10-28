/**
 * Issue #3645 — the provider-neutral owner of "charge this instalment now".
 *
 * MINGLA-INVARIANT: I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER | issue #3645 | cron, manual "charge now" and Ari reach instalment money only through chargeInstallment, which routes to the two rail owners (createInstallmentPI for Stripe, chargePaystackInstallment for Paystack)
 * MINGLA-INVARIANT: I-3645-PS-4 | issue #3645 | routing reads the instalment's own immutable provider and collection method, never brands.payment_provider
 *
 * Routing (row read fresh):
 *   stripe                → createInstallmentPI (unchanged Stripe behaviour).
 *   paystack + auto_card  → chargePaystackInstallment.
 *   paystack + pay_link   → at a checkpoint (due date / retry date) count the
 *                           unpaid link as a failure and resend; otherwise send
 *                           the link when none is live (the first link is the
 *                           buyer's notice).
 */
// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createInstallmentPI, type CreateInstallmentPIResult } from "./createInstallmentPI.ts";
import {
  chargePaystackInstallment,
  type ChargePaystackDeps,
  notifyPaystackInstallmentFailure,
} from "./chargePaystackInstallment.ts";
import { sendInstallmentPayLink } from "./installmentPayLinks.ts";

export type ChargeInstallmentOutcome =
  | "collected"
  | "failed"
  | "at_risk_flagged"
  | "approval_required"
  | "pay_link_sent"
  | "unknown"
  | "skipped";

export interface ChargeDeps extends ChargePaystackDeps {
  createInstallmentPI: (input: Parameters<typeof createInstallmentPI>[0]) => Promise<CreateInstallmentPIResult>;
  chargePaystackInstallment: typeof chargePaystackInstallment;
  now: () => Date;
}

export async function chargeInstallment(input: {
  supabase: SupabaseClient;
  installmentId: string;
  trigger: "cron" | "manual" | "retry";
  atRiskOverride?: boolean;
  dryRun?: boolean;
  deps?: Partial<ChargeDeps>;
}): Promise<{ outcome: ChargeInstallmentOutcome; reason?: string; reference?: string; chargeId?: string }> {
  const { supabase } = input;
  const deps = input.deps ?? {};
  const now = deps.now ? deps.now() : new Date();

  const { data, error } = await supabase
    .from("order_installments")
    .select("id, provider, collection_method, status, due_at, next_retry_at, orders!inner(event_id, events!inner(brand_id))")
    .eq("id", input.installmentId)
    .maybeSingle();
  if (error !== null) throw new Error(`instalment load failed: ${error.message}`);
  if (data === null) return { outcome: "skipped", reason: "installment_not_found" };
  const row = data as Record<string, unknown>;
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Record<string, unknown>;
  const brandId = String(one(one(row.orders).events).brand_id);
  const provider = String(row.provider);
  const method = String(row.collection_method);

  if (input.dryRun === true) return { outcome: "skipped", reason: `dry_run:${provider}:${method}` };

  if (provider === "stripe") {
    const run = deps.createInstallmentPI ?? createInstallmentPI;
    const result = await run({
      installmentId: input.installmentId,
      brandId,
      supabase,
      override: input.atRiskOverride ? { atRisk: true } : undefined,
    });
    return {
      outcome: (result.outcome ?? (result.ok ? "collected" : "skipped")) as ChargeInstallmentOutcome,
      reason: result.reason ?? result.error,
      chargeId: result.chargeId,
    };
  }

  if (provider !== "paystack") return { outcome: "skipped", reason: "unknown_provider" };

  if (method === "auto_card") {
    const run = deps.chargePaystackInstallment ?? chargePaystackInstallment;
    return await run({ supabase, installmentId: input.installmentId, atRiskOverride: input.atRiskOverride, deps });
  }

  // pay_link: a reached checkpoint counts one failure and resends the link.
  const { data: cp, error: cpError } = await supabase.rpc("issue_3645_checkpoint_pay_link_installment", {
    p_installment_id: input.installmentId,
    p_now: now.toISOString(),
  });
  if (cpError !== null) throw new Error(`issue_3645_checkpoint_pay_link_installment failed: ${cpError.message}`);
  const checkpoint = (cp ?? {}) as Record<string, unknown>;
  if (checkpoint.ok === true) {
    await notifyPaystackInstallmentFailure(supabase, input.installmentId,
      { ...checkpoint, failure_reason: "pay_link_unpaid" }, deps);
    return { outcome: checkpoint.outcome === "at_risk" ? "at_risk_flagged" : "pay_link_sent", reason: "pay_link_unpaid" };
  }
  const reason = String(checkpoint.reason ?? "");
  if (reason === "attempt_in_flight" || reason === "installment_not_open" || reason === "not_pay_link") {
    return { outcome: "skipped", reason };
  }
  // Not at a checkpoint (or already at risk): make sure the buyer has a live link.
  const { count, error: linkError } = await supabase
    .from("order_installment_pay_links")
    .select("id", { count: "exact", head: true })
    .eq("installment_id", input.installmentId)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString());
  if (linkError !== null) throw new Error(`pay link lookup failed: ${linkError.message}`);
  if ((count ?? 0) > 0 && input.trigger !== "manual") return { outcome: "skipped", reason: "link_live" };
  const sent = await sendInstallmentPayLink(supabase, { installmentId: input.installmentId, purpose: "pay", deps });
  return sent.ok ? { outcome: "pay_link_sent" } : { outcome: "skipped", reason: sent.reason };
}
