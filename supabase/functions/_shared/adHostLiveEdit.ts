/**
 * #4238 media-buyer, wave D — a Host changes a live ad's budget and/or end
 * date, once a day.
 *
 * MINGLA-INVARIANT: I-4238-LIVE-EDIT-ONCE-A-DAY | issue #4238 | A Host live ad's budget/end date changes at most once per 24 hours, the end never passes the last bookable moment, the new total never drops below spend so far, and Ads credit moves in the same transaction as the change (host_ad_amend_live). Enforced by supabase/migrations/__tests__/issue_4238_ads_media_buyer.implementor.pg17.test.sql (M4) and supabase/functions/_shared/__tests__/issue_4238_mb_live_edit.test.ts.
 *
 * Order: plan (pure) → push each changed daily budget (Meta, Snapchat,
 * TikTok — the apps Mingla can push to) and Meta's ad set end time → record
 * the change, the credit move and the amendments in one SQL call. A failure
 * after a push reverts the pushes already made.
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
  | { ok: false; error: string };

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
  if (newBudget < input.hostSpendCents) {
    return { ok: false, error: "host_ad_live_edit_below_spend" };
  }
  if (input.campaigns.length === 0) {
    return { ok: false, error: "plan_campaigns_missing" };
  }
  const endMs = Date.parse(endsAt ?? input.currentEndsAt ?? "");
  // Caps: the new total, shared like the plan's own caps, at the frozen
  // host→app ratio (fee and exchange rate included).
  const hostCaps = proportionalSplit(
    newBudget,
    input.campaigns.map((row) => row.host_budget_cents),
  );
  // Daily: what is left, over the days left (unchanged when no end date).
  const remaining = Math.max(1, newBudget - input.hostSpendCents);
  const dailyTotal = Number.isFinite(endMs)
    ? Math.max(1, Math.floor(remaining / wholeDaysLeft(input.nowMs, endMs)))
    : null;
  const hostDailies = dailyTotal === null ? null : proportionalSplit(
    dailyTotal,
    input.campaigns.map((row) => row.host_delivery_budget_cents),
  );
  const dailyNotPushed: Platform[] = [];
  const lines = input.campaigns.map((row, index) => {
    const capRatio = row.provider_budget_cents / row.host_budget_cents;
    const dailyRatio = row.provider_delivery_budget_cents /
      row.host_delivery_budget_cents;
    const newCap = Math.max(
      row.provider_spend_cents,
      Math.floor(hostCaps[index] * capRatio),
    );
    const canPush = HOST_LIVE_DAILY_PUSH.has(row.platform);
    let newDaily = hostDailies === null
      ? row.current_daily_cents
      : Math.max(1, Math.floor(hostDailies[index] * dailyRatio));
    if (!canPush && newDaily !== row.current_daily_cents) {
      newDaily = row.current_daily_cents;
      if (!dailyNotPushed.includes(row.platform)) dailyNotPushed.push(row.platform);
    }
    newDaily = Math.min(newDaily, newCap);
    return {
      campaign_id: row.id,
      platform: row.platform,
      new_provider_budget_cents: Math.max(1, newCap),
      new_provider_delivery_budget_cents: Math.max(1, newDaily),
      daily_changed: newDaily !== row.current_daily_cents,
    };
  });
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

/** Runs a planned edit: push, then record (reverting pushes on failure). */
export async function runHostLiveEdit(
  deps: { db: Db; getAdapter: (platform: Platform) => ChannelAdapter },
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
  const revert = async () => {
    for (const item of pushed.reverse()) {
      try {
        await item.undo();
      } catch {
        // Named in the response: that app may differ until staff check it.
      }
    }
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
      await revert();
      return { status: 424, body: { error: `${line.platform}_not_connected` } };
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
      await revert();
      const detail = error instanceof Error ? error.message : String(error);
      return {
        status: 502,
        body: {
          error: `${line.platform}_budget_update_failed`,
          detail: detail.slice(0, 300),
          reverted: pushed.map((item) => item.platform),
        },
      };
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
    await revert();
    const message = String(error.message ?? "");
    const known = [
      "host_ad_live_edit_once_a_day",
      "host_ad_live_edit_end_after_last_bookable",
      "host_ad_live_edit_below_spend",
      "host_ad_live_edit_end_in_past",
      "ad_credit_insufficient",
    ].find((code) => message.includes(code));
    return {
      status: error.code === "PT409" ? 409 : known ? 422 : 409,
      body: { error: known ?? "host_ad_live_edit_not_recorded" },
    };
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
