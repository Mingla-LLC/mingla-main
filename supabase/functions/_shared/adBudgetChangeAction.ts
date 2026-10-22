/**
 * Issue #3697 — the governed "Change budget" action (admin-ad-campaign-action
 * `change_budget`), with its database and provider seams injected so the
 * whole path is testable without a network.
 *
 * Order: validate + allocate (pure) → push each changed daily budget to the
 * provider object the create path set it on (Meta: the CBO campaign) → record
 * the amendment, hold move and audit rows in one RPC. A provider failure
 * reverts the pushes already made; an RPC failure after the push reverts the
 * provider too, so Mingla's cap and the provider never silently disagree.
 */

import type {
  AdConnectionRow,
  ChannelAdapter,
  Platform,
} from "./adChannelCore.ts";
import {
  type BudgetCampaign,
  type BudgetChangeLine,
  planBudgetChange,
  proportionalSplit,
  spendToDate,
} from "./adBudgetChange.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const BUDGET_CHANGE_PLAN_STATES = new Set([
  "platform_review",
  "scheduled",
  "live",
  "pause_requested",
  "paused",
  "partially_ready",
  "partially_live",
]);

export type BudgetChangeResult = {
  status: number;
  body: Record<string, unknown>;
};

type BudgetTarget = {
  level: "campaign" | "ad_set";
  externalId: string;
  previousCents: number;
  nextCents: number;
};

async function budgetTargets(
  db: Db,
  row: Record<string, unknown>,
  line: BudgetChangeLine,
): Promise<BudgetTarget[]> {
  if (line.platform === "meta") {
    const externalId = String(row.external_campaign_id ?? "");
    if (!externalId) throw new Error("campaign_budget_target_missing");
    return [{
      level: "campaign",
      externalId,
      previousCents: line.previous_daily_cents,
      nextCents: line.new_daily_cents,
    }];
  }
  if (line.platform !== "snapchat" && line.platform !== "tiktok") {
    throw new Error(`${line.platform}_budget_target_unsupported`);
  }
  const { data: adSets, error } = await db.from("ad_sets")
    .select("id,external_adset_id,budget_cents")
    .eq("campaign_id", row.id)
    .order("id");
  if (error || !Array.isArray(adSets) || adSets.length === 0) {
    throw new Error("ad_set_budget_target_missing");
  }
  const ids = adSets.map((adSet: Record<string, unknown>) =>
    String(adSet.external_adset_id ?? "")
  );
  if (ids.some((id: string) => !id)) {
    throw new Error("ad_set_budget_target_missing");
  }
  const weights = adSets.map((adSet: Record<string, unknown>) => {
    const cents = Number(adSet.budget_cents);
    return Number.isSafeInteger(cents) && cents > 0 ? cents : 1;
  });
  const previous = proportionalSplit(line.previous_daily_cents, weights);
  const next = proportionalSplit(line.new_daily_cents, weights);
  return ids.map((externalId: string, index: number) => ({
    level: "ad_set" as const,
    externalId,
    previousCents: previous[index],
    nextCents: next[index],
  }));
}

export async function runBudgetChange(
  deps: { db: Db; getAdapter: (platform: Platform) => ChannelAdapter },
  input: {
    campaign: Record<string, unknown>;
    actorId: string;
    body: Record<string, unknown>;
  },
): Promise<BudgetChangeResult> {
  const { db, getAdapter } = deps;
  const { campaign, actorId, body } = input;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length === 0) {
    return {
      status: 400,
      body: {
        error: "budget_change_confirm_required",
        detail: "reason_required",
      },
    };
  }
  const versionId = String(campaign.plan_version_id ?? "");
  const planHash = String(campaign.plan_hash ?? "");
  if (!/^[0-9a-f]{64}$/.test(planHash) || !versionId) {
    return {
      status: 409,
      body: { error: "plan_conflict", detail: "plan_binding_missing" },
    };
  }
  const { data: plan } = await db.from("ad_plans").select("*")
    .eq("current_version_id", versionId).maybeSingle();
  if (!plan) {
    return {
      status: 409,
      body: { error: "plan_conflict", detail: "plan_binding_missing" },
    };
  }
  if (plan.owner_kind !== "mingla") {
    return {
      status: 409,
      body: {
        error: "host_budget_change_not_available_yet",
        detail: "Changing the budget is not available for Host campaigns yet.",
      },
    };
  }
  if (!BUDGET_CHANGE_PLAN_STATES.has(String(plan.state))) {
    return {
      status: 409,
      body: {
        error: "budget_change_blocked",
        detail: "plan_state_not_changeable",
        plan_state: plan.state,
      },
    };
  }
  const { data: rows, error: rowsError } = await db.from("ad_campaigns")
    .select("*").eq("plan_version_id", versionId).eq("plan_hash", planHash)
    .order("platform");
  if (rowsError || !rows?.length) {
    return {
      status: 409,
      body: { error: "plan_conflict", detail: "plan_campaigns_missing" },
    };
  }
  const campaigns = rows as Array<Record<string, unknown>>;
  const spendByCampaign: Record<string, number | null> = {};
  for (const row of campaigns) {
    const { data: spendRows, error: spendError } = await db
      .from("ad_spend_daily").select("spend_cents,currency")
      .eq("campaign_id", row.id);
    if (spendError) {
      return {
        status: 503,
        body: { error: "budget_change_blocked", detail: "spend_read_failed" },
      };
    }
    const providerCurrency = typeof row.provider_currency === "string"
      ? row.provider_currency
      : null;
    // A live campaign with no spend row yet has unknown spend, not zero.
    spendByCampaign[String(row.id)] =
      (spendRows ?? []).length === 0 && row.status === "ACTIVE"
        ? null
        : spendToDate(spendRows ?? [], providerCurrency);
  }
  const plan_ = planBudgetChange({
    ownerKind: plan.owner_kind,
    campaigns: campaigns as unknown as BudgetCampaign[],
    spendByCampaign,
    newDailyCents: body.daily_budget_cents,
    newCapCents: body.cap_cents,
  });
  if (!plan_.ok) {
    return {
      status: plan_.error === "budget_amount_invalid" ||
          plan_.error === "budget_change_empty"
        ? 400
        : 409,
      body: { error: plan_.error, detail: plan_.detail ?? plan_.error },
    };
  }

  const pushed: Array<{
    line: BudgetChangeLine;
    connection: AdConnectionRow;
    target: BudgetTarget;
  }> = [];
  const evidence: Record<string, Record<string, unknown>> = {};
  const revert = async () => {
    for (const done of pushed.reverse()) {
      try {
        await getAdapter(done.line.platform).setBudget(
          done.connection,
          done.target.level,
          done.target.externalId,
          done.target.previousCents,
        );
      } catch {
        // Surfaced below: the response names the provider that may differ.
      }
    }
  };
  for (const line of plan_.lines) {
    if (!line.daily_changed) continue;
    const row = campaigns.find((item) => item.id === line.campaign_id) ?? {};
    const { data: connection } = await db.from("ad_connections").select("*")
      .eq("id", row.connection_id).maybeSingle();
    if (!connection?.connected || connection.status !== "connected") {
      await revert();
      return {
        status: 424,
        body: {
          error: `${line.platform}_not_connected`,
          detail: "nothing_saved",
        },
      };
    }
    try {
      const adapter = getAdapter(line.platform);
      if (typeof adapter.getBudget !== "function") {
        throw new Error("provider_budget_readback_unavailable");
      }
      const targets = await budgetTargets(db, row, line);
      const confirmed = [];
      for (const target of targets) {
        await adapter.setBudget(
          connection as AdConnectionRow,
          target.level,
          target.externalId,
          target.nextCents,
        );
        pushed.push({
          line,
          connection: connection as AdConnectionRow,
          target,
        });
        const readback = await adapter.getBudget(
          connection as AdConnectionRow,
          target.level,
          target.externalId,
        );
        if (readback.cents !== target.nextCents) {
          throw new Error(
            `provider_budget_readback_mismatch:${target.nextCents}:${readback.cents}`,
          );
        }
        confirmed.push({
          level: target.level,
          external_id: target.externalId,
          daily_budget_cents: readback.cents,
          provider_field: readback.field,
        });
      }
      evidence[line.campaign_id] = {
        level: targets.length === 1 ? targets[0].level : "multiple_ad_sets",
        confirmed,
        pushed_at: new Date().toISOString(),
      };
    } catch (error) {
      await revert();
      const detail = error instanceof Error ? error.message : String(error);
      return {
        status: 502,
        body: {
          error: `${line.platform}_budget_update_failed`,
          detail: detail.slice(0, 500),
          reverted: pushed.map((item) => item.line.platform),
        },
      };
    }
  }

  const { data: recorded, error: recordError } = await db.rpc(
    "ad_plan_amend_budget",
    {
      p_plan_version_id: versionId,
      p_plan_hash: planHash,
      p_changes: plan_.lines.map((line) => ({
        campaign_id: line.campaign_id,
        new_provider_budget_cents: line.new_cap_cents,
        new_provider_delivery_budget_cents: line.new_daily_cents,
      })),
      p_reason: reason.slice(0, 1000),
      p_actor_id: actorId,
      p_provider_evidence: evidence,
    },
  );
  if (recordError) {
    await revert();
    return {
      status: 409,
      body: {
        error: "budget_change_not_recorded",
        detail: String(recordError.message ?? recordError),
        provider_reverted: pushed.map((item) => item.line.platform),
      },
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      currency: plan_.currency,
      previous: plan_.previous,
      next: plan_.next,
      lines: plan_.lines,
      recorded,
    },
  };
}
