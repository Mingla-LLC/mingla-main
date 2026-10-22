/** Issue #3697 — translate the reviewed audience stage plan into provider ad sets. */

import type { CreateAdSetInput, Platform } from "./adChannelCore.ts";
import type {
  AdStage,
  AdStagePlan,
  AdStageTargeting,
} from "./adAudienceStages.ts";

export type StagedAdSetPlan = {
  stage: AdStage;
  adSet: CreateAdSetInput;
  audienceCodes: string[];
  audienceSizes: Record<string, number | null>;
  budgetPercent: number;
  budgetCents: number;
};

function cleanIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function targetingForStage(
  platform: Platform,
  baseTargeting: Record<string, unknown>,
  stage: AdStageTargeting,
): Record<string, unknown> {
  const include = cleanIds(stage.includeAudienceIds);
  const exclude = cleanIds(stage.excludeAudienceIds);
  if (exclude.length === 0) {
    throw new Error(`stage_buyer_exclusion_required:${stage.stage}`);
  }
  if (include.some((id) => exclude.includes(id))) {
    throw new Error(`stage_audience_include_exclude_overlap:${stage.stage}`);
  }
  if (platform === "meta") {
    return {
      ...baseTargeting,
      ...(include.length > 0
        ? { custom_audiences: include.map((id) => ({ id })) }
        : {}),
      excluded_custom_audiences: exclude.map((id) => ({ id })),
      targeting_automation: {
        advantage_audience: stage.advantageAudience ? 1 : 0,
      },
    };
  }
  if (platform === "snapchat") {
    return {
      ...baseTargeting,
      ...(include.length > 0 ? { segment_include_ids: include } : {}),
      segment_exclude_ids: exclude,
      ...(stage.frequencyCap
        ? {
          frequency_cap: {
            impressions: stage.frequencyCap.impressions,
            days: stage.frequencyCap.days,
          },
        }
        : {}),
    };
  }
  if (platform === "tiktok") {
    return {
      ...baseTargeting,
      ...(include.length > 0 ? { audience_ids: include } : {}),
      excluded_audience_ids: exclude,
    };
  }
  throw new Error(`staged_targeting_platform_unsupported:${platform}`);
}

/**
 * Paid social stages use ad-set/ad-group/ad-squad budgets so the reviewed
 * 70/20/10 allocation is the value actually sent to the provider. A stage
 * omitted for audience size has already had its share folded into prospecting
 * by buildAdStagePlan.
 */
export function buildStagedAdSetPlan(input: {
  platform: Platform;
  stagePlan: AdStagePlan;
  baseAdSet:
    & Omit<
      CreateAdSetInput,
      "name" | "targeting" | "budgetCents" | "lifetimeBudgetCents"
    >
    & { namePrefix: string; targeting: Record<string, unknown> };
  budgetMode: "daily" | "lifetime";
}): StagedAdSetPlan[] {
  if (input.stagePlan.platform !== input.platform) {
    throw new Error("stage_plan_platform_mismatch");
  }
  if (input.stagePlan.blocked) {
    throw new Error(
      `stage_plan_blocked:${
        input.stagePlan.blockedReason ?? "buyer_exclusion_missing"
      }`,
    );
  }
  const executable = input.stagePlan.stages.filter((stage) =>
    stage.enabled && stage.executable
  );
  if (!executable.some((stage) => stage.stage === "prospecting")) {
    throw new Error("stage_plan_prospecting_required");
  }
  if (executable.some((stage) => stage.budgetCents <= 0)) {
    throw new Error("stage_plan_budget_required");
  }

  return executable.map((stage) => ({
    stage: stage.stage,
    adSet: {
      name: `${input.baseAdSet.namePrefix} — ${stage.stage}`,
      optimizationGoal: input.baseAdSet.optimizationGoal,
      billingEvent: input.baseAdSet.billingEvent,
      targeting: targetingForStage(
        input.platform,
        input.baseAdSet.targeting,
        stage,
      ),
      ...(input.budgetMode === "lifetime"
        ? { lifetimeBudgetCents: stage.budgetCents }
        : { budgetCents: stage.budgetCents }),
      ...(input.baseAdSet.promotedObject
        ? { promotedObject: input.baseAdSet.promotedObject }
        : {}),
      ...(input.baseAdSet.startTime
        ? { startTime: input.baseAdSet.startTime }
        : {}),
      ...(input.baseAdSet.endTime ? { endTime: input.baseAdSet.endTime } : {}),
      ...(input.baseAdSet.validateOnly !== undefined
        ? { validateOnly: input.baseAdSet.validateOnly }
        : {}),
    },
    audienceCodes: [...stage.audienceCodes],
    audienceSizes: { ...stage.audienceSizes },
    budgetPercent: stage.budgetPercent,
    budgetCents: stage.budgetCents,
  }));
}
