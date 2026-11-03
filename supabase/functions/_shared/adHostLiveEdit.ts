/**
 * #4238 media-buyer, wave D — a Host changes a live ad's budget and/or end
 * date, once a day.
 *
 * MINGLA-INVARIANT: I-4238-LIVE-EDIT-ONCE-A-DAY | issue #4238 | A Host live ad's budget/end date changes at most once per 24 hours, the end never passes the last bookable moment, the new total never drops below spend so far, and Ads credit moves in the same transaction as the change (host_ad_amend_live). Enforced by supabase/migrations/__tests__/issue_4238_ads_media_buyer.implementor.pg17.test.sql (M4) and supabase/functions/_shared/__tests__/issue_4238_mb_live_edit.test.ts.
 *
 * MINGLA-INVARIANT: I-4238-LIVE-EDIT-CAPS-WITHIN-TOTAL | issue #4238 | The per-app caps of a Host live edit never add up (in the brand's money, at each campaign's frozen rate) to more than the new total: planHostLiveEdit gives each app its spend plus a share of what is left, and host_ad_amend_live refuses caps above the new total (PT409). Enforced by supabase/functions/_shared/__tests__/issue_4238_mb_live_edit_r9.implementor.test.ts and supabase/migrations/__tests__/issue_4238_ads_media_buyer_r9.implementor.pg17.test.sql.
 *
 * MINGLA-INVARIANT: I-4238-LIVE-EDIT-CLAIM-BEFORE-PUSH | issue #4238 | A Host live edit is claimed under the plan lock (host_ad_live_edit_claim) before any provider push, so a second tap or device never pushes; a same-key retry returns the saved edit; a once-a-day refusal never undoes a push. Enforced by supabase/functions/_shared/__tests__/issue_4238_mb_live_edit_r9.implementor.test.ts and supabase/migrations/__tests__/issue_4238_ads_media_buyer_r9.implementor.pg17.test.sql.
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
};

export type HostLivePlanLine = {
  campaign_id: string;
  platform: Platform;
  new_provider_budget_cents: number;
  new_provider_delivery_budget_cents: number;
  daily_changed: boolean;
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
  | { ok: false; error: string; detail?: string };

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
    const canPush = HOST_LIVE_DAILY_PUSH.has(row.platform);
    let newDaily = hostDailies === null
      ? row.current_daily_cents
      : Math.max(1, Math.floor(hostDailies[index] * dailyRatio));
    if (!canPush && newDaily !== row.current_daily_cents) {
      newDaily = row.current_daily_cents;
      if (!dailyNotPushed.includes(row.platform)) dailyNotPushed.push(row.platform);
    }
    newDaily = Math.max(1, Math.min(newDaily, newCap));
    const dailyChanged = newDaily !== row.current_daily_cents;
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
};

async function dailyTargets(
  db: Db,
  campaign: Record<string, unknown>,
  line: HostLivePlanLine,
  previousDaily: number,
): Promise<Target[]> {
  if (line.platform === "meta") {
    const externalId = String(campaign.external_campaign_id ?? "");
    if (!externalId) throw new Error("campaign_budget_target_missing");
    return [{
      level: "campaign",
      externalId,
      previousCents: previousDaily,
      nextCents: line.new_provider_delivery_budget_cents,
    }];
  }
  const { data: adSets, error } = await db.from("ad_sets")
    .select("id,external_adset_id,budget_cents").eq("campaign_id", campaign.id)
    .order("id");
  if (error || !Array.isArray(adSets) || adSets.length === 0) {
    throw new Error("ad_set_budget_target_missing");
  }
  const weights = adSets.map((row: Record<string, unknown>) => {
    const cents = Number(row.budget_cents);
    return Number.isSafeInteger(cents) && cents > 0 ? cents : 1;
  });
  const before = proportionalSplit(previousDaily, weights);
  const after = proportionalSplit(line.new_provider_delivery_budget_cents, weights);
  return adSets.map((row: Record<string, unknown>, index: number) => ({
    level: "ad_set" as const,
    externalId: String(row.external_adset_id ?? ""),
    previousCents: before[index],
    nextCents: after[index],
  }));
}

export type HostLiveEditResult = { status: number; body: Record<string, unknown> };

/** An app whose budget may not match Mingla's record (staff must check). */
export type HostLiveEditProblem = {
  kind: "undo_failed" | "not_reverted";
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
  for (const line of input.plan.lines) {
    const campaign = input.campaigns.find((row) => row.id === line.campaign_id) ?? {};
    const previousDaily = Number(
      campaign.amended_provider_delivery_budget_cents ??
        campaign.provider_delivery_budget_cents,
    );
    const needsEnd = line.platform === "meta" && input.plan.newEndsAt !== null;
    if (!line.daily_changed && !needsEnd) continue;
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
        for (const target of await dailyTargets(db, campaign, line, previousDaily)) {
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
        evidence[line.campaign_id] = { confirmed, pushed_at: new Date().toISOString() };
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
    return await failure(
      error.code === "PT409" ? 409 : known ? 422 : 409,
      known ?? "host_ad_live_edit_not_recorded",
    );
  }
  return {
    status: 200,
    body: {
      ok: true,
      edit: data,
      daily_not_pushed: input.plan.dailyNotPushed,
      end_not_pushed: input.plan.newEndsAt === null
        ? []
        : [...new Set(input.plan.lines.map((line) => line.platform))]
          .filter((platform) => platform !== "meta"),
    },
  };
}
