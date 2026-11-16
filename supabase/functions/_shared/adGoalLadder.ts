/**
 * #4238 item 4 — the goal ladder (started checkout first, then Purchase).
 *
 * A Host "Sell tickets" ad whose budget can't reach enough purchases a week
 * for the app to learn starts on started checkouts, then switches itself to
 * Purchase once the ad has enough purchases. Server-owned and automatic: the
 * Host only ever sees "Sell tickets", and the ladder stage never appears in a
 * Host payload.
 *
 * @invariant I-4238-ONE-GOAL-SWITCH
 *   owner: this module (decideGoalPromotion) + the partial unique index
 *          ad_plan_automation_events_once (20280715004238)
 *   rule: at most one switch per plan and app, never in the first 3 days,
 *         never with fewer than 5 days left; every switch is recorded.
 *         Declared beside its tests (_shared/__tests__/
 *         issue_4238_goal_ladder.test.ts and the W2 pg17 test).
 *
 * Platforms (Step 0, Z-1): Meta only. TikTok's web "initiate checkout"
 * optimisation event name could not be confirmed from TikTok's official docs
 * (W1 Z-1), so TikTok runs Purchase from the start (the spec's fallback).
 * Snap, Google and Reddit get no checkout signal from Mingla: Purchase from
 * the start.
 *
 * Pure: the sweep (admin-ad-spend-sync) reads the facts and makes the
 * provider calls through _shared/adGoalPromotion.ts.
 */

import type { Platform } from "./adChannelCore.ts";

/** Apps that can start on started checkouts (Z-1: TikTok unconfirmed). */
export const HOST_LADDER_PLATFORMS: ReadonlySet<Platform> = new Set<Platform>([
  "meta",
]);

/** Purchases a week below which an ad starts on started checkouts. */
export const LADDER_PURCHASES_PER_WEEK = 25;
/** The 7-day purchases that promote an ad to Purchase. */
export const LADDER_PROMOTE_PURCHASES_7D = 25;
/** Never switch in the first 3 days of the run. */
export const LADDER_MIN_DAYS_LIVE = 3;
/** Never switch with fewer than 5 days of the run left. */
export const LADDER_MIN_DAYS_LEFT = 5;
/** A failed switch is retried at most once a day. */
export const LADDER_RETRY_MS = 86_400_000;

const DAY_MS = 86_400_000;

export type LadderStage = "checkout_first" | "purchase";

/**
 * Frozen at create_version: the stage each sales app starts on. Only ladder
 * apps on the sales goal get an entry; `expectedPurchasesWeekMid` is the
 * guidance's mid estimate at the plan's daily amount.
 */
export function hostSalesLadderStart(input: {
  platforms: readonly Platform[];
  optimizationByPlatform: Readonly<Record<string, string>>;
  expectedPurchasesWeekMid: Readonly<Record<string, number | null>>;
}): Record<string, LadderStage> {
  const out: Record<string, LadderStage> = {};
  for (const platform of input.platforms) {
    if (input.optimizationByPlatform[platform] !== "sales") continue;
    if (!HOST_LADDER_PLATFORMS.has(platform)) continue;
    const mid = input.expectedPurchasesWeekMid[platform];
    out[platform] = typeof mid === "number" && Number.isFinite(mid) &&
        mid >= LADDER_PURCHASES_PER_WEEK
      ? "purchase"
      : "checkout_first";
  }
  return out;
}

/** The frozen stage of one app (absent = Purchase, the pre-ladder default). */
export function ladderStageFor(
  canonicalPlan: Record<string, unknown>,
  platform: string,
): LadderStage {
  const map = canonicalPlan.sales_ladder_by_platform;
  if (!map || typeof map !== "object" || Array.isArray(map)) return "purchase";
  return (map as Record<string, unknown>)[platform] === "checkout_first" &&
      HOST_LADDER_PLATFORMS.has(platform as Platform)
    ? "checkout_first"
    : "purchase";
}

export type PromotionFacts = {
  platform: Platform;
  stage: LadderStage;
  /** Purchases over the last 7 days (platform-reported, else Mingla's). */
  purchases7d: number;
  /** When the ad first went live (ms); null = not live yet. */
  liveSinceMs: number | null;
  /** The run's end (ms); null = open-ended. */
  endsAtMs: number | null;
  nowMs: number;
  /** A goal_promoted row exists (applied, or pending). */
  existing: { status: "pending" | "applied" | "failed"; atMs: number } | null;
};

export type PromotionDecision =
  | { promote: true }
  | {
    promote: false;
    reason:
      | "not_a_ladder_app"
      | "already_purchase"
      | "already_switched"
      | "retry_tomorrow"
      | "not_live"
      | "too_early"
      | "too_late"
      | "not_enough_purchases";
  };

/** Pure: should the sweep switch this app from checkout to Purchase now? */
export function decideGoalPromotion(facts: PromotionFacts): PromotionDecision {
  if (!HOST_LADDER_PLATFORMS.has(facts.platform)) {
    return { promote: false, reason: "not_a_ladder_app" };
  }
  if (facts.stage !== "checkout_first") {
    return { promote: false, reason: "already_purchase" };
  }
  if (facts.existing) {
    if (facts.existing.status !== "failed") {
      return { promote: false, reason: "already_switched" };
    }
    if (facts.nowMs - facts.existing.atMs < LADDER_RETRY_MS) {
      return { promote: false, reason: "retry_tomorrow" };
    }
  }
  if (facts.liveSinceMs === null) return { promote: false, reason: "not_live" };
  if (facts.nowMs - facts.liveSinceMs < LADDER_MIN_DAYS_LIVE * DAY_MS) {
    return { promote: false, reason: "too_early" };
  }
  if (
    facts.endsAtMs !== null &&
    facts.endsAtMs - facts.nowMs < LADDER_MIN_DAYS_LEFT * DAY_MS
  ) {
    return { promote: false, reason: "too_late" };
  }
  if (
    !Number.isFinite(facts.purchases7d) ||
    facts.purchases7d < LADDER_PROMOTE_PURCHASES_7D
  ) {
    return { promote: false, reason: "not_enough_purchases" };
  }
  return { promote: true };
}

/** Meta's promoted-object event for a sales app at its ladder stage. */
export function ladderMetaCustomEventType(
  stage: LadderStage,
): "INITIATE_CHECKOUT" | "PURCHASE" {
  return stage === "checkout_first" ? "INITIATE_CHECKOUT" : "PURCHASE";
}
