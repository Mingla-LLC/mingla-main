/**
 * Issue #3697 — auto/manual pause convergence and relaunch preparation.
 *
 * Fails on revert of the shared RPC caller or either edge-function wiring.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  markPlanPaused,
  type PlanPauseRpcClient,
  preparePlanForLaunch,
} from "../adPlanPauseTransition.ts";

const PLAN_ID = "36970000-0000-4000-8000-000000000701";

class RpcFake implements PlanPauseRpcClient {
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  response: { data: unknown; error: { message?: string } | null };

  constructor(response: { data: unknown; error: { message?: string } | null }) {
    this.response = response;
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    return Promise.resolve(this.response);
  }
}

function transition(
  state: "paused" | "partially_live",
  transitionPath: string[],
) {
  return {
    plan_id: PLAN_ID,
    state,
    transition_path: transitionPath,
    reason: "spend_fetch_failed",
  };
}

Deno.test("#3697 spend-sync pause reports the guard-legal live -> pause_requested -> paused path", async () => {
  const db = new RpcFake({
    data: transition("paused", ["live", "pause_requested", "paused"]),
    error: null,
  });
  const result = await markPlanPaused(db, PLAN_ID, "spend_fetch_failed");
  assert(result.ok);
  assertEquals(result.transition.state, "paused");
  assertEquals(result.transition.transition_path, [
    "live",
    "pause_requested",
    "paused",
  ]);
  assertEquals(db.calls, [{
    name: "ad_plan_mark_paused",
    args: { p_plan_id: PLAN_ID, p_reason: "spend_fetch_failed" },
  }]);
});

Deno.test("#3697 one still-active provider leaves the plan partially_live", async () => {
  const db = new RpcFake({
    data: transition("partially_live", ["live", "partially_live"]),
    error: null,
  });
  const result = await markPlanPaused(db, PLAN_ID, "cap_98_percent");
  assert(result.ok);
  assertEquals(result.transition.state, "partially_live");
  assertEquals(result.transition.transition_path, ["live", "partially_live"]);
});

Deno.test("#3697 a pause-transition RPC refusal is surfaced verbatim", async () => {
  const db = new RpcFake({
    data: null,
    error: { message: "ad_plan_pause_state_invalid:platform_review" },
  });
  const result = await markPlanPaused(db, PLAN_ID, "spend_fetch_failed");
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertStringIncludes(result.detail, "plan_pause_transition_failed");
    assertStringIncludes(result.detail, "ad_plan_pause_state_invalid");
  }
});

Deno.test("#3697 launch after a normal auto-pause keeps every launch guard", async () => {
  const db = new RpcFake({ data: null, error: null });
  let launchChecks = 0;
  const result = await preparePlanForLaunch({
    db,
    planId: PLAN_ID,
    planState: "paused",
    campaigns: [{ status: "PAUSED" }],
    assertLaunchable: () => {
      launchChecks += 1;
      return Promise.resolve({ data: { plan_id: PLAN_ID }, error: null });
    },
  });
  assertEquals(result, { ok: true, state: "paused", reconciled: false });
  assertEquals(launchChecks, 1);
  assertEquals(db.calls.length, 0);
});

Deno.test("#3697 legacy live + all-PAUSED reconciles before the launch check", async () => {
  const order: string[] = [];
  const db: PlanPauseRpcClient = {
    rpc(name, args) {
      order.push(name);
      assertEquals(
        args.p_reason,
        "legacy_live_all_campaigns_paused_before_launch",
      );
      return Promise.resolve({
        data: {
          ...transition("paused", ["live", "pause_requested", "paused"]),
          reason: String(args.p_reason),
        },
        error: null,
      });
    },
  };
  const result = await preparePlanForLaunch({
    db,
    planId: PLAN_ID,
    planState: "live",
    campaigns: [{ status: "PAUSED" }, { status: "paused" }],
    assertLaunchable: () => {
      order.push("ad_plan_assert_launchable");
      return Promise.resolve({ data: {}, error: null });
    },
  });
  assertEquals(result, { ok: true, state: "paused", reconciled: true });
  assertEquals(order, ["ad_plan_mark_paused", "ad_plan_assert_launchable"]);
});

Deno.test("#3697 both edge paths use the shared RPC and no pause state write is ignored", async () => {
  const spendSync = await Deno.readTextFile(
    new URL("../../admin-ad-spend-sync/index.ts", import.meta.url),
  );
  const campaignAction = await Deno.readTextFile(
    new URL("../../admin-ad-campaign-action/index.ts", import.meta.url),
  );
  assertStringIncludes(spendSync, "import { markPlanPaused }");
  assertStringIncludes(spendSync, "plan_version:ad_plan_versions(plan_id)");
  assertStringIncludes(spendSync, "auto_pause_reason: reason");
  assertStringIncludes(
    spendSync,
    "await markPlanPaused(supabase, planId, reason)",
  );

  assertStringIncludes(campaignAction, "await preparePlanForLaunch({");
  assertStringIncludes(campaignAction, 'db.rpc("ad_plan_assert_launchable"');
  assertStringIncludes(
    campaignAction,
    'await markPlanPaused(db, String(plan.id), "manual_pause")',
  );
  assertStringIncludes(campaignAction, 'error: "pause_failed"');
  assertStringIncludes(campaignAction, "detail: planPause.detail");
  assert(!campaignAction.includes('update({ state: "pause_requested" })'));
});
