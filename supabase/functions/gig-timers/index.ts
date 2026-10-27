// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";
import { gigTimerDecision, timerDedupeKey } from "../_shared/gigTimers.ts";

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
  // Offers whose payment never completed are retired first (no money moved),
  // so the refund worker below never sees them.
  const { data: pendingSweep, error: pendingSweepError } = await db.rpc(
    "gig_pending_offer_sweep",
    { p_now: now.toISOString() },
  );
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
    counterRefunds,
    notificationError: notificationError?.message ?? null,
  });
});
