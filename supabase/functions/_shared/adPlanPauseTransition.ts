/**
 * Issue #3697 — one edge-side caller for the service-only plan pause RPC.
 * The database owns campaign counting, locking, legal state transitions and
 * the plan-scoped audit row. Callers must surface every RPC refusal.
 */

export type PlanPauseTransition = {
  plan_id: string;
  state: "paused" | "partially_live";
  transition_path: string[];
  reason: string;
};

type RpcResult = { data: unknown; error: { message?: string } | null };

export type PlanPauseRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};

export type PlanPauseResult =
  | { ok: true; transition: PlanPauseTransition }
  | { ok: false; detail: string };

function transition(value: unknown): PlanPauseTransition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.plan_id !== "string" ||
    !["paused", "partially_live"].includes(String(row.state)) ||
    !Array.isArray(row.transition_path) ||
    typeof row.reason !== "string"
  ) return null;
  return row as PlanPauseTransition;
}

export async function markPlanPaused(
  db: PlanPauseRpcClient,
  planId: string,
  reason: string,
): Promise<PlanPauseResult> {
  const { data, error } = await db.rpc("ad_plan_mark_paused", {
    p_plan_id: planId,
    p_reason: reason,
  });
  if (error) {
    return {
      ok: false,
      detail: `plan_pause_transition_failed: ${
        error.message ?? "unknown_error"
      }`,
    };
  }
  const parsed = transition(data);
  return parsed
    ? { ok: true, transition: parsed }
    : { ok: false, detail: "plan_pause_transition_failed: unexpected_payload" };
}

export function allProviderCampaignsPaused(
  campaigns: Array<Record<string, unknown>>,
): boolean {
  return campaigns.length > 0 &&
    campaigns.every((campaign) =>
      String(campaign.status ?? "").toUpperCase() === "PAUSED"
    );
}

/**
 * The only legacy repair allowed before launch. It does not widen the launch
 * state list: an impossible live + all-PAUSED plan is first reconciled through
 * the same guarded RPC, then the unchanged launch assertion runs.
 */
export async function preparePlanForLaunch(input: {
  db: PlanPauseRpcClient;
  planId: string;
  planState: string;
  campaigns: Array<Record<string, unknown>>;
  assertLaunchable: () => PromiseLike<RpcResult>;
}): Promise<
  | { ok: true; state: string; reconciled: boolean }
  | { ok: false; step: "legacy_reconcile" | "launch_assertion"; detail: string }
> {
  let state = input.planState;
  let reconciled = false;
  if (state === "live" && allProviderCampaignsPaused(input.campaigns)) {
    const marked = await markPlanPaused(
      input.db,
      input.planId,
      "legacy_live_all_campaigns_paused_before_launch",
    );
    if (!marked.ok) {
      return { ok: false, step: "legacy_reconcile", detail: marked.detail };
    }
    state = marked.transition.state;
    reconciled = true;
  }
  const { error } = await input.assertLaunchable();
  if (error) {
    return {
      ok: false,
      step: "launch_assertion",
      detail: error.message ?? "ad_plan_launch_check_failed",
    };
  }
  return { ok: true, state, reconciled };
}
