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
    // #4238 W4c (Z-6): the purchases ad set counts 7-day click, no view.
    body.attribution_spec = [{ event_type: "CLICK_THROUGH", window_days: 7 }];
    const created = await graph("POST", `act_${deps.adAccountId}/adsets`, body);
    newAdSetId = String(created.id ?? "");
    if (!newAdSetId) return await fail("adset_create_returned_no_id");
    // #4238 rework 2 (tester P3-1): record the new ad set at once, before any
    // ad is copied, marked cleanup_required. A kill or timeout from here on
    // leaves a pending row that names the ACTIVE ad set, so the next sweep's
    // finish step pauses it (cleanUpNewAdSet) instead of leaving it untracked.
    // Only a completed copy below clears the mark.
    // MINGLA-INVARIANT: I-4238-GOAL-SWITCH-TRACKED-AT-CREATE | issue #4238 | startGoalPromotion saves new_adset_id (with cleanup_required) on its pending row immediately after Meta creates the ad set and before any ad is copied; if that save fails the new ad set is paused and the row fails.
    const { error: trackError } = await db.from("ad_plan_automation_events")
      .update({
        detail: {
          ...baseDetail,
          new_adset_id: newAdSetId,
          cleanup_required: true,
          copying_ads: true,
        },
      }).eq("id", rowId);
    if (trackError) {
      await graph("POST", newAdSetId, { status: "PAUSED" });
      return await fail(`adset_track_failed: ${message(trackError.message)}`);
    }
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
      detail: {
        ...baseDetail,
        new_adset_id: newAdSetId,
        new_ad_ids: newAds,
        cleanup_required: false,
      },
    }).eq("id", rowId);
    return { state: "created", newAdSetId };
  } catch (error) {
    if (newAdSetId) {
      try {
        await graph("POST", newAdSetId, { status: "PAUSED" });
      } catch (pauseError) {
        // #4238 rework 1 (tester P2-4): the new ad set may still be ACTIVE.
        // Never mark the row failed (a failed row is re-claimed a day later
        // and would create a THIRD ad set). Keep it pending with the new ad
        // set's id and cleanup_required, so the next sweep's finish step
        // pauses it again (and never the old one) before anything else.
        const detail = `${message(error)}; new_adset_pause_failed: ${
          message(pauseError)
        }`;
        await db.from("ad_plan_automation_events").update({
          status: "pending",
          detail: {
            ...baseDetail,
            new_adset_id: newAdSetId,
            cleanup_required: true,
            error: detail,
          },
        }).eq("id", rowId);
        return { state: "failed", detail };
      }
    }
    return await fail(message(error));
  }
}

/**
 * #4238 rework 1 (tester P2-4): a new ad set whose pause failed is paused
 * again on the next sweep. Paused: the row becomes failed (the normal retry
 * rule applies from then on). Still not paused: the row stays pending, so
 * no new ad set is ever created while one may be running.
 *
 * MINGLA-INVARIANT: I-4238-GOAL-SWITCH-AT-MOST-ONE-EXTRA | issue #4238 | A goal-ladder switch whose new ad set could not be paused stays pending with cleanup_required (never failed, so it is never re-claimed) until a later sweep pauses that ad set; the old ad set is never paused on that path.
 */
async function cleanUpNewAdSet(
  db: Db,
  graph: Graph,
  row: PromotionRow,
  newAdSetId: string,
  reason: string,
): Promise<"failed" | "waiting"> {
  const detail = row.detail ?? {};
  try {
    await graph("POST", newAdSetId, { status: "PAUSED" });
  } catch (error) {
    await db.from("ad_plan_automation_events").update({
      status: "pending",
      detail: {
        ...detail,
        cleanup_required: true,
        error: typeof detail.error === "string" ? detail.error : reason,
        cleanup_error: message(error),
      },
    }).eq("id", row.id);
    return "waiting";
  }
  await db.from("ad_plan_automation_events").update({
    status: "failed",
    detail: {
      ...detail,
      cleanup_required: false,
      error: typeof detail.error === "string" ? detail.error : reason,
    },
  }).eq("id", row.id);
  return "failed";
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
  if (detail.cleanup_required === true) {
    return await cleanUpNewAdSet(db, graph, input.row, newAdSetId, "cleanup");
  }
  let status = "";
  try {
    const read = await graph("GET", newAdSetId, { fields: "effective_status" });
    status = String(read.effective_status ?? "").toUpperCase();
  } catch {
    return "waiting";
  }
  if (REFUSED.has(status)) {
    // #4238 rework 1: a refused ad set that can't be paused stays pending
    // (cleanup_required) instead of failed, so no third ad set is made.
    return await cleanUpNewAdSet(
      db,
      graph,
      {
        ...input.row,
        detail: { ...detail, error: `new_adset_${status.toLowerCase()}` },
      },
      newAdSetId,
      `new_adset_${status.toLowerCase()}`,
    );
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
/**
 * #4238 W4a (5c, D-5): the Host accepted the last-tickets offer. Meta only
 * (Snapchat and TikTok keep the offer recorded; their creative copy can't be
 * re-issued through this path yet). Two hourly steps, once per plan per app
 * (the low_stock_copy once-index):
 *  1. For every live ad of the campaign, a new creative with the frozen
 *     last-tickets primary text and a new ACTIVE ad in the same ad set —
 *     the normal app review path; nothing spends until the app approves it.
 *  2. Once every new ad is ACTIVE, the old ads are paused (applied). A
 *     refused new ad is paused and the row marked failed; old ads untouched.
 * Never throws; a provider error marks the row failed.
 */
export function withLastTicketsText(
  creative: Record<string, unknown>,
  primary: string,
): Record<string, unknown> {
  const out = structuredClone(creative) as Record<string, unknown>;
  const story = out.object_story_spec as Record<string, unknown> | undefined;
  for (const key of ["video_data", "link_data", "photo_data"]) {
    const data = story?.[key] as Record<string, unknown> | undefined;
    if (data && typeof data === "object") {
      if (key === "photo_data") data.caption = primary;
      else data.message = primary;
    }
  }
  const feed = out.asset_feed_spec as Record<string, unknown> | undefined;
  if (feed && Array.isArray(feed.bodies)) {
    feed.bodies = [{ text: primary }];
  }
  return out;
}

export async function applyLastTicketsOffer(deps: {
  db: Db;
  graph: Graph;
  adAccountId: string;
}, input: {
  row: PromotionRow;
  campaignId: string;
  nowIso: string;
}): Promise<string> {
  const { db, graph } = deps;
  const detail = input.row.detail ?? {};
  const primary = typeof detail.primary === "string" ? detail.primary : "";
  const fail = async (error: string) => {
    await db.from("ad_plan_automation_events").update({
      status: "failed",
      detail: { ...detail, error },
    }).eq("id", input.row.id).eq("status", "pending");
    return `failed:${error}`;
  };
  if (!primary) return await fail("last_tickets_copy_missing");
  try {
    const made = Array.isArray(detail.new_ad_ids)
      ? (detail.new_ad_ids as unknown[]).map(String)
      : [];
    if (made.length === 0) {
      const { data: sets } = await db.from("ad_sets")
        .select("external_adset_id").eq("campaign_id", input.campaignId);
      const created: string[] = [];
      const old: string[] = [];
      for (const set of (sets ?? []) as Record<string, unknown>[]) {
        const adSetId = String(set.external_adset_id ?? "");
        if (!adSetId) continue;
        const ads = await graph("GET", `${adSetId}/ads`, {
          fields: "id,name,effective_status,creative{id}",
          limit: 25,
        });
        for (
          const ad of (Array.isArray(ads.data) ? ads.data : []) as Record<
            string,
            unknown
          >[]
        ) {
          if (String(ad.effective_status ?? "").toUpperCase() !== "ACTIVE") {
            continue;
          }
          const creativeId = String(
            (ad.creative as Record<string, unknown> | undefined)?.id ?? "",
          );
          if (!creativeId) continue;
          const source = await graph("GET", creativeId, {
            fields: "name,object_story_spec,asset_feed_spec,url_tags",
          });
          const body = withLastTicketsText({
            name: `${String(source.name ?? "Ad")} — last tickets`.slice(0, 200),
            ...(source.object_story_spec
              ? { object_story_spec: source.object_story_spec }
              : {}),
            ...(source.asset_feed_spec
              ? { asset_feed_spec: source.asset_feed_spec }
              : {}),
            ...(source.url_tags ? { url_tags: source.url_tags } : {}),
          }, primary);
          const newCreative = await graph(
            "POST",
            `act_${deps.adAccountId}/adcreatives`,
            body,
          );
          if (typeof newCreative.id !== "string") continue;
          const newAd = await graph("POST", `act_${deps.adAccountId}/ads`, {
            name: `${String(ad.name ?? "Ad")} — last tickets`.slice(0, 200),
            adset_id: adSetId,
            creative: { creative_id: newCreative.id },
            status: "ACTIVE",
          });
          if (typeof newAd.id === "string") {
            created.push(newAd.id);
            old.push(String(ad.id));
          }
        }
      }
      if (created.length === 0) return await fail("no_live_ads_to_copy");
      await db.from("ad_plan_automation_events").update({
        detail: {
          ...detail,
          new_ad_ids: created,
          old_ad_ids: old,
          started_at: input.nowIso,
        },
      }).eq("id", input.row.id).eq("status", "pending");
      return "created";
    }
    const statuses: string[] = [];
    for (const id of made) {
      const read = await graph("GET", id, { fields: "effective_status" });
      statuses.push(String(read.effective_status ?? "").toUpperCase());
    }
    if (statuses.some((status) => REFUSED.has(status))) {
      for (const id of made) await graph("POST", id, { status: "PAUSED" });
      return await fail("new_ad_refused");
    }
    if (!statuses.every((status) => READY.has(status))) return "waiting";
    const oldIds = Array.isArray(detail.old_ad_ids)
      ? (detail.old_ad_ids as unknown[]).map(String)
      : [];
    for (const id of oldIds) await graph("POST", id, { status: "PAUSED" });
    await db.from("ad_plan_automation_events").update({
      status: "applied",
      applied_at: input.nowIso,
    }).eq("id", input.row.id).eq("status", "pending");
    return "applied";
  } catch (error) {
    return await fail(`provider: ${message(error)}`);
  }
}

/**
 * #4238 W4c (5c, D-5): the provider steps the last-tickets offer needs on
 * Snapchat and TikTok (the adapters' copy hooks plus status reads).
 */
export type LastTicketsAdOps = {
  /** A NEW ad in the same ad set with the words; returns its id. */
  copyAd(
    adSetExternalId: string,
    adExternalId: string,
    text: string,
  ): Promise<string>;
  /** The app's review / delivery status of one ad (effectiveStatus). */
  reviewStatus(adExternalId: string): Promise<string | null>;
  pauseAd(adExternalId: string): Promise<void>;
};

/**
 * #4238 W4c: what an app's ad status means for a new last-tickets ad. Snap
 * reports the ad review_status (APPROVED / PENDING / REJECTED); TikTok the
 * secondary status (AD_STATUS_DELIVERY_OK, AD_STATUS_AUDIT, …_AUDIT_DENY,
 * …_REAUDIT, …_NOT_APPROVE). Anything unknown waits: the old ads keep running.
 */
export function lastTicketsReview(
  platform: string,
  status: string | null,
): "ready" | "refused" | "waiting" {
  const value = String(status ?? "").toUpperCase();
  if (platform === "snapchat") {
    if (value === "APPROVED") return "ready";
    if (value === "REJECTED") return "refused";
    return "waiting";
  }
  if (platform === "tiktok") {
    if (/DENY|REJECT|NOT_APPROVE|DELETE/.test(value)) return "refused";
    if (value === "AD_STATUS_DELIVERY_OK") return "ready";
    return "waiting";
  }
  return "waiting";
}

/**
 * #4238 W4c (5c, D-5): the accepted last-tickets offer on Snapchat or TikTok,
 * the same two hourly steps as Meta (applyLastTicketsOffer):
 *  1. for every live ad of the campaign (Mingla's ads rows, status ACTIVE),
 *     a NEW ad in the same ad set with the frozen words, through the app's
 *     normal review (nothing spends on it until the app approves it);
 *  2. once every new ad is approved, the old ads are paused (applied). A
 *     refused new ad is paused and the row marked failed; old ads untouched.
 * Never throws; a provider error marks the row failed.
 */
export async function applyLastTicketsOfferByAds(deps: {
  db: Db;
  platform: "snapchat" | "tiktok";
  ops: LastTicketsAdOps;
}, input: {
  row: PromotionRow;
  campaignId: string;
  nowIso: string;
}): Promise<string> {
  const { db, ops } = deps;
  const detail = input.row.detail ?? {};
  const primary = typeof detail.primary === "string" ? detail.primary : "";
  const fail = async (error: string) => {
    await db.from("ad_plan_automation_events").update({
      status: "failed",
      detail: { ...detail, error },
    }).eq("id", input.row.id).eq("status", "pending");
    return `failed:${error}`;
  };
  if (!primary) return await fail("last_tickets_copy_missing");
  try {
    const made = Array.isArray(detail.new_ad_ids)
      ? (detail.new_ad_ids as unknown[]).map(String)
      : [];
    if (made.length === 0) {
      const { data: sets, error: setError } = await db.from("ad_sets")
        .select("id,external_adset_id").eq("campaign_id", input.campaignId);
      if (setError) return await fail("ad_sets_read_failed");
      const setRows = (sets ?? []) as Record<string, unknown>[];
      const external = new Map(
        setRows.map((
          set,
        ) => [String(set.id), String(set.external_adset_id ?? "")]),
      );
      if (setRows.length === 0) return await fail("no_live_ads_to_copy");
      const { data: ads, error: adError } = await db.from("ads")
        .select("id,ad_set_id,external_ad_id,status")
        .in("ad_set_id", setRows.map((set) => String(set.id)));
      if (adError) return await fail("ads_read_failed");
      const created: string[] = [];
      const old: string[] = [];
      for (const ad of (ads ?? []) as Record<string, unknown>[]) {
        if (String(ad.status ?? "").toUpperCase() !== "ACTIVE") continue;
        const adSetId = external.get(String(ad.ad_set_id)) ?? "";
        const adId = String(ad.external_ad_id ?? "");
        if (!adSetId || !adId) continue;
        created.push(await ops.copyAd(adSetId, adId, primary));
        old.push(adId);
      }
      if (created.length === 0) return await fail("no_live_ads_to_copy");
      await db.from("ad_plan_automation_events").update({
        detail: {
          ...detail,
          new_ad_ids: created,
          old_ad_ids: old,
          started_at: input.nowIso,
        },
      }).eq("id", input.row.id).eq("status", "pending");
      return "created";
    }
    const reviews: Array<"ready" | "refused" | "waiting"> = [];
    for (const id of made) {
      reviews.push(
        lastTicketsReview(deps.platform, await ops.reviewStatus(id)),
      );
    }
    if (reviews.includes("refused")) {
      for (const id of made) await ops.pauseAd(id);
      return await fail("new_ad_refused");
    }
    if (!reviews.every((review) => review === "ready")) return "waiting";
    const oldIds = Array.isArray(detail.old_ad_ids)
      ? (detail.old_ad_ids as unknown[]).map(String)
      : [];
    for (const id of oldIds) await ops.pauseAd(id);
    await db.from("ad_plan_automation_events").update({
      status: "applied",
      applied_at: input.nowIso,
    }).eq("id", input.row.id).eq("status", "pending");
    return "applied";
  } catch (error) {
    return await fail(`provider: ${message(error)}`);
  }
}

export async function runHostAdAutomation(deps: {
  db: Db;
  /** Meta Graph for this campaign's connection (null on other apps). */
  graph: Graph | null;
  adAccountId: string | null;
  readStock: () => Promise<OfferingStock | null>;
  /** #4238 W4c: Snapchat / TikTok ad steps for the last-tickets offer. */
  adOps?: LastTicketsAdOps | null;
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
          const { data: setRows } = await db.from("ad_sets")
            .select("external_adset_id,stage").eq(
              "campaign_id",
              ctx.campaignId,
            );
          // #4238 W4a: only the prospecting ad set climbs the ladder; a
          // retarget ad set keeps its frozen goal. Older rows have no stage.
          const allSets = (setRows ?? []) as Record<string, unknown>[];
          const sets = allSets.find((row) => row.stage === "prospecting") ??
            allSets.find((row) => row.stage !== "retarget") ?? null;
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

  // ── Last tickets: apply an offer the Host accepted (Meta W4a; Snap/TikTok W4c) ──
  try {
    if (ctx.platform === "meta" && deps.graph && deps.adAccountId) {
      const { data: offer } = await db.from("ad_plan_automation_events")
        .select("id,status,detail,created_at,applied_at")
        .eq("plan_id", ctx.planId).eq("platform", "meta")
        .eq("kind", "low_stock_copy").maybeSingle();
      const row = offer as PromotionRow | null;
      if (
        row?.status === "pending" && typeof row.detail?.accepted_at === "string"
      ) {
        report.last_tickets_apply = await applyLastTicketsOffer(
          { db, graph: deps.graph, adAccountId: deps.adAccountId },
          { row, campaignId: ctx.campaignId, nowIso },
        );
      }
    }
    // #4238 W4c: Snapchat and TikTok through their adapters' copy hooks.
    if (
      (ctx.platform === "snapchat" || ctx.platform === "tiktok") && deps.adOps
    ) {
      const { data: offer } = await db.from("ad_plan_automation_events")
        .select("id,status,detail,created_at,applied_at")
        .eq("plan_id", ctx.planId).eq("platform", ctx.platform)
        .eq("kind", "low_stock_copy").maybeSingle();
      const row = offer as PromotionRow | null;
      if (
        row?.status === "pending" && typeof row.detail?.accepted_at === "string"
      ) {
        report.last_tickets_apply = await applyLastTicketsOfferByAds(
          { db, platform: ctx.platform, ops: deps.adOps },
          { row, campaignId: ctx.campaignId, nowIso },
        );
      }
    }
  } catch (error) {
    report.last_tickets_apply = `error: ${message(error)}`;
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
