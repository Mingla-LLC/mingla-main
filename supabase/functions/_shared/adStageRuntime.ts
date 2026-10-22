/** Issue #3697 — bind one reviewed event plan to executable paid-social stages. */

import {
  type AdAudienceRow,
  type AdStage,
  type AdStagePlan,
  buildAdStagePlan,
  type PaidSocialPlatform,
} from "./adAudienceStages.ts";
import type { CreateAdSetInput } from "./adChannelCore.ts";
import {
  buildStagedAdSetPlan,
  type StagedAdSetPlan,
} from "./adStagedCreatePlan.ts";
import { stageCreativeIds } from "./adStageCreativeSelection.ts";

type Row = Record<string, unknown>;

export type PaidSocialStageRuntime = {
  plan: AdStagePlan;
  adSets: StagedAdSetPlan[];
  creativeIds: Record<AdStage, string[]>;
  snapshotRows: Array<{
    stage: AdStage;
    enabled: boolean;
    executable: boolean;
    budget_percent: number;
    budget_cents: number;
    audience_codes: string[];
    audience_sizes: Record<string, number | null>;
    widened: AdStagePlan["stages"][number]["widened"];
    reason: string | null;
  }>;
};

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : {};
}

/**
 * Pure on purpose: provider ids arrive only through server-read ad_audiences
 * rows, while creative ids and stage toggles arrive only from the immutable
 * reviewed plan version. The request body is not an authority for either.
 */
export function buildPaidSocialStageRuntime(input: {
  platform: PaidSocialPlatform;
  canonicalPlan: Row;
  audiences: AdAudienceRow[];
  market: string;
  brandId: string;
  eventId: string;
  totalBudgetCents: number;
  baseAdSet:
    & Omit<
      CreateAdSetInput,
      "name" | "targeting" | "budgetCents" | "lifetimeBudgetCents"
    >
    & { namePrefix: string; targeting: Row };
  budgetMode: "daily" | "lifetime";
}): PaidSocialStageRuntime {
  const selected = stageCreativeIds(input.canonicalPlan.stage_creative_ids);
  if (!selected.ok) throw new Error(selected.detail);
  const selection = record(input.canonicalPlan.stage_selection);
  const enabledStages = {
    prospecting: selection.prospecting !== false,
    retarget: selection.retarget !== false,
    abandoners: selection.abandoners !== false,
  };
  const plan = buildAdStagePlan({
    platform: input.platform,
    rows: input.audiences,
    market: input.market,
    brandId: input.brandId,
    eventId: input.eventId,
    totalBudgetCents: input.totalBudgetCents,
    enabledStages,
  });
  if (!plan) throw new Error("paid_social_stage_plan_required");
  const adSets = buildStagedAdSetPlan({
    platform: input.platform,
    stagePlan: plan,
    baseAdSet: input.baseAdSet,
    budgetMode: input.budgetMode,
  });
  for (const stage of adSets) {
    const ids = selected.byStage[stage.stage];
    if (ids.length < 2 || ids.length > 4) {
      throw new Error(`stage_creative_count_invalid:${stage.stage}`);
    }
  }
  return {
    plan,
    adSets,
    creativeIds: selected.byStage,
    snapshotRows: plan.stages.map((stage) => ({
      stage: stage.stage,
      enabled: stage.enabled,
      executable: stage.executable,
      budget_percent: stage.budgetPercent,
      budget_cents: stage.budgetCents,
      audience_codes: [...stage.audienceCodes],
      audience_sizes: { ...stage.audienceSizes },
      widened: [...stage.widened],
      reason: stage.reason,
    })),
  };
}
