/**
 * #4238 media-buyer, wave D — a Host changes a live ad's budget and/or end
 * date, once a day.
 *
 * Guards I-4238-LIVE-EDIT-ONCE-A-DAY (declared in its enforcing test under _shared/__tests__/).
 *
 * Guards I-4238-LIVE-EDIT-CAPS-WITHIN-TOTAL (declared in its enforcing test under _shared/__tests__/).
 *
 * Guards I-4238-LIVE-EDIT-CLAIM-BEFORE-PUSH (declared in its enforcing test under _shared/__tests__/).
 *
 * Order: claim the edit under the plan lock (caller, host-ad-campaign) →
 * plan (pure) → push each changed daily budget (Meta, Snapchat, TikTok — the
 * apps Mingla can push to) and Meta's ad set end time → record the change,
 * the credit move and the amendments in one SQL call. A failure after a push
 * reverts the pushes already made; an undo that fails is named and reported.
 *
 * Provider amounts use the plan's own frozen ratios (fee and exchange rate
 * included), so the new caps line up with what the Host paid.
 */

import type {
  AdConnectionRow,
  ChannelAdapter,
  Platform,
} from "./adChannelCore.ts";
import { proportionalSplit } from "./adBudgetChange.ts";
import { hostLiveAdSetBudgets } from "./adHostPlanRules.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const HOST_LIVE_EDIT_STATES = new Set([
  "platform_review",
  "scheduled",
  "live",
  "pause_requested",
  "paused",
  "partially_ready",
  "partially_live",
]);

/** #4238 W4a (5a): apps whose LIFETIME budget Mingla pushes on a live edit. */
export const HOST_LIVE_LIFETIME_PUSH: ReadonlySet<Platform> = new Set(["meta"]);

/** Apps whose daily budget Mingla can push today. */
export const HOST_LIVE_DAILY_PUSH: ReadonlySet<Platform> = new Set([
  "meta",
  "snapchat",
  "tiktok",
]);

export type HostLiveCampaign = {
  id: string;
  platform: Platform;
  host_budget_cents: number;
  host_delivery_budget_cents: number;
  provider_budget_cents: number;
  provider_delivery_budget_cents: number;
  current_cap_cents: number;
  current_daily_cents: number;
  provider_spend_cents: number;
  /**
   * The app's daily minimum in the provider account's money
   * (providerDailyMinimumCents); null or absent = no known minimum.
   */
  provider_daily_minimum_cents?: number | null;
  /**
   * #4238 5a: the campaign runs on a lifetime (total) budget. Its daily
   * amount is never pushed (the app has none); the new total is enforced by
   * Mingla's spend sync at the new cap.
   * W4a: on Meta the new provider cap is pushed as the campaign's
   * lifetime_budget (HOST_LIVE_LIFETIME_PUSH), never above the new total.
   */
  lifetime?: boolean;
};

export type HostLivePlanLine = {
  campaign_id: string;
  platform: Platform;
  new_provider_budget_cents: number;
  new_provider_delivery_budget_cents: number;
  daily_changed: boolean;
  /** #4238 W4a: the one-ad-set floor F in provider money (null = unknown). */
  floor_cents?: number | null;
  /**
   * #4238 W4a (5a): a lifetime campaign whose provider total moves to the
   * new cap (Meta). The cap is the new total in provider money, so the app
   * can never spend more than the Host's new total.
   */
  lifetime_changed?: boolean;
};

export type HostLivePlan =
  | {
    ok: true;
    newHostBudgetCents: number;
    newEndsAt: string | null;
    lines: HostLivePlanLine[];
    /** Apps that keep their daily amount (Mingla can't push it there). */
    dailyNotPushed: Platform[];
  }
  | {
    ok: false;
    error: string;
    detail?: string;
    /** host_ad_live_edit_learning_reset: what the Host is asked to confirm. */
    learning?: { change_pct: number | null; days_live: number; learning_until: string };
  };

/**
 * #4238 amendment B item 7 (B-F4): the only keys a live edit may carry. A
 * live ad changes budget and end date only; area, audience, age, goal, apps,
 * ads, copy and video never change live (a wider area or new video is a new
 * ad). Any other key is refused by name, never silently dropped.
 *
 * MINGLA-INVARIANT: I-4238-LIVE-EDIT-ALLOWLIST | issue #4238 | host-ad-campaign change_live refuses every body key outside HOST_LIVE_EDIT_FIELDS with 400 host_ad_live_edit_field_not_editable:<key> before any claim or push.
 */
export const HOST_LIVE_EDIT_FIELDS: ReadonlySet<string> = new Set([
  "action",
  "brand_id",
  "plan_id",
  "new_budget_cents",
  "new_ends_at",
  "idempotency_key",
  "suggestion_id",
  // #4238 6a: the Host's explicit learning-reset confirmation.
  "acknowledge_learning_reset",
]);

/** The first body key a live edit may not carry, or null. */
export function hostLiveEditUnknownField(
  body: Record<string, unknown>,
): string | null {
  for (const key of Object.keys(body)) {
    if (!HOST_LIVE_EDIT_FIELDS.has(key)) return key;
  }
  return null;
}

/** #4238 6a: the learning window and the budget change it tolerates. */
export const HOST_LEARNING_WINDOW_DAYS = 7;
export const HOST_LEARNING_MAX_CHANGE = 0.2;

const positive = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

function wholeDaysLeft(nowMs: number, endMs: number): number {
  return Math.max(1, Math.ceil((endMs - nowMs) / 86_400_000));
}

/**
 * Pure. `hostSpendCents` is the spend so far in the brand's money. The new
 * daily total spreads what is left of the budget over the days left.
 */
export function planHostLiveEdit(input: {
  planState: string;
  lastEditAt: string | null;
  nowMs: number;
  newHostBudgetCents: unknown;
  newEndsAt: unknown;
  currentHostBudgetCents: number;
  currentEndsAt: string | null;
  lastBookableAt: string | null;
  hostSpendCents: number;
  campaigns: HostLiveCampaign[];
  /**
   * #4238 6a: when the ad first went live (ms); null = not live yet. Inside
   * the first 7 days a budget change over 20% or any end-date change resets
   * the apps' learning, so it needs `acknowledgeLearningReset: true`.
   */
  liveSinceMs?: number | null;
  acknowledgeLearningReset?: boolean;
}): HostLivePlan {
  if (!HOST_LIVE_EDIT_STATES.has(input.planState)) {
    return { ok: false, error: "host_ad_live_edit_state_invalid" };
  }
  if (
    input.lastEditAt &&
    input.nowMs - Date.parse(input.lastEditAt) < 86_400_000
  ) {
    return { ok: false, error: "host_ad_live_edit_once_a_day" };
  }
  const budget = input.newHostBudgetCents === undefined ||
      input.newHostBudgetCents === null
    ? null
    : positive(input.newHostBudgetCents);
  if (input.newHostBudgetCents != null && budget === null) {
    return { ok: false, error: "host_ad_live_edit_amount_invalid" };
  }
  let endsAt: string | null = null;
  if (input.newEndsAt != null) {
    const ms = typeof input.newEndsAt === "string"
      ? Date.parse(input.newEndsAt)
      : NaN;
    if (!Number.isFinite(ms)) {
      return { ok: false, error: "host_ad_live_edit_end_invalid" };
    }
    if (ms <= input.nowMs) {
      return { ok: false, error: "host_ad_live_edit_end_in_past" };
    }
    const limit = input.lastBookableAt ? Date.parse(input.lastBookableAt) : NaN;
    if (Number.isFinite(limit) && ms > limit) {
      return { ok: false, error: "host_ad_live_edit_end_after_last_bookable" };
    }
    endsAt = new Date(ms).toISOString();
  }
  if (budget === null && endsAt === null) {
    return { ok: false, error: "host_ad_live_edit_empty" };
  }
  // #4238 6a (I-4238-LEARNING-CONFIRM): server-side, never only a client
  // warning. Exactly 20% passes; more needs the explicit acknowledgement.
  const liveSince = input.liveSinceMs ?? null;
  if (
    liveSince !== null && Number.isFinite(liveSince) &&
    input.nowMs - liveSince < HOST_LEARNING_WINDOW_DAYS * 86_400_000 &&
    input.acknowledgeLearningReset !== true
  ) {
    const current = input.currentHostBudgetCents;
    const changePct = budget !== null && current > 0
      ? Math.abs(budget - current) / current
      : null;
    const endChanged = endsAt !== null &&
      Date.parse(endsAt) !== Date.parse(input.currentEndsAt ?? "");
    if ((changePct !== null && changePct > HOST_LEARNING_MAX_CHANGE) || endChanged) {
      return {
        ok: false,
        error: "host_ad_live_edit_learning_reset",
        learning: {
          change_pct: changePct === null ? null : Math.round(changePct * 1000) / 10,
          days_live: Math.floor((input.nowMs - liveSince) / 86_400_000) + 1,
          learning_until: new Date(
            liveSince + HOST_LEARNING_WINDOW_DAYS * 86_400_000,
          ).toISOString(),
        },
      };
    }
  }
  const newBudget = budget ?? input.currentHostBudgetCents;
  // #4238 r8 P1-1: a total at or under the spend so far leaves nothing to
  // run on (and no cap that fits), so it is refused in plain words.
  if (newBudget <= input.hostSpendCents) {
    return { ok: false, error: "host_ad_live_edit_below_spend" };
  }
  if (input.campaigns.length === 0) {
    return { ok: false, error: "plan_campaigns_missing" };
  }
  const endMs = Date.parse(endsAt ?? input.currentEndsAt ?? "");
  // #4238 r8 P1-1 — caps: each app keeps what it has spent, plus its share
  // (by the plan's own split) of what is left of the new total. Shares are
  // worked out in the brand's money and converted at the frozen host→app
  // ratio (fee and exchange rate included), so the caps never add up to more
  // than the new total. host_ad_amend_live refuses caps that would.
  const remaining = Math.max(0, newBudget - input.hostSpendCents);
  const hostShares = proportionalSplit(
    remaining,
    input.campaigns.map((row) => row.host_budget_cents),
  );
  // Daily: what is left, over the days left (unchanged when no end date).
  const dailyTotal = Number.isFinite(endMs)
    ? Math.max(1, Math.floor(Math.max(1, remaining) / wholeDaysLeft(input.nowMs, endMs)))
    : null;
  const hostDailies = dailyTotal === null ? null : proportionalSplit(
    dailyTotal,
    input.campaigns.map((row) => row.host_delivery_budget_cents),
  );
  const dailyNotPushed: Platform[] = [];
  const lines: HostLivePlanLine[] = [];
  for (const [index, row] of input.campaigns.entries()) {
    const capRatio = row.provider_budget_cents / row.host_budget_cents;
    const dailyRatio = row.provider_delivery_budget_cents /
      row.host_delivery_budget_cents;
    // A converted share loses one provider cent so the frozen-rate rounding
    // in SQL can never push the total over by a fraction.
    const share = Math.floor(hostShares[index] * capRatio);
    const newCap = row.provider_spend_cents +
      (capRatio === 1 ? share : Math.max(0, share - 1));
    // An app with nothing spent and a share under one cent has no cap that
    // fits inside the total: too little is left to keep it running.
    if (newCap < 1) return { ok: false, error: "host_ad_live_edit_below_spend" };
    const canPush = HOST_LIVE_DAILY_PUSH.has(row.platform) && row.lifetime !== true;
    let newDaily = hostDailies === null
      ? row.current_daily_cents
      : Math.max(1, Math.floor(hostDailies[index] * dailyRatio));
    if (!canPush && newDaily !== row.current_daily_cents) {
      newDaily = row.current_daily_cents;
      if (!dailyNotPushed.includes(row.platform)) dailyNotPushed.push(row.platform);
    }
    newDaily = Math.max(1, Math.min(newDaily, newCap));
    // #4238 r9 P1-A: only an app Mingla can push to has a "changed" daily
    // amount. For Google and Reddit the recorded daily is still clamped to the
    // new cap (the record's daily-not-above-cap rule), but nothing is pushed:
    // they keep their own daily amount and Mingla's spend sync stops them at
    // the cap.
    if (!canPush && newDaily !== row.current_daily_cents &&
      !dailyNotPushed.includes(row.platform)) {
      dailyNotPushed.push(row.platform);
    }
    const dailyChanged = canPush && newDaily !== row.current_daily_cents;
    // #4238 r8 P2-2: a pushed daily amount never goes under the app's own
    // minimum (the apps refuse it). Named with the minimum in the brand's money.
    const minimum = row.provider_daily_minimum_cents ?? null;
    if (
      canPush && dailyChanged && minimum !== null && minimum > 0 &&
      newDaily < minimum
    ) {
      return {
        ok: false,
        error: "host_ad_live_edit_below_app_minimum",
        detail: `${row.platform}:${Math.ceil(minimum / dailyRatio)}`,
      };
    }
    lines.push({
      campaign_id: row.id,
      platform: row.platform,
      new_provider_budget_cents: newCap,
      new_provider_delivery_budget_cents: newDaily,
      daily_changed: dailyChanged,
      floor_cents: minimum,
      lifetime_changed: row.lifetime === true &&
        HOST_LIVE_LIFETIME_PUSH.has(row.platform) &&
        newCap !== row.current_cap_cents,
    });
  }
  return {
    ok: true,
    newHostBudgetCents: newBudget,
    newEndsAt: endsAt,
    lines,
    dailyNotPushed,
  };
}

type Target = {
  level: "campaign" | "ad_set";
  externalId: string;
  previousCents: number;
  nextCents: number;
  /** #4238 W4a: pause or resume the retarget ad set with this edit. */
  status?: "pause" | "resume" | null;
  /** The local ad_sets row (ad-set targets only). */
  localId?: string;
  stage?: "prospecting" | "retarget" | null;
};

/**
 * #4238 W4a T-2: a Meta campaign with ad-set budgets (ABO — the Host
 * retarget structure) has no campaign daily budget, so its budget is pushed
 * at ad-set level like Snapchat and TikTok. A Host campaign with a retarget
 * ad set takes hostLiveAdSetBudgets: the retarget ad set runs only at 2F or
 * more, every running ad set stays at or above F, and below 2F it is paused
 * with its budget moved to prospecting.
 */
export async function dailyTargets(
  db: Db,
  campaign: Record<string, unknown>,
  line: HostLivePlanLine,
  previousDaily: number,
): Promise<Target[]> {
  const campaignTarget = (): Target[] => {
    const externalId = String(campaign.external_campaign_id ?? "");
    if (!externalId) throw new Error("campaign_budget_target_missing");
    return [{
      level: "campaign",
      externalId,
      previousCents: previousDaily,
      nextCents: line.new_provider_delivery_budget_cents,
    }];
  };
  if (
    line.platform === "meta" && campaign.daily_budget_cents !== null &&
    campaign.daily_budget_cents !== undefined
  ) return campaignTarget();
  const { data: adSets, error } = await db.from("ad_sets")
    .select("id,external_adset_id,budget_cents,stage,status")
    .eq("campaign_id", campaign.id)
    .order("id");
  if (line.platform === "meta") {
    // Meta is ABO only when its ad sets carry the budgets; otherwise the
    // budget is on the campaign (CBO), as before.
    const abo = !error && Array.isArray(adSets) &&
      adSets.some((row: Record<string, unknown>) => Number(row.budget_cents) > 0);
    if (!abo) return campaignTarget();
  }
  if (error || !Array.isArray(adSets) || adSets.length === 0) {
    throw new Error("ad_set_budget_target_missing");
  }
  const rows = adSets as Record<string, unknown>[];
  const retarget = rows.find((row) => row.stage === "retarget");
  const prospecting = rows.find((row) => row.stage === "prospecting");
  if (campaign.owner_kind === "host" && retarget && prospecting) {
    // Paused by an earlier edit = the latest retarget event is a removal.
    const { data: lastMove } = await db.from("ad_plan_automation_events")
      .select("kind,created_at").eq("campaign_id", campaign.id)
      .in("kind", ["retarget_added", "retarget_removed"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const paused = lastMove?.kind === "retarget_removed";
    const before = (row: Record<string, unknown>) => {
      const cents = Number(row.budget_cents);
      return Number.isSafeInteger(cents) && cents > 0 ? cents : 0;
    };
    const next = hostLiveAdSetBudgets({
      platform: line.platform,
      dailySpendCents: line.new_provider_delivery_budget_cents,
      floorCents: line.floor_cents ?? null,
      adSets: [
        { id: String(prospecting.id), stage: "prospecting", paused: false },
        { id: String(retarget.id), stage: "retarget", paused },
      ],
    });
    return next.map((item) => {
      const row = item.stage === "retarget" ? retarget : prospecting;
      return {
        level: "ad_set" as const,
        externalId: String(row.external_adset_id ?? ""),
        previousCents: before(row),
        // A paused retarget ad set keeps its last budget (never pushed 0).
        nextCents: item.cents > 0 ? item.cents : before(row),
        status: item.status,
        localId: String(row.id),
        stage: item.stage,
      };
    });
  }
  const weights = rows.map((row) => {
    const cents = Number(row.budget_cents);
    return Number.isSafeInteger(cents) && cents > 0 ? cents : 1;
  });
  const before = proportionalSplit(previousDaily, weights);
  const after = proportionalSplit(line.new_provider_delivery_budget_cents, weights);
  return rows.map((row, index: number) => ({
    level: "ad_set" as const,
    externalId: String(row.external_adset_id ?? ""),
    previousCents: before[index],
    nextCents: after[index],
    localId: String(row.id),
    stage: null,
  }));
}

export type HostLiveEditResult = { status: number; body: Record<string, unknown> };

/** An app whose budget may not match Mingla's record (staff must check). */
export type HostLiveEditProblem = {
  /**
   * undo_failed: an undo after a failure did not work. not_reverted: another
   * edit was recorded first, so this push was kept. lapsed_claim: an earlier
   * request claimed the edit and never finished (it may have pushed).
   * unconfirmed: the record's answer was lost and the saved edit could not
   * be read back, so nothing was undone.
   */
  kind: "undo_failed" | "not_reverted" | "lapsed_claim" | "unconfirmed";
  platforms: Platform[];
  detail: string;
};

/**
 * Runs a planned edit: push, then record (reverting pushes on failure).
 *
 * The caller has already claimed the edit under the plan lock
 * (host_ad_live_edit_claim), so a second tap or device never reaches the
 * pushes. A once-a-day or in-progress refusal at record time therefore means
 * another edit won: the pushes are NOT undone (undoing would put the app back
 * on the pre-edit amount while Mingla's record holds the winner's), and staff
 * are told. An undo that fails is never reported as undone.
 */
export async function runHostLiveEdit(
  deps: {
    db: Db;
    getAdapter: (platform: Platform) => ChannelAdapter;
    /** Records the problem and alerts staff (ops alert path). Never throws. */
    onProblem?: (problem: HostLiveEditProblem) => Promise<void>;
  },
  input: {
    plan: HostLivePlan & { ok: true };
    /** #4238 W4a: retarget moves are recorded on the plan. */
    planId?: string;
    versionId: string;
    planHash: string;
    campaigns: Record<string, unknown>[];
    actorId: string;
    idempotencyKey: string;
    previousEndsAt: string | null;
  },
): Promise<HostLiveEditResult> {
  const { db, getAdapter } = deps;
  const pushed: Array<{ platform: Platform; connection: AdConnectionRow; undo: () => Promise<void> }> = [];
  const evidence: Record<string, Record<string, unknown>> = {};
  const retargetMoves: Array<{
    campaign: Record<string, unknown>;
    line: HostLivePlanLine;
    kind: "retarget_added" | "retarget_removed";
    target: Target;
  }> = [];
  const adSetBudgets: Target[] = [];
  const report = async (problem: HostLiveEditProblem) => {
    if (!deps.onProblem) return;
    try {
      await deps.onProblem(problem);
    } catch (error) {
      console.error("[host-live-edit] problem report failed", {
        kind: problem.kind,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
  /** Undoes every push, newest first. Returns the apps whose undo failed. */
  const revert = async (): Promise<{ undone: Platform[]; failed: Platform[] }> => {
    const undone: Platform[] = [];
    const failed: Platform[] = [];
    const details: string[] = [];
    for (const item of [...pushed].reverse()) {
      try {
        await item.undo();
        if (!undone.includes(item.platform)) undone.push(item.platform);
      } catch (error) {
        if (!failed.includes(item.platform)) failed.push(item.platform);
        details.push(`${item.platform}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    pushed.length = 0;
    if (failed.length > 0) {
      await report({
        kind: "undo_failed",
        platforms: failed,
        detail: details.join("; ").slice(0, 500),
      });
    }
    return { undone: undone.filter((platform) => !failed.includes(platform)), failed };
  };
  const failure = async (
    status: number,
    error: string,
    extra: Record<string, unknown> = {},
  ): Promise<HostLiveEditResult> => {
    const { undone, failed } = await revert();
    if (failed.length > 0) {
      return {
        status: 502,
        body: {
          error: "host_ad_live_edit_undo_failed",
          detail: failed.join(","),
          cause: error,
          reverted: undone,
          revert_failed: failed,
        },
      };
    }
    return { status, body: { error, ...extra, reverted: undone } };
  };
  // #4238 r9 P3: anything that throws after a push (a lost connection, a
  // bad row) still reverts, names a failed undo and tells staff; it never
  // escapes with an app on an amount Mingla did not record.
  try {
    for (const line of input.plan.lines) {
      const campaign = input.campaigns.find((row) => row.id === line.campaign_id) ?? {};
      const previousDaily = Number(
        campaign.amended_provider_delivery_budget_cents ??
          campaign.provider_delivery_budget_cents,
      );
      const needsEnd = line.platform === "meta" && input.plan.newEndsAt !== null;
      if (!line.daily_changed && !needsEnd && line.lifetime_changed !== true) continue;
      const { data: connection } = await db.from("ad_connections").select("*")
        .eq("id", campaign.connection_id).maybeSingle();
      if (!connection?.connected || connection.status !== "connected") {
        return await failure(424, `${line.platform}_not_connected`);
      }
      const adapter = getAdapter(line.platform);
      try {
        if (line.daily_changed) {
          if (typeof adapter.getBudget !== "function") {
            throw new Error("provider_budget_readback_unavailable");
          }
          const confirmed = [];
          const targets = await dailyTargets(db, campaign, line, previousDaily);
          // #4238 W4a: pause the retarget ad set BEFORE prospecting takes its
          // budget, and resume it only AFTER prospecting gave it back, so the
          // apps never run above the new daily total in between.
          const ordered = [
            ...targets.filter((target) => target.status === "pause"),
            ...targets.filter((target) => target.status !== "pause" && target.status !== "resume"),
            ...targets.filter((target) => target.status === "resume"),
          ];
          for (const target of ordered) {
            if (target.status === "pause") {
              await adapter.setStatus(connection, target.level, target.externalId, "PAUSED");
              pushed.push({
                platform: line.platform,
                connection,
                undo: () => adapter.setStatus(connection, target.level, target.externalId, "ACTIVE"),
              });
              retargetMoves.push({ campaign, line, kind: "retarget_removed", target });
              continue;
            }
            if (target.nextCents !== target.previousCents) {
              await adapter.setBudget(connection, target.level, target.externalId, target.nextCents);
              pushed.push({
                platform: line.platform,
                connection,
                undo: () => adapter.setBudget(connection, target.level, target.externalId, target.previousCents),
              });
              const readback = await adapter.getBudget(connection, target.level, target.externalId);
              if (readback.cents !== target.nextCents) {
                throw new Error(`provider_budget_readback_mismatch:${target.nextCents}:${readback.cents}`);
              }
              confirmed.push({ level: target.level, external_id: target.externalId, daily_budget_cents: readback.cents });
            }
            if (target.status === "resume") {
              await adapter.setStatus(connection, target.level, target.externalId, "ACTIVE");
              pushed.push({
                platform: line.platform,
                connection,
                undo: () => adapter.setStatus(connection, target.level, target.externalId, "PAUSED"),
              });
              retargetMoves.push({ campaign, line, kind: "retarget_added", target });
            }
            if (target.localId && target.level === "ad_set") adSetBudgets.push(target);
          }
          evidence[line.campaign_id] = { confirmed, pushed_at: new Date().toISOString() };
        }
        if (line.lifetime_changed === true) {
          if (
            typeof adapter.setLifetimeBudget !== "function" ||
            typeof adapter.getLifetimeBudget !== "function"
          ) {
            throw new Error("provider_lifetime_budget_unavailable");
          }
          const externalId = String(campaign.external_campaign_id ?? "");
          if (!externalId) throw new Error("campaign_budget_target_missing");
          const previousCap = Number(
            campaign.amended_provider_budget_cents ?? campaign.provider_budget_cents,
          );
          await adapter.setLifetimeBudget(connection, "campaign", externalId, line.new_provider_budget_cents);
          pushed.push({
            platform: line.platform,
            connection,
            undo: () => adapter.setLifetimeBudget!(connection, "campaign", externalId, previousCap),
          });
          const readback = await adapter.getLifetimeBudget(connection, "campaign", externalId);
          if (readback.cents !== line.new_provider_budget_cents) {
            throw new Error(`provider_budget_readback_mismatch:${line.new_provider_budget_cents}:${readback.cents}`);
          }
          evidence[line.campaign_id] = {
            ...(evidence[line.campaign_id] ?? {}),
            lifetime_budget_cents: readback.cents,
            pushed_at: new Date().toISOString(),
          };
        }
        if (needsEnd && typeof adapter.setEndTime === "function") {
          const { data: adSets } = await db.from("ad_sets")
            .select("external_adset_id").eq("campaign_id", campaign.id);
          for (const row of (adSets ?? []) as Record<string, unknown>[]) {
            const externalId = String(row.external_adset_id ?? "");
            if (!externalId) continue;
            await adapter.setEndTime(connection, "ad_set", externalId, input.plan.newEndsAt as string);
            const previous = input.previousEndsAt;
            if (previous) {
              pushed.push({
                platform: line.platform,
                connection,
                undo: () => adapter.setEndTime!(connection, "ad_set", externalId, previous),
              });
            }
          }
          evidence[line.campaign_id] = {
            ...(evidence[line.campaign_id] ?? {}),
            end_time: input.plan.newEndsAt,
          };
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return await failure(502, `${line.platform}_budget_update_failed`, {
          detail: detail.slice(0, 300),
        });
      }
    }
    const budgetChanged = input.plan.lines.some((line) => {
      const campaign = input.campaigns.find((row) => row.id === line.campaign_id) ?? {};
      const cap = Number(campaign.amended_provider_budget_cents ?? campaign.provider_budget_cents);
      return line.daily_changed || cap !== line.new_provider_budget_cents;
    });
    const { data, error } = await db.rpc("host_ad_amend_live", {
      p_plan_version_id: input.versionId,
      p_plan_hash: input.planHash,
      p_new_host_budget_cents: input.plan.newHostBudgetCents,
      p_new_ends_at: input.plan.newEndsAt,
      p_changes: budgetChanged
        ? input.plan.lines.map((line) => ({
          campaign_id: line.campaign_id,
          new_provider_budget_cents: line.new_provider_budget_cents,
          new_provider_delivery_budget_cents: line.new_provider_delivery_budget_cents,
        }))
        : [],
      p_actor_id: input.actorId,
      p_idempotency_key: input.idempotencyKey,
      p_provider_evidence: evidence,
    });
    if (error) {
      const message = String(error.message ?? "");
      // Another edit was recorded (or is being recorded) first. Never undo:
      // that would put the app back on the pre-edit amount.
      const lost = [
        "host_ad_live_edit_once_a_day",
        "host_ad_live_edit_in_progress",
      ].find((code) => message.includes(code));
      if (lost) {
        const platforms = [...new Set(pushed.map((item) => item.platform))];
        if (platforms.length > 0) {
          await report({
            kind: "not_reverted",
            platforms,
            detail: `${lost}: pushed but not recorded`,
          });
        }
        return { status: 409, body: { error: lost } };
      }
      const known = [
        "host_ad_live_edit_end_after_last_bookable",
        "host_ad_live_edit_below_spend",
        "host_ad_live_edit_end_in_past",
        "host_ad_live_edit_caps_exceed_budget",
        "ad_credit_insufficient",
      ].find((code) => message.includes(code));
      if (known) return await failure(error.code === "PT409" ? 409 : 422, known);
      // #4238 r10 P2-A: an unknown error may come AFTER the edit committed
      // (the answer was lost). Check before undoing anything.
      return await recoverOrRevert(409, `record error: ${message.slice(0, 200)}`);
    }
    await recordAdSetMoves();
    return succeeded(data);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[host-live-edit] interrupted", { detail: detail.slice(0, 300) });
    return await recoverOrRevert(502, `interrupted: ${detail.slice(0, 200)}`);
  }

  /**
   * #4238 W4a: after the edit is recorded, keep Mingla's ad-set budgets in
   * step (the next edit splits from them) and record each retarget move
   * (retarget_added / retarget_removed). Best effort: the app already
   * matches the recorded edit; a failure here is logged, never undone.
   */
  async function recordAdSetMoves(): Promise<void> {
    try {
      for (const target of adSetBudgets) {
        await db.from("ad_sets").update({ budget_cents: target.nextCents })
          .eq("id", target.localId);
      }
      if (retargetMoves.length > 0 && input.planId) {
        const { error } = await db.from("ad_plan_automation_events").insert(
          retargetMoves.map((move) => ({
            plan_id: input.planId,
            campaign_id: move.campaign.id,
            platform: move.line.platform,
            kind: move.kind,
            status: "applied",
            applied_at: new Date().toISOString(),
            detail: {
              idempotency_key: input.idempotencyKey,
              external_adset_id: move.target.externalId,
              daily_spend_cents: move.line.new_provider_delivery_budget_cents,
              floor_cents: move.line.floor_cents ?? null,
            },
          })),
        );
        if (error) throw new Error(String(error.message ?? "insert"));
      }
    } catch (error) {
      console.error("[host-live-edit] ad-set moves not recorded", {
        detail: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      });
    }
  }

  function succeeded(edit: unknown, extra: Record<string, unknown> = {}): HostLiveEditResult {
    return {
      status: 200,
      body: {
        ok: true,
        edit,
        ...extra,
        daily_not_pushed: input.plan.dailyNotPushed,
        end_not_pushed: input.plan.newEndsAt === null
          ? []
          : [...new Set(input.plan.lines.map((line) => line.platform))]
            .filter((platform) => platform !== "meta"),
      },
    };
  }

  /**
   * #4238 r10 P2-A: before undoing after an unknown record error or a throw,
   * read the edit by its key. Saved: keep the pushes, it is a success. Not
   * there: undo as before. The read itself failed: never undo (the app may
   * match the record), tell staff, and tell the Host it may have gone through.
   */
  async function recoverOrRevert(status: number, why: string): Promise<HostLiveEditResult> {
    let saved: unknown = null;
    let unknown = false;
    try {
      const { data, error } = await db.from("host_ad_live_edits").select("*")
        .eq("idempotency_key", input.idempotencyKey).maybeSingle();
      if (error) unknown = true;
      else saved = data ?? null;
    } catch {
      unknown = true;
    }
    if (saved) return succeeded(saved, { recovered: true });
    if (unknown) {
      const platforms = [...new Set(pushed.map((item) => item.platform))];
      await report({
        kind: "unconfirmed",
        platforms: platforms.length > 0
          ? platforms
          : [...new Set(input.plan.lines.map((line) => line.platform))],
        detail: `${why}; the saved edit could not be checked, so nothing was undone`,
      });
      return { status: 502, body: { error: "host_ad_live_edit_unconfirmed" } };
    }
    return await failure(status, "host_ad_live_edit_not_recorded");
  }
}

/**
 * #4238 6a / item 4: when a Host ad first went live — the earliest ACTIVE
 * status event of its campaigns, else the earliest campaign create time (the
 * launch). Null when nothing is known (never guessed as "long ago").
 */
export async function loadHostLiveSinceMs(
  db: Db,
  campaigns: readonly Record<string, unknown>[],
): Promise<number | null> {
  const ids = campaigns.map((row) => String(row.id ?? "")).filter(Boolean);
  if (ids.length === 0) return null;
  const { data, error } = await db.from("ad_status_events")
    .select("created_at").in("campaign_id", ids).eq("to_status", "ACTIVE")
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  const active = !error && data ? Date.parse(String(data.created_at ?? "")) : NaN;
  if (Number.isFinite(active)) return active;
  const created = campaigns
    .map((row) => Date.parse(String(row.created_at ?? "")))
    .filter((ms) => Number.isFinite(ms));
  return created.length > 0 ? Math.min(...created) : null;
}
