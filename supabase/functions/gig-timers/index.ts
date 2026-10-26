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
      const response = await fetch(
        `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/${functionName}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${
              Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
            }`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            decision.action === "release" ? { contract_id: row.id } : {
              contract_id: row.id,
              branch: decision.refundBranch,
            },
          ),
        },
      );
      const providerResult = await response.json().catch(() => null);
      outcomes.push({
        id: row.id,
        state: row.state,
        action: decision.action,
        dedupe,
        worker: functionName,
        ok: response.ok,
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
    notificationError: notificationError?.message ?? null,
  });
});
