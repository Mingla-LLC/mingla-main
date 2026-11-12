// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";
import { gigTimerDecision, timerDedupeKey } from "../_shared/gigTimers.ts";
import {
  applyGigOutcomeEffects,
  isGigPaymentKind,
  notifyGigPaymentMismatch,
  probeGigPayment,
  requestGigLateRefund,
  supabaseGigCaptureStore,
} from "../_shared/gigPaymentCapture.ts";
import { paystackVerifyTransactionOutcome } from "../_shared/paystack.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await isAuthorizedCronCaller(req.headers.get("authorization")))) {
    return json({ error: "unauthorized" }, 401);
  }
  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const now = new Date();
  const { data: notificationTick, error: notificationError } = await db.rpc(
    "gig_notification_tick",
    { p_now: now.toISOString() },
  );
  // Offers whose payment never completed are retired first, so the refund
  // worker below never sees them. #4402: each one is checked with the
  // provider first; only the ones proven unpaid are retired, and a paid one
  // is recorded instead (I-4402-C). A provider error leaves the offer alone.
  const proveUnpaid = async () => {
    const { data: candidates, error: candidatesError } = await db.rpc(
      "gig_pending_offer_candidates",
      { p_now: now.toISOString() },
    );
    if (candidatesError) {
      // Old SQL (migration not applied): never retire without proof.
      return { ids: [] as string[], checks: [], error: candidatesError.message };
    }
    const probeDeps = {
      store: supabaseGigCaptureStore(db),
      paystackVerifyOutcome: (reference: string) =>
        paystackVerifyTransactionOutcome(reference),
      stripeRetrieve: (id: string) =>
        stripeTicketCheckout().paymentIntents.retrieve(id),
    };
    const ids: string[] = [];
    const checks: Array<Record<string, unknown>> = [];
    for (const row of (candidates ?? []) as Array<Record<string, unknown>>) {
      const kind = row.kind;
      if (!isGigPaymentKind(kind)) continue;
      const target = {
        kind,
        contractId: String(row.contract_id),
        termsVersion: Number(row.terms_version),
        rail: row.rail === "stripe" ? "stripe" as const : "paystack" as const,
        reference: typeof row.reference === "string" ? row.reference : null,
      };
      try {
        const outcome = await probeGigPayment(probeDeps, target);
        await applyGigOutcomeEffects(db, outcome, {
          source: "gig-timers",
          rail: target.rail,
          reference: target.reference ?? target.contractId,
          notifyMismatch: (input) => notifyGigPaymentMismatch(input),
          requestLateRefund: (contractId: string) =>
            requestGigLateRefund(contractId, {
              supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
              serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
            }),
        });
        if (outcome.status === "not_paid") ids.push(target.contractId);
        checks.push({ id: target.contractId, outcome: outcome.status });
      } catch (probeError) {
        checks.push({
          id: target.contractId,
          error: probeError instanceof Error ? probeError.message : String(probeError),
        });
      }
    }
    return { ids, checks, error: null as string | null };
  };
  const proven = await proveUnpaid();
  const { data: pendingSweep, error: pendingSweepError } = proven.ids.length
    ? await db.rpc("gig_pending_offer_sweep", {
      p_now: now.toISOString(),
      p_contract_ids: proven.ids,
    })
    : { data: { ok: true, retired: 0 }, error: proven.error ? { message: proven.error } : null };
  const callWorker = async (name: string, payload: Record<string, unknown>) => {
    const response = await fetch(
      `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/${name}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
          }`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    return { ok: response.ok, result: await response.json().catch(() => null) };
  };
  // Lower accepted counter-offers owe the host the difference.
  const counterRefunds: Array<Record<string, unknown>> = [];
  const { data: pendingRefunds } = await db.from("gig_hold_adjustments")
    .select("contract_id").eq("kind", "refund").eq("status", "pending")
    .limit(100);
  for (const row of pendingRefunds ?? []) {
    const outcome = await callWorker("gig-refund", {
      contract_id: row.contract_id,
      branch: "counter_lower",
    });
    counterRefunds.push({ id: row.contract_id, ...outcome });
  }
  const { data, error } = await db.from("gig_contracts").select(
    "id,state,state_deadline_at",
  ).not("state_deadline_at", "is", null).lte(
    "state_deadline_at",
    now.toISOString(),
  ).limit(200);
  if (error) return json({ error: "contract_scan_failed" }, 500);
  const outcomes: Array<Record<string, unknown>> = [];
  for (const row of data ?? []) {
    const decision = gigTimerDecision({
      state: row.state,
      deadlineAt: row.state_deadline_at,
      now,
    });
    if (!decision) continue;
    const dedupe = timerDedupeKey(row.id, row.state, row.state_deadline_at);
    // Refund/release provider mutations are deliberately delegated to their
    // dedicated idempotent workers before their transition is retried.
    if (decision.refundBranch || decision.action === "release") {
      const functionName = decision.action === "release"
        ? "gig-release"
        : "gig-refund";
      const { ok: workerOk, result: providerResult } = await callWorker(
        functionName,
        decision.action === "release" ? { contract_id: row.id } : {
          contract_id: row.id,
          branch: decision.refundBranch,
        },
      );
      outcomes.push({
        id: row.id,
        state: row.state,
        action: decision.action,
        dedupe,
        worker: functionName,
        ok: workerOk,
        result: providerResult,
      });
      continue;
    }
    const { data: result, error: transitionError } = await db.rpc(
      "gig_transition",
      {
        p_contract_id: row.id,
        p_expected_state: row.state,
        p_action: decision.action,
        p_payload: { timer_dedupe: dedupe },
      },
    );
    outcomes.push({
      id: row.id,
      action: decision.action,
      ok: !transitionError,
      result: result ?? null,
      error: transitionError?.message ?? null,
      dedupe,
    });
  }
  return json({
    ok: true,
    scanned: data?.length ?? 0,
    outcomes,
    notifications: notificationTick ?? null,
    pendingOffers: pendingSweep ?? null,
    pendingOfferError: pendingSweepError?.message ?? null,
    pendingOfferChecks: proven.checks,
    counterRefunds,
    notificationError: notificationError?.message ?? null,
  });
});
