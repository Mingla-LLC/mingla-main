/**
 * #4238 W4c (sub-item 3): adding the retarget ad set LIVE when a Host raises
 * the budget of a one-ad-set plan past 2× the ad-set floor.
 *
 * Only Snapchat and TikTok: their Host ads are ABO (the budget sits on the
 * ad squad / ad group), so a second budgeted ad set can join a live
 * campaign. A one-ad-set Meta Host campaign is CBO (the budget sits on the
 * campaign) and Meta can't mix a budgeted ad set into it, so Meta keeps one
 * ad set until the next launch (recorded on #4238).
 *
 * Trigger: the hourly spend sweep, once per campaign, only when the ORIGINAL
 * daily was below 2F and the amended (raised) daily is at least 2F — a raise
 * that crossed the threshold, never a plan that started there — and the
 * retarget audience and buyer exclusion are ready (the same hostAdSetSplit
 * create uses). Order, so the apps never run above the new daily total:
 *   1. new retarget ad set, PAUSED, budget R = max(F, floor(0.2·S));
 *   2. one ad per live prospecting ad, in the new ad set;
 *   3. prospecting lowered to S − R and read back;
 *   4. the retarget ad set switched ACTIVE.
 * A failure after step 1 pauses the new ad set and puts prospecting back;
 * it is recorded (retarget_added, status failed) and retried no sooner than
 * a day later.
 *
 * MINGLA-INVARIANT: I-4238-LIVE-RETARGET-ADD-ONLY-PAST-2F | issue #4238 | hostRetargetLiveAddDecision adds a retarget ad set to a live one-ad-set Host plan only on Snapchat/TikTok, only when the original daily was < 2F and the raised daily is >= 2F with a ready audience and buyer exclusion; both ad sets stay >= F.
 */
import type {
  AdConnectionRow,
  ChannelAdapter,
  Platform,
} from "./adChannelCore.ts";
import {
  hostAdSetSplit,
  type HostRetargetReadiness,
  hostRetargetTargeting,
} from "./adHostPlanRules.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const HOST_LIVE_RETARGET_ADD_PLATFORMS: ReadonlySet<string> = new Set([
  "snapchat",
  "tiktok",
]);

export type HostRetargetLiveAddDecision =
  | { add: true; prospectingCents: number; retargetCents: number }
  | { add: false; reason: string };

export function hostRetargetLiveAddDecision(input: {
  platform: string;
  ownerKind: string;
  originalDailyCents: number;
  amendedDailyCents: number | null;
  floorCents: number | null;
  hasRetargetAdSet: boolean;
  lifetime: boolean;
  readiness: HostRetargetReadiness | null;
}): HostRetargetLiveAddDecision {
  if (input.ownerKind !== "host") return { add: false, reason: "not_host" };
  if (!HOST_LIVE_RETARGET_ADD_PLATFORMS.has(input.platform)) {
    return { add: false, reason: "retarget_live_add_not_supported" };
  }
  if (input.hasRetargetAdSet) return { add: false, reason: "retarget_exists" };
  if (input.lifetime) {
    return { add: false, reason: "retarget_needs_daily_budget" };
  }
  const floor = input.floorCents;
  const amended = input.amendedDailyCents;
  if (floor === null || !(floor > 0) || amended === null) {
    return { add: false, reason: "budget_below_retarget_threshold" };
  }
  // Only a raise that crossed 2F (never a plan that started at 2F or more).
  if (input.originalDailyCents >= 2 * floor) {
    return { add: false, reason: "not_a_raise_past_threshold" };
  }
  const split = hostAdSetSplit(input.platform, amended, floor, input.readiness);
  if (split.ad_sets !== 2) {
    return {
      add: false,
      reason: split.retarget.reason ?? "retarget_audience_not_ready",
    };
  }
  return {
    add: true,
    prospectingCents: split.prospecting_cents,
    retargetCents: split.retarget_cents,
  };
}

/** Copies one live ad into the new ad set; returns the new ad id. */
export type CopyAdInto = (
  adSetExternalId: string,
  ad: { externalAdId: string; externalCreativeId: string | null },
) => Promise<string>;

export async function addHostRetargetAdSetLive(deps: {
  db: Db;
  adapter: ChannelAdapter;
  connection: AdConnectionRow;
  copyAdInto: CopyAdInto;
}, input: {
  campaignId: string;
  externalCampaignId: string;
  platform: Platform;
  planId: string;
  decision: { prospectingCents: number; retargetCents: number };
  include: readonly string[];
  exclude: readonly string[];
  audienceCodes: string[];
  audienceSizes: Record<string, number | null>;
}): Promise<string> {
  const { db, adapter, connection } = deps;
  const { data: sets, error } = await db.from("ad_sets")
    .select(
      "id,external_adset_id,name,targeting,optimization_goal,billing_event,budget_cents,stage",
    )
    .eq("campaign_id", input.campaignId);
  if (error) return "failed:ad_sets_read_failed";
  const rows = (sets ?? []) as Record<string, unknown>[];
  if (rows.some((row) => row.stage === "retarget")) {
    return "skipped:retarget_exists";
  }
  const prospecting = rows.find((row) => row.stage === "prospecting") ??
    rows[0];
  if (!prospecting || rows.length !== 1) return "skipped:not_one_ad_set";
  const prospectingId = String(prospecting.external_adset_id ?? "");
  let before = Number(prospecting.budget_cents);
  if (!prospectingId || !Number.isSafeInteger(before) || before <= 0) {
    return "skipped:prospecting_budget_unknown";
  }
  const { data: adRows } = await db.from("ads")
    .select("external_ad_id,external_creative_id,creative_id,status")
    .eq("ad_set_id", prospecting.id);
  const live = ((adRows ?? []) as Record<string, unknown>[]).filter((ad) =>
    typeof ad.external_ad_id === "string" &&
    String(ad.status ?? "").toUpperCase() === "ACTIVE"
  );
  if (live.length === 0) return "skipped:no_live_ads";
  const targeting = hostRetargetTargeting(
    input.platform,
    (prospecting.targeting ?? {}) as Record<string, unknown>,
    input.include,
    input.exclude,
  );
  let newAdSetId = "";
  let lowered = false;
  try {
    // Restore to what the app really holds, not only Mingla's record.
    if (typeof adapter.getBudget === "function") {
      before =
        (await adapter.getBudget(connection, "ad_set", prospectingId)).cents;
    }
    const made = await adapter.createAdSet(
      connection,
      input.externalCampaignId,
      {
        name: `${String(prospecting.name ?? "Ad set")} — retarget`.slice(
          0,
          200,
        ),
        optimizationGoal: String(prospecting.optimization_goal ?? ""),
        billingEvent: String(prospecting.billing_event ?? ""),
        budgetCents: input.decision.retargetCents,
        targeting,
      },
    );
    newAdSetId = made.externalId;
    const newAds: Array<{ externalAdId: string; creativeId: string | null }> =
      [];
    for (const ad of live) {
      newAds.push({
        externalAdId: await deps.copyAdInto(newAdSetId, {
          externalAdId: String(ad.external_ad_id),
          externalCreativeId: typeof ad.external_creative_id === "string"
            ? ad.external_creative_id
            : null,
        }),
        creativeId: typeof ad.creative_id === "string" ? ad.creative_id : null,
      });
    }
    await adapter.setBudget(
      connection,
      "ad_set",
      prospectingId,
      input.decision.prospectingCents,
    );
    lowered = true;
    if (typeof adapter.getBudget === "function") {
      const readback = await adapter.getBudget(
        connection,
        "ad_set",
        prospectingId,
      );
      if (readback.cents !== input.decision.prospectingCents) {
        throw new Error(`provider_budget_readback_mismatch:${readback.cents}`);
      }
    }
    await adapter.setStatus(connection, "ad_set", newAdSetId, "ACTIVE");
    const { data: inserted, error: insertError } = await db.from("ad_sets")
      .insert({
        campaign_id: input.campaignId,
        external_adset_id: newAdSetId,
        name: `${String(prospecting.name ?? "Ad set")} — retarget`.slice(
          0,
          200,
        ),
        targeting,
        budget_cents: input.decision.retargetCents,
        optimization_goal: prospecting.optimization_goal,
        billing_event: prospecting.billing_event,
        status: "ACTIVE",
        stage: "retarget",
        audience_codes: input.audienceCodes,
        audience_sizes: input.audienceSizes,
      }).select("id").single();
    if (insertError || !inserted?.id) {
      throw new Error("retarget_ad_set_persist_failed");
    }
    await db.from("ads").insert(newAds.map((ad, index) => ({
      ad_set_id: inserted.id,
      external_ad_id: ad.externalAdId,
      ...(ad.creativeId ? { creative_id: ad.creativeId } : {}),
      name: `Retarget — ${index + 1}`,
      status: "ACTIVE",
    })));
    await db.from("ad_sets").update({
      budget_cents: input.decision.prospectingCents,
    })
      .eq("id", prospecting.id);
    await db.from("ad_plan_automation_events").insert({
      plan_id: input.planId,
      campaign_id: input.campaignId,
      platform: input.platform,
      kind: "retarget_added",
      status: "applied",
      detail: {
        live_add: true,
        prospecting_cents: input.decision.prospectingCents,
        retarget_cents: input.decision.retargetCents,
        external_adset_id: newAdSetId,
      },
    });
    return `added:${newAds.length}`;
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error))
      .slice(0, 200);
    // Never leave the apps above the daily total or on an unrecorded split.
    if (newAdSetId) {
      try {
        await adapter.setStatus(connection, "ad_set", newAdSetId, "PAUSED");
      } catch { /* reported below */ }
    }
    if (lowered) {
      try {
        await adapter.setBudget(connection, "ad_set", prospectingId, before);
      } catch { /* reported below */ }
    }
    await db.from("ad_plan_automation_events").insert({
      plan_id: input.planId,
      campaign_id: input.campaignId,
      platform: input.platform,
      // The kind list has no separate failure kind (no migration in W4c):
      // a failed live add is a retarget_added row with status failed.
      kind: "retarget_added",
      status: "failed",
      detail: {
        live_add: true,
        error: detail,
        external_adset_id: newAdSetId || null,
      },
    });
    return `failed:${detail}`;
  }
}
