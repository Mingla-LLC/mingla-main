/**
 * #4238 item 4 — the provider side of the goal ladder (see adGoalLadder.ts).
 *
 * The switch is a NEW ad set in the same campaign (the optimisation event of
 * an ad set is fixed once it runs), with the Purchase goal, the same targeting
 * and the same creatives (new ads). It runs in two hourly steps so nothing
 * ever waits inside one sweep:
 *
 *   1. claim  — insert the goal_promoted row (pending). The partial unique
 *               index refuses a second row, so two sweeps never both switch.
 *               A failed row is re-claimed at most once a day.
 *      create — copy the old ad set with promoted_object PURCHASE, then one
 *               new ad per old ad (same creative). The old ad set keeps
 *               running. Under Meta CBO the budget stays on the campaign, so
 *               the two ad sets share it: spend never doubles.
 *   2. finish — on a later sweep, when the new ad set is ACTIVE, pause the old
 *               one and mark the row applied. A new ad set that was refused
 *               (or can't be read) is paused and the row marked failed; the
 *               old ad set is never paused in that case.
 *
 * Every Graph call goes through an injected `graph` so the sweep passes the
 * existing metaGraph wrapper and tests pass a fake.
 */

import { evaluateCreativeFatigue } from "./adCreativeFatigue.ts";
import {
  decideGoalPromotion,
  ladderMetaCustomEventType,
  ladderStageFor,
} from "./adGoalLadder.ts";
import { isLowStock, type OfferingStock } from "./adDestination.ts";
import { slowSalesNudgeDue } from "./adResultEstimate.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type Graph = (
  method: "GET" | "POST" | "DELETE",
  path: string,
  params?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export type PromotionRow = {
  id: string;
  status: "pending" | "applied" | "failed";
  detail: Record<string, unknown>;
  created_at: string;
  applied_at: string | null;
};

/** Ad set fields copied onto the new ad set (budget stays on the campaign). */
const COPIED_FIELDS = [
  "targeting",
  "billing_event",
  "optimization_goal",
  "bid_strategy",
  "bid_amount",
  "attribution_spec",
  "destination_type",
  "start_time",
  "end_time",
  "daily_budget",
  "lifetime_budget",
] as const;

const READY = new Set(["ACTIVE"]);
const REFUSED = new Set(["DISAPPROVED", "WITH_ISSUES", "DELETED", "ARCHIVED"]);

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

/**
 * Step 1: claim, then create the Purchase ad set and its ads. Returns what
 * happened; never throws (a provider error marks the row failed and leaves
 * the old ad set running).
 */
export async function startGoalPromotion(deps: {
  db: Db;
  graph: Graph;
  adAccountId: string;
}, input: {
  planId: string;
  campaignId: string;
  externalCampaignId: string;
  oldAdSetExternalId: string;
  purchases7d: number;
  source: "platform" | "mingla";
  nowIso: string;
  /** A failed row older than a day, being retried. */
  retryRowId?: string | null;
}): Promise<
  | { state: "created"; newAdSetId: string }
  | { state: "claimed_elsewhere" }
  | { state: "failed"; detail: string }
> {
  const { db, graph } = deps;
  const baseDetail = {
    from: "checkout",
    to: "purchase",
    purchases_7d: input.purchases7d,
    source: input.source,
    old_adset_id: input.oldAdSetExternalId,
    attempted_at: input.nowIso,
  };
  let rowId: string;
  if (input.retryRowId) {
    const { data, error } = await db.from("ad_plan_automation_events")
      .update({ status: "pending", detail: baseDetail })
      .eq("id", input.retryRowId).eq("status", "failed")
      .select("id").maybeSingle();
    if (error || !data?.id) return { state: "claimed_elsewhere" };
    rowId = String(data.id);
  } else {
    const { data, error } = await db.from("ad_plan_automation_events").insert({
      plan_id: input.planId,
      campaign_id: input.campaignId,
      platform: "meta",
      kind: "goal_promoted",
      status: "pending",
      detail: baseDetail,
    }).select("id").maybeSingle();
    if (error || !data?.id) {
      // 23505: another sweep claimed it first (I-4238-ONE-GOAL-SWITCH).
      return error && String(error.code ?? "") !== "23505"
        ? { state: "failed", detail: `claim_failed: ${message(error.message)}` }
        : { state: "claimed_elsewhere" };
    }
    rowId = String(data.id);
  }
  const fail = async (detail: string) => {
    await db.from("ad_plan_automation_events").update({
      status: "failed",
      detail: { ...baseDetail, error: detail },
    }).eq("id", rowId);
    return { state: "failed" as const, detail };
  };
  let newAdSetId = "";
  try {
    const old = await graph("GET", input.oldAdSetExternalId, {
      fields: ["name", "promoted_object", ...COPIED_FIELDS].join(","),
    });
    const promoted = old.promoted_object &&
        typeof old.promoted_object === "object"
      ? old.promoted_object as Record<string, unknown>
      : null;
    if (!promoted || typeof promoted.pixel_id !== "string") {
      return await fail("old_adset_has_no_pixel");
    }
    const body: Record<string, unknown> = {
      name: `${String(old.name ?? "Ad set")} — purchases`.slice(0, 200),
      campaign_id: input.externalCampaignId,
      status: "ACTIVE",
      promoted_object: {
        ...promoted,
        custom_event_type: ladderMetaCustomEventType("purchase"),
      },
    };
    for (const field of COPIED_FIELDS) {
      if (old[field] !== undefined && old[field] !== null) {
        body[field] = old[field];
      }
    }
    const created = await graph("POST", `act_${deps.adAccountId}/adsets`, body);
    newAdSetId = String(created.id ?? "");
    if (!newAdSetId) return await fail("adset_create_returned_no_id");
    const ads = await graph("GET", `${input.oldAdSetExternalId}/ads`, {
      fields: "id,name,creative{id}",
      limit: 25,
    });
    const rows = Array.isArray(ads.data)
      ? ads.data as Record<string, unknown>[]
      : [];
    const newAds: string[] = [];
    for (const ad of rows) {
      const creative = ad.creative as Record<string, unknown> | undefined;
      const creativeId = typeof creative?.id === "string" ? creative.id : "";
      if (!creativeId) continue;
      const made = await graph("POST", `act_${deps.adAccountId}/ads`, {
        name: `${String(ad.name ?? "Ad")} — purchases`.slice(0, 200),
        adset_id: newAdSetId,
        creative: { creative_id: creativeId },
        status: "ACTIVE",
      });
      if (typeof made.id === "string") newAds.push(made.id);
    }
    if (newAds.length === 0) {
      await graph("POST", newAdSetId, { status: "PAUSED" });
      return await fail("no_ads_copied");
    }
    await db.from("ad_plan_automation_events").update({
      detail: { ...baseDetail, new_adset_id: newAdSetId, new_ad_ids: newAds },
    }).eq("id", rowId);
    return { state: "created", newAdSetId };
  } catch (error) {
    if (newAdSetId) {
      try {
        await graph("POST", newAdSetId, { status: "PAUSED" });
      } catch (pauseError) {
        return await fail(
          `${message(error)}; new_adset_pause_failed: ${message(pauseError)}`,
        );
      }
    }
    return await fail(message(error));
  }
}

/**
 * Step 2: once the new ad set is ACTIVE, pause the old one and mark the row
 * applied. A refused new ad set is paused and the row marked failed, leaving
 * the old ad set ACTIVE. Still in review: nothing happens yet.
 */
export async function finishGoalPromotion(deps: {
  db: Db;
  graph: Graph;
}, input: {
  row: PromotionRow;
  campaignId: string;
  nowIso: string;
}): Promise<"applied" | "waiting" | "failed" | "not_started"> {
  const { db, graph } = deps;
  const detail = input.row.detail ?? {};
  const newAdSetId = typeof detail.new_adset_id === "string"
    ? detail.new_adset_id
    : "";
  const oldAdSetId = typeof detail.old_adset_id === "string"
    ? detail.old_adset_id
    : "";
  if (!newAdSetId || !oldAdSetId) return "not_started";
  let status = "";
  try {
    const read = await graph("GET", newAdSetId, { fields: "effective_status" });
    status = String(read.effective_status ?? "").toUpperCase();
  } catch {
    return "waiting";
  }
  if (REFUSED.has(status)) {
    try {
      await graph("POST", newAdSetId, { status: "PAUSED" });
    } catch {
      // The row still says failed; staff see new_adset_id in the detail.
    }
    await db.from("ad_plan_automation_events").update({
      status: "failed",
      detail: { ...detail, error: `new_adset_${status.toLowerCase()}` },
    }).eq("id", input.row.id);
    return "failed";
  }
  if (!READY.has(status)) return "waiting";
  try {
    await graph("POST", oldAdSetId, { status: "PAUSED" });
  } catch (error) {
    // Both ad sets share the campaign budget, so leaving the old one running
    // never overspends; the next sweep tries the pause again.
    await db.from("ad_plan_automation_events").update({
      detail: { ...detail, old_pause_error: message(error) },
    }).eq("id", input.row.id);
    return "waiting";
  }
  await db.from("ad_plan_automation_events").update({
    status: "applied",
    applied_at: input.nowIso,
  }).eq("id", input.row.id);
  return "applied";
}

// ── The hourly Host ad automation (admin-ad-spend-sync) ─────────────────────

/** #4238 W2: Meta campaign insights `actions` → result counts per day. */
export function parseMetaResultCounts(
  payload: Record<string, unknown>,
): Map<string, { purchase: number; checkout: number; signup: number }> {
  const out = new Map<
    string,
    { purchase: number; checkout: number; signup: number }
  >();
  const rows = Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>[]
    : [];
  const pick = (
    actions: Record<string, unknown>[],
    types: string[],
  ): number => {
    let best = 0;
    for (const type of types) {
      const row = actions.find((item) => item.action_type === type);
      const value = Number(row?.value);
      if (Number.isFinite(value) && value > best) best = Math.floor(value);
    }
    return best;
  };
  for (const row of rows) {
    const day = typeof row.date_start === "string"
      ? row.date_start.slice(0, 10)
      : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const actions = Array.isArray(row.actions)
      ? row.actions as Record<string, unknown>[]
      : [];
    out.set(day, {
      // One type per result, the pixel's own first (never added together:
      // Meta reports the same purchase under several aliases).
      purchase: pick(actions, [
        "offsite_conversion.fb_pixel_purchase",
        "purchase",
      ]),
      checkout: pick(actions, [
        "offsite_conversion.fb_pixel_initiate_checkout",
        "initiate_checkout",
      ]),
      signup: pick(actions, [
        "offsite_conversion.fb_pixel_complete_registration",
        "complete_registration",
      ]),
    });
  }
  return out;
}

export type HostAutomationContext = {
  planId: string;
  campaignId: string;
  platform: string;
  externalCampaignId: string;
  canonical: Record<string, unknown>;
  eventId: string | null;
  eventStartMs: number | null;
  endsAtMs: number | null;
  liveSinceMs: number | null;
  nowMs: number;
};

/**
 * #4238 items 4, 5c and 5d — runs after the spend fetch for one ACTIVE Host
 * campaign. Each step is independent and never throws; the result names what
 * happened for the sweep's report.
 *   ladder  (Meta, checkout_first only): finish a started switch, else decide
 *           and start one (decideGoalPromotion).
 *   last tickets (5c, offer — D-5: offered to the Host, never automatic):
 *           records one pending low_stock_copy row with the frozen words.
 *   nudge   (5d data hook): records one pending slow_sales_nudge row; the
 *           notification itself is W4.
 */
export async function runHostAdAutomation(deps: {
  db: Db;
  /** Meta Graph for this campaign's connection (null on other apps). */
  graph: Graph | null;
  adAccountId: string | null;
  readStock: () => Promise<OfferingStock | null>;
}, ctx: HostAutomationContext): Promise<Record<string, unknown>> {
  const { db } = deps;
  const report: Record<string, unknown> = {};
  const nowIso = new Date(ctx.nowMs).toISOString();
  const since = (days: number) =>
    new Date(ctx.nowMs - days * 86_400_000).toISOString();

  // ── Ladder ──
  try {
    const stage = ladderStageFor(ctx.canonical, ctx.platform);
    if (
      ctx.platform === "meta" && stage === "checkout_first" && deps.graph &&
      deps.adAccountId
    ) {
      const { data: existing } = await db.from("ad_plan_automation_events")
        .select("id,status,detail,created_at,applied_at")
        .eq("plan_id", ctx.planId).eq("platform", "meta").eq(
          "kind",
          "goal_promoted",
        )
        .maybeSingle();
      const row = existing as PromotionRow | null;
      if (
        row?.status === "pending" &&
        typeof row.detail?.new_adset_id === "string"
      ) {
        report.ladder = await finishGoalPromotion(
          { db, graph: deps.graph },
          { row, campaignId: ctx.campaignId, nowIso },
        );
      } else {
        const { data: days } = await db.from("ad_spend_daily")
          .select("spend_date,purchase_events").eq(
            "campaign_id",
            ctx.campaignId,
          )
          .gte("spend_date", since(7).slice(0, 10));
        const reported = ((days ?? []) as Record<string, unknown>[])
          .filter((day) =>
            day.purchase_events !== null && day.purchase_events !== undefined
          );
        let purchases7d = reported.reduce(
          (sum, day) => sum + Number(day.purchase_events),
          0,
        );
        let source: "platform" | "mingla" = "platform";
        if (reported.length === 0) {
          const { count } = await db.from("ad_conversions")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", ctx.campaignId).eq("event_type", "purchase")
            .gte("created_at", since(7));
          purchases7d = Number(count ?? 0);
          source = "mingla";
        }
        const atMs = Date.parse(
          String(row?.detail?.attempted_at ?? row?.created_at ?? ""),
        );
        const decision = decideGoalPromotion({
          platform: "meta",
          stage,
          purchases7d,
          liveSinceMs: ctx.liveSinceMs,
          endsAtMs: ctx.endsAtMs,
          nowMs: ctx.nowMs,
          existing: row
            ? {
              status: row.status,
              atMs: Number.isFinite(atMs) ? atMs : ctx.nowMs,
            }
            : null,
        });
        if (!decision.promote) {
          report.ladder = decision.reason;
        } else {
          const { data: sets } = await db.from("ad_sets")
            .select("external_adset_id").eq("campaign_id", ctx.campaignId)
            .limit(1)
            .maybeSingle();
          const oldAdSet = String(sets?.external_adset_id ?? "");
          const started = oldAdSet
            ? await startGoalPromotion(
              { db, graph: deps.graph, adAccountId: deps.adAccountId },
              {
                planId: ctx.planId,
                campaignId: ctx.campaignId,
                externalCampaignId: ctx.externalCampaignId,
                oldAdSetExternalId: oldAdSet,
                purchases7d,
                source,
                nowIso,
                retryRowId: row?.status === "failed" ? row.id : null,
              },
            )
            : { state: "failed" as const, detail: "ad_set_missing" };
          report.ladder = started.state;
        }
      }
    }
  } catch (error) {
    report.ladder_error = message(error);
  }

  // ── Last tickets (offer) and the slow-sales nudge ──
  try {
    const needsStock = ctx.eventId !== null;
    const stock = needsStock ? await deps.readStock() : null;
    const copy = ctx.canonical.copy && typeof ctx.canonical.copy === "object"
      ? ctx.canonical.copy as Record<string, unknown>
      : {};
    if (
      stock && stock.kind === "tickets" && isLowStock(stock) &&
      ["meta", "snapchat", "tiktok"].includes(ctx.platform) &&
      typeof copy.last_tickets === "string"
    ) {
      const { error } = await db.from("ad_plan_automation_events").insert({
        plan_id: ctx.planId,
        campaign_id: ctx.campaignId,
        platform: ctx.platform,
        kind: "low_stock_copy",
        status: "pending",
        detail: {
          offered: true,
          remaining: stock.remaining,
          total: stock.total,
          primary: copy.last_tickets,
        },
      });
      report.last_tickets = error
        ? (String(error.code ?? "") === "23505"
          ? "already_offered"
          : "record_failed")
        : "offered";
    }
    const snapshot = ctx.canonical.guidance_snapshot as
      | Record<string, unknown>
      | undefined;
    const perApp = snapshot?.per_app as
      | Record<string, Record<string, unknown>>
      | undefined;
    const weekLow = Number(perApp?.[ctx.platform]?.week_low);
    if (
      snapshot?.known === true && Number.isFinite(weekLow) && weekLow > 0 &&
      stock
    ) {
      const { data: conversions } = await db.from("ad_conversions")
        .select("order_id").eq("campaign_id", ctx.campaignId)
        .eq("event_type", "purchase").gte("created_at", since(4));
      const orderIds = ((conversions ?? []) as Record<string, unknown>[])
        .map((row) => row.order_id).filter((id) => typeof id === "string");
      let tickets = 0;
      if (orderIds.length > 0) {
        const { count } = await db.from("tickets").select("id", {
          count: "exact",
          head: true,
        })
          .in("order_id", orderIds);
        tickets = Number(count ?? 0);
      }
      if (
        slowSalesNudgeDue({
          nowMs: ctx.nowMs,
          eventStartMs: ctx.eventStartMs,
          liveSinceMs: ctx.liveSinceMs,
          ticketsLast4Days: tickets,
          expectedWeekLow: weekLow,
          stock,
        })
      ) {
        const { error } = await db.from("ad_plan_automation_events").insert({
          plan_id: ctx.planId,
          campaign_id: ctx.campaignId,
          platform: ctx.platform,
          kind: "slow_sales_nudge",
          status: "pending",
          detail: { tickets_last_4_days: tickets, expected_week_low: weekLow },
        });
        report.nudge = error
          ? (String(error.code ?? "") === "23505"
            ? "already_recorded"
            : "record_failed")
          : "recorded";
      }
    }
  } catch (error) {
    report.stock_error = message(error);
  }
  // #4238 T-4: the tired-creative signal (recorded; delivery is W4).
  report.fatigue = await evaluateCreativeFatigue(db, {
    planId: ctx.planId,
    campaignId: ctx.campaignId,
    platform: ctx.platform,
    liveSinceMs: ctx.liveSinceMs,
    nowMs: ctx.nowMs,
  });
  return report;
}
