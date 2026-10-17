/**
 * admin-ad-campaign-action — ISSUE-862 WP1 [Full Rooms Ad Engine].
 *
 * Launch / pause (SPEC §4.4c as generalized by A3 §C):
 *   - launch: fail-close on the connection; set ACTIVE TOP-DOWN — campaign →
 *     ad sets → ads (a paused parent blocks a child's delivery). Re-read
 *     effective_status; if it lands in {PENDING_BILLING_INFO, DISAPPROVED,
 *     WITH_ISSUES} the launch still returns 200 with a `warning` (that is
 *     Meta's delivery state, not our error). TikTok (ISSUE-863 WP7 / A1.0-1):
 *     the read-back secondary status maps through tiktokLaunchWarning —
 *     BALANCE_EXCEED / NO_BUDGET / audit states are surfaced as the same
 *     200 + `warning`, NEVER a silent clamp and never a hard error.
 *   - pause: campaign level PAUSED (children stay as-is; the parent blocks them).
 *
 * The adapter interface can only express PAUSED|ACTIVE (AdvertiserStatus) —
 * the "Google REMOVED-never" rule is encoded at the type level; no action here
 * can ever delete/remove a platform campaign.
 *
 * Every action appends an ad_status_events audit row.
 * verify_jwt = true + in-code admin_users active gate; service-role DB writes.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AdApiError,
  type AdConnectionRow,
  AdNotConnectedError,
  getAdapter,
} from "../_shared/adChannel.ts";
import { notifyAdLaunchAttempt } from "../_shared/adLaunchAttemptOpsAlert.ts";
import { isLaunchConfirmPhrase } from "../_shared/adLaunchConfirm.ts";
import { shouldPauseForCap } from "../_shared/adMoney.ts";
import {
  endDatePassed,
  startDateNotReached,
  sumSpendCents,
} from "../_shared/adSpendSync.ts";
import { redditLaunchWarning } from "../_shared/reddit.ts";
import { snapchatLaunchWarning } from "../_shared/snapchat.ts";
import { tiktokLaunchWarning } from "../_shared/tiktok.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WARNING_STATUSES = ["PENDING_BILLING_INFO", "DISAPPROVED", "WITH_ISSUES"];

// deno-lint-ignore no-explicit-any
async function runPlannedAction(input: {
  db: any;
  campaign: Record<string, any>;
  action: "launch" | "pause";
  actorId: string;
  reason: string;
}): Promise<Response> {
  const { db, campaign, action, actorId, reason } = input;
  const versionId = String(campaign.plan_version_id ?? "");
  const planHash = String(campaign.plan_hash ?? "");
  const { data: plan } = await db.from("ad_plans").select("*")
    .eq("current_version_id", versionId).maybeSingle();
  if (!plan || !/^[0-9a-f]{64}$/.test(planHash)) {
    return json(
      { error: "plan_conflict", detail: "plan_binding_missing" },
      409,
    );
  }
  const { data: plannedCampaigns, error: campaignError } = await db
    .from("ad_campaigns").select("*")
    .eq("plan_version_id", versionId).eq("plan_hash", planHash)
    .order("platform");
  if (campaignError || !plannedCampaigns?.length) {
    return json(
      { error: "plan_conflict", detail: "plan_campaigns_missing" },
      409,
    );
  }
  if (action === "launch") {
    const { error: launchableError } = await db.rpc(
      "ad_plan_assert_launchable",
      {
        p_plan_version_id: versionId,
        p_plan_hash: planHash,
      },
    );
    if (launchableError) {
      return json({
        error: "launch_blocked",
        detail: launchableError.message,
      }, 409);
    }
    for (const row of plannedCampaigns) {
      if (startDateNotReached(row.starts_at ?? null)) {
        return json({
          error: "launch_blocked",
          detail: "start_date_not_reached",
        }, 409);
      }
      if (endDatePassed(row.ends_at ?? null)) {
        return json(
          { error: "launch_blocked", detail: "end_date_passed" },
          409,
        );
      }
      if (Number(row.cap_cents) > 0) {
        const { data: spendRows, error: spendError } = await db
          .from("ad_spend_daily").select("spend_cents")
          .eq("campaign_id", row.id);
        if (spendError) {
          return json(
            { error: "launch_blocked", detail: "spend_read_failed" },
            503,
          );
        }
        const totalSpend = sumSpendCents(
          (spendRows ?? []).map((item: { spend_cents?: unknown }) => ({
            spend_date: "1970-01-01",
            spend_cents: Number(item.spend_cents) || 0,
          })),
        );
        if (shouldPauseForCap(totalSpend, Number(row.cap_cents))) {
          return json(
            { error: "launch_blocked", detail: "hard_cap_reached" },
            409,
          );
        }
      }
    }
  } else if (["live", "partially_live"].includes(String(plan.state))) {
    const { error: stateError } = await db.from("ad_plans")
      .update({ state: "pause_requested" }).eq("id", plan.id);
    if (stateError) {
      return json(
        { error: "pause_failed", detail: "plan_state_write_failed" },
        503,
      );
    }
  }

  const outcomes: Array<Record<string, unknown>> = [];
  for (const row of plannedCampaigns) {
    const { data: connectionRow } = await db.from("ad_connections").select("*")
      .eq("id", row.connection_id).maybeSingle();
    if (!connectionRow?.connected || connectionRow.status !== "connected") {
      outcomes.push({
        platform: row.platform,
        ok: false,
        error: "not_connected",
      });
      continue;
    }
    const adapter = getAdapter(row.platform);
    const { data: adSets } = await db.from("ad_sets").select("*")
      .eq("campaign_id", row.id);
    const adSetIds = (adSets ?? []).map((item: Record<string, unknown>) =>
      String(item.id)
    );
    const { data: ads } = adSetIds.length
      ? await db.from("ads").select("*").in("ad_set_id", adSetIds)
      : { data: [] };
    const desired = action === "launch" ? "ACTIVE" : "PAUSED";
    try {
      await adapter.setStatus(
        connectionRow as AdConnectionRow,
        "campaign",
        row.external_campaign_id,
        desired,
      );
      if (action === "launch") {
        for (const adSet of adSets ?? []) {
          await adapter.setStatus(
            connectionRow as AdConnectionRow,
            "ad_set",
            String(adSet.external_adset_id),
            "ACTIVE",
          );
        }
        for (const ad of ads ?? []) {
          await adapter.setStatus(
            connectionRow as AdConnectionRow,
            "ad",
            String(ad.external_ad_id),
            "ACTIVE",
          );
        }
      }
      let effectiveStatus: string | null = null;
      try {
        const status = await adapter.getStatus(
          connectionRow as AdConnectionRow,
          "campaign",
          row.external_campaign_id,
        );
        effectiveStatus = status.effectiveStatus;
      } catch {
        effectiveStatus = null;
      }
      const nowIso = new Date().toISOString();
      await db.from("ad_campaigns").update({
        status: desired,
        delivery_status: effectiveStatus,
        status_synced_at: nowIso,
      }).eq("id", row.id);
      if (action === "launch" && adSetIds.length) {
        await db.from("ad_sets").update({ status: "ACTIVE" }).in(
          "id",
          adSetIds,
        );
        await db.from("ads").update({ status: "ACTIVE" }).in(
          "ad_set_id",
          adSetIds,
        );
      }
      await db.rpc("ad_record_provider_attempt", {
        p_plan_version_id: versionId,
        p_plan_hash: planHash,
        p_platform: row.platform,
        p_command: action === "launch" ? "activate" : "pause",
        p_idempotency_key: `admin:${planHash}:${action}:${row.platform}`,
        p_state: "succeeded",
        p_external_ids: { campaign_id: row.external_campaign_id },
        p_provider_response: { effective_status: effectiveStatus },
        p_error_detail: null,
      });
      await db.from("ad_status_events").insert({
        campaign_id: row.id,
        platform: row.platform,
        entity: "campaign",
        action,
        actor: actorId,
        from_status: row.status,
        to_status: desired,
        external_ids: { external_campaign_id: row.external_campaign_id },
        provider_response: {
          effective_status: effectiveStatus,
          ...(action === "launch"
            ? { launch_confirm: "LAUNCH", launch_reason: reason }
            : {}),
        },
      });
      outcomes.push({
        campaign_id: row.id,
        platform: row.platform,
        ok: true,
        status: desired,
        effective_status: effectiveStatus,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await db.rpc("ad_record_provider_attempt", {
        p_plan_version_id: versionId,
        p_plan_hash: planHash,
        p_platform: row.platform,
        p_command: action === "launch" ? "activate" : "pause",
        p_idempotency_key: `admin:${planHash}:${action}:${row.platform}`,
        p_state: "failed_retryable",
        p_external_ids: { campaign_id: row.external_campaign_id },
        p_provider_response: null,
        p_error_detail: detail.slice(0, 1000),
      });
      outcomes.push({
        campaign_id: row.id,
        platform: row.platform,
        ok: false,
        error: detail,
      });
    }
  }
  const successes = outcomes.filter((row) => row.ok === true).length;
  if (action === "launch" && successes > 0) {
    await db.from("ad_plans").update({
      state: successes === outcomes.length ? "live" : "partially_live",
    }).eq("id", plan.id);
  } else if (action === "pause") {
    await db.from("ad_plans").update({
      state: successes === outcomes.length
        ? "paused"
        : successes > 0
        ? "partially_live"
        : plan.state,
    }).eq("id", plan.id);
  }
  const { data: updatedCampaign } = await db.from("ad_campaigns").select("*")
    .eq("id", campaign.id).maybeSingle();
  return json({
    campaign: updatedCampaign ?? campaign,
    plan_id: plan.id,
    plan_state: action === "launch"
      ? (successes === outcomes.length
        ? "live"
        : successes > 0
        ? "partially_live"
        : plan.state)
      : (successes === outcomes.length
        ? "paused"
        : successes > 0
        ? "partially_live"
        : plan.state),
    outcomes,
    ...(successes !== outcomes.length
      ? {
        warning: `${
          outcomes.length - successes
        } platform action(s) need attention.`,
      }
      : {}),
  }, successes > 0 ? 200 : 502);
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // ── ADMIN GATE FIRST (QA P3-7: auth precedes input validation). ─────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jwt = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  const campaignId = typeof body.campaign_id === "string"
    ? body.campaign_id
    : "";
  const action = body.action;
  if (!UUID_REGEX.test(campaignId)) {
    return json({
      error: "validation_error",
      detail: "campaign_id_invalid_uuid",
    }, 400);
  }
  if (action !== "launch" && action !== "pause") {
    return json({ error: "validation_error", detail: "action_invalid" }, 400);
  }
  if (!adminRow && action !== "pause") {
    return json({ error: "forbidden" }, 403);
  }

  // Load the aggregate root before the owner-specific authorization. Admins
  // can operate any campaign; an explicitly authorized Host marketer may only
  // pause a Host-owned campaign for their own brand. Launch remains Admin-only
  // here, while the Host launch path uses the immutable-plan endpoint.
  const { data: campaign } = await supabase
    .from("ad_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) {
    return json({ error: "not_found", detail: "campaign_not_found" }, 404);
  }
  if (!adminRow) {
    const hostBrandId = typeof campaign.brand_id === "string"
      ? campaign.brand_id
      : "";
    if (campaign.owner_kind !== "host" || !UUID_REGEX.test(hostBrandId)) {
      return json({ error: "forbidden" }, 403);
    }
    const { data: canPause, error: pausePermissionError } = await supabase.rpc(
      "ad_can_host_action",
      {
        p_brand_id: hostBrandId,
        p_user_id: user.id,
        p_action: "pause",
      },
    );
    if (pausePermissionError || canPause !== true) {
      return json({ error: "forbidden" }, 403);
    }
  }

  // toward #3697 Wave 5 / #3704: LAUNCH is challenge-gated. Pause stays a
  // one-click stop. Missing or wrong confirm_phrase never reaches the adapter.
  const confirmPhrase = body.confirm_phrase;
  const launchReason = typeof body.reason === "string"
    ? body.reason.trim()
    : "";
  if (action === "launch" && !isLaunchConfirmPhrase(confirmPhrase)) {
    await notifyAdLaunchAttempt({
      source: "admin",
      outcome: "rejected",
      campaignId,
      brandId: null,
      platform: null,
      name: null,
      actorId: user.id,
      detail: "confirm_phrase_must_be_LAUNCH",
      idempotencyKey: `ads_launch:admin:${campaignId}:confirm_phrase`,
    });
    return json({
      error: "launch_confirm_required",
      detail: "confirm_phrase_must_be_LAUNCH",
    }, 400);
  }
  if (action === "launch" && launchReason.length === 0) {
    await notifyAdLaunchAttempt({
      source: "admin",
      outcome: "rejected",
      campaignId,
      brandId: null,
      platform: null,
      name: null,
      actorId: user.id,
      detail: "reason_required",
      idempotencyKey: `ads_launch:admin:${campaignId}:reason_required`,
    });
    return json({
      error: "launch_confirm_required",
      detail: "reason_required",
    }, 400);
  }

  const adminLaunchAlertBase = {
    source: "admin" as const,
    campaignId: String(campaign.id),
    brandId: typeof campaign.brand_id === "string" ? campaign.brand_id : null,
    platform: typeof campaign.platform === "string" ? campaign.platform : null,
    name: typeof campaign.name === "string" ? campaign.name : null,
    actorId: user.id,
    reason: launchReason.length > 0 ? launchReason : null,
  };

  const hasPlanBinding = typeof campaign.plan_version_id === "string" &&
    UUID_REGEX.test(campaign.plan_version_id) &&
    typeof campaign.plan_hash === "string" &&
    /^[0-9a-f]{64}$/.test(campaign.plan_hash);
  if (hasPlanBinding) {
    return runPlannedAction({
      db: supabase,
      campaign,
      action,
      actorId: user.id,
      reason: launchReason,
    });
  }
  if (action === "launch") {
    await notifyAdLaunchAttempt({
      ...adminLaunchAlertBase,
      outcome: "rejected",
      detail: "legacy_campaign_reconciliation_required",
      idempotencyKey: `ads_launch:admin:${campaignId}:legacy_reconciliation`,
    });
    return json({
      error: "launch_blocked",
      detail: "legacy_campaign_reconciliation_required",
    }, 409);
  }

  // `action` is necessarily pause below because planless launch is rejected
  // above. Keep the historical provider-action branch typed as the public
  // action union so its established launch semantics remain regression-testable
  // while reconciled campaigns are migrated onto immutable plans.
  const providerAction = body.action as "launch" | "pause";

  const { data: conn } = await supabase
    .from("ad_connections")
    .select("*")
    .eq("id", campaign.connection_id)
    .maybeSingle();
  if (!conn || !conn.connected || conn.status !== "connected") {
    if (providerAction === "launch") {
      await notifyAdLaunchAttempt({
        ...adminLaunchAlertBase,
        outcome: "rejected",
        detail: `${campaign.platform}_not_connected`,
        idempotencyKey: `ads_launch:admin:${campaignId}:not_connected`,
      });
    }
    return json({ error: `${campaign.platform}_not_connected` }, 424);
  }
  const connection = conn as unknown as AdConnectionRow;

  const { data: adSets } = await supabase
    .from("ad_sets")
    .select("*")
    .eq("campaign_id", campaign.id);
  const adSetIds = (adSets ?? []).map((s: Record<string, unknown>) =>
    String(s.id)
  );
  const { data: ads } = adSetIds.length > 0
    ? await supabase.from("ads").select("*").in("ad_set_id", adSetIds)
    : { data: [] };

  const adapter = getAdapter(campaign.platform);
  const fromStatus = String(campaign.status ?? "PAUSED");

  // toward #3697 Wave 2: launch must not reactivate before starts_at, past
  // ends_at, or already at/over the 98% hard-cap (spend feed is source of truth).
  if (providerAction === "launch") {
    const startsAt = typeof campaign.starts_at === "string"
      ? campaign.starts_at
      : null;
    if (startDateNotReached(startsAt)) {
      await notifyAdLaunchAttempt({
        ...adminLaunchAlertBase,
        outcome: "rejected",
        detail: "start_date_not_reached",
        idempotencyKey: `ads_launch:admin:${campaignId}:start_date`,
      });
      return json({
        error: "launch_blocked",
        detail: "start_date_not_reached",
        starts_at: startsAt,
      }, 409);
    }
    const endsAt = typeof campaign.ends_at === "string"
      ? campaign.ends_at
      : null;
    if (endDatePassed(endsAt)) {
      await notifyAdLaunchAttempt({
        ...adminLaunchAlertBase,
        outcome: "rejected",
        detail: "end_date_passed",
        idempotencyKey: `ads_launch:admin:${campaignId}:end_date`,
      });
      return json({
        error: "launch_blocked",
        detail: "end_date_passed",
        ends_at: endsAt,
      }, 409);
    }
    const capCents = typeof campaign.cap_cents === "number"
      ? campaign.cap_cents
      : null;
    if (capCents != null && capCents > 0) {
      const { data: spendRows, error: spendErr } = await supabase
        .from("ad_spend_daily")
        .select("spend_cents")
        .eq("campaign_id", campaign.id);
      if (spendErr) {
        await notifyAdLaunchAttempt({
          ...adminLaunchAlertBase,
          outcome: "failed",
          detail: "spend_read_failed",
          idempotencyKey: `ads_launch:admin:${campaignId}:spend_read`,
        });
        return json({
          error: "launch_blocked",
          detail: "spend_read_failed",
          message: spendErr.message,
        }, 503);
      }
      const totalSpend = sumSpendCents(
        (spendRows ?? []).map((row: { spend_cents?: unknown }) => ({
          spend_date: "1970-01-01",
          spend_cents: Number(row.spend_cents) || 0,
        })),
      );
      if (shouldPauseForCap(totalSpend, capCents)) {
        await notifyAdLaunchAttempt({
          ...adminLaunchAlertBase,
          outcome: "rejected",
          detail: "hard_cap_reached",
          idempotencyKey: `ads_launch:admin:${campaignId}:hard_cap`,
        });
        return json({
          error: "launch_blocked",
          detail: "hard_cap_reached",
          total_spend_cents: totalSpend,
          cap_cents: capCents,
        }, 409);
      }
    }
  }

  try {
    if (providerAction === "launch") {
      // Top-down: campaign → ad sets → ads (§4.0 launch order).
      await adapter.setStatus(
        connection,
        "campaign",
        campaign.external_campaign_id,
        "ACTIVE",
      );
      for (const adSet of adSets ?? []) {
        await adapter.setStatus(
          connection,
          "ad_set",
          String(adSet.external_adset_id),
          "ACTIVE",
        );
      }
      for (const ad of ads ?? []) {
        await adapter.setStatus(
          connection,
          "ad",
          String(ad.external_ad_id),
          "ACTIVE",
        );
      }
    } else {
      await adapter.setStatus(
        connection,
        "campaign",
        campaign.external_campaign_id,
        "PAUSED",
      );
    }

    // Read back delivery state.
    let effectiveStatus: string | null = null;
    try {
      const status = await adapter.getStatus(
        connection,
        "campaign",
        campaign.external_campaign_id,
      );
      effectiveStatus = status.effectiveStatus;
    } catch {
      effectiveStatus = null; // best-effort; sync repairs it
    }

    const toStatus = providerAction === "launch" ? "ACTIVE" : "PAUSED";
    const nowIso = new Date().toISOString();
    const { data: updated } = await supabase
      .from("ad_campaigns")
      .update({
        status: toStatus,
        delivery_status: effectiveStatus,
        status_synced_at: nowIso,
      })
      .eq("id", campaign.id)
      .select("*")
      .maybeSingle();
    if (providerAction === "launch") {
      if (adSetIds.length > 0) {
        await supabase.from("ad_sets").update({ status: "ACTIVE" }).in(
          "id",
          adSetIds,
        );
        await supabase.from("ads").update({ status: "ACTIVE" }).in(
          "ad_set_id",
          adSetIds,
        );
      }
    }

    await supabase.from("ad_status_events").insert({
      campaign_id: campaign.id,
      platform: campaign.platform,
      entity: "campaign",
      action: providerAction,
      actor: user.id,
      from_status: fromStatus,
      to_status: toStatus,
      external_ids: { external_campaign_id: campaign.external_campaign_id },
      provider_response: {
        ...(effectiveStatus ? { effective_status: effectiveStatus } : {}),
        ...(providerAction === "launch"
          ? { launch_confirm: "LAUNCH", launch_reason: launchReason }
          : {}),
      },
    });

    // Per-platform delivery-warning vocabularies — the Meta branch is
    // byte-identical to WP1; Reddit (WP6) reads the AD's effective_status;
    // TikTok (WP7, A1.0-1) maps its prefixed secondary statuses —
    // BALANCE_EXCEED is the analog of PENDING_BILLING_INFO; always
    // 200 + warning, never a silent clamp.
    let warning: string | undefined;
    if (providerAction === "launch" && campaign.platform === "reddit") {
      // ISSUE-916 WP6 (§3.6/#867 precedent): Reddit's review state lives on
      // the AD's effective_status (R-3) — read it back and return 200 +
      // `warning` while review/billing gates delivery (launch is accepted).
      let adEffectiveStatus: string | null = null;
      const firstAd = (ads ?? [])[0];
      if (firstAd) {
        try {
          const adStatus = await adapter.getStatus(
            connection,
            "ad",
            String(firstAd.external_ad_id),
          );
          adEffectiveStatus = adStatus.effectiveStatus;
        } catch {
          adEffectiveStatus = null; // best-effort; sync repairs it
        }
      }
      warning = redditLaunchWarning(adEffectiveStatus ?? effectiveStatus) ??
        undefined;
    } else if (
      providerAction === "launch" && campaign.platform === "snapchat"
    ) {
      // ISSUE-867 WP5 (AC-S-5 as tightened by A1.4): the warning keys off BOTH
      // review vocabularies — the AD enum (PENDING|APPROVED|REJECTED) AND the
      // CREATIVE enum (PENDING_REVIEW|APPROVED). Launch stays 200; review is
      // Snap's delivery state, not our error (3–5 business days, no SLA; Snap
      // re-reviews post-launch — the GR-38 sync cron keeps both fresh).
      let adReviewStatus: string | null = null;
      let creativeReviewStatus: string | null = null;
      const firstAd = (ads ?? [])[0];
      if (firstAd) {
        try {
          const adStatus = await adapter.getStatus(
            connection,
            "ad",
            String(firstAd.external_ad_id),
          );
          adReviewStatus = adStatus.effectiveStatus;
          const feedback = adStatus.adReviewFeedback ?? null;
          creativeReviewStatus =
            feedback && typeof feedback.creative_review_status === "string"
              ? feedback.creative_review_status
              : null;
        } catch {
          adReviewStatus = null; // best-effort; sync repairs it
        }
      }
      warning = snapchatLaunchWarning(adReviewStatus, creativeReviewStatus) ??
        undefined;
    } else if (
      providerAction === "launch" && campaign.platform === "tiktok" &&
      effectiveStatus
    ) {
      warning = tiktokLaunchWarning(effectiveStatus) ?? undefined;
    } else if (
      providerAction === "launch" && effectiveStatus &&
      WARNING_STATUSES.includes(effectiveStatus)
    ) {
      warning =
        `Launched, but delivery is blocked upstream: effective_status=${effectiveStatus}. ` +
        (effectiveStatus === "PENDING_BILLING_INFO"
          ? "Add a payment method in Meta Ads Manager."
          : "Check Meta Ads Manager for review detail.");
    }

    if (providerAction === "launch") {
      await notifyAdLaunchAttempt({
        ...adminLaunchAlertBase,
        outcome: "accepted",
        detail: warning ?? "launched",
        idempotencyKey: `ads_launch:admin:${campaignId}:accepted`,
      });
    }
    return json({
      campaign: updated ?? campaign,
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    if (providerAction === "launch") {
      const failDetail = err instanceof AdApiError
        ? `${campaign.platform}_action_failed`
        : err instanceof Error
        ? err.message
        : String(err);
      await notifyAdLaunchAttempt({
        ...adminLaunchAlertBase,
        outcome: "failed",
        detail: failDetail.slice(0, 500),
        idempotencyKey: `ads_launch:admin:${campaignId}:failed`,
      });
    }
    if (err instanceof AdNotConnectedError) {
      return json({ error: `${campaign.platform}_not_connected` }, 424);
    }
    if (err instanceof AdApiError) {
      return json({
        error: `${campaign.platform}_action_failed`,
        detail: err.toJSON(),
      }, 502);
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[admin-ad-campaign-action] unexpected:", detail);
    return json({ error: "internal_error" }, 500);
  }
});
