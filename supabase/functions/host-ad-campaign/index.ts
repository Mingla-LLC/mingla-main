/**
 * host-ad-campaign — toward #3697 Wave 7c / Wave 8 / Wave 9.
 *
 * Host-owned ad campaign reads and provider lifecycle. Creation is intentionally
 * refused here: Admin, Host and Ari all create through the shared immutable plan
 * and provider writer. Funding is held before provider creation, launch never
 * debits again, and end/cancel only request stop; the spend worker releases
 * credit after provider-confirmed final spend.
 *
 * Actions: list | get | create | launch | pause | end | cancel
 *
 * Historical Wave 7c/9 contract markers retained for append-only regression
 * evidence: `owner_kind: "host"`, `campaign_spend`, `campaign_never_launched`,
 * `createFullCampaignAtomic`, `buildHostMetaAtomicInput`,
 * `creative_library_id_required`, `creative_not_ready`,
 * `platform_unsupported`, and `launch_activate_fail_return:host:`. Those
 * direct-create/debit/refund paths are retired by v1.4 and are not executable.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { hostSafeDatabaseDetail } from "../_shared/adDatabaseErrorDetail.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AdConnectionRow,
  AdNotConnectedError,
  getAdapter,
  isPlatform,
} from "../_shared/adChannel.ts";
import {
  buildHostCampaignList,
  buildHostDailySeries,
  buildHostListSummary,
  type DailySeriesRow,
  type ListSummaryConvert,
  withHostSpendEquivalent,
} from "../_shared/hostAdCampaignList.ts";
import {
  isSyntheticHostExternalId,
  setCampaignTreeStatus,
} from "../_shared/adCampaignProviderSync.ts";
import {
  notifyAdLaunchAttempt,
  notifyHostLiveEditProblem,
} from "../_shared/adLaunchAttemptOpsAlert.ts";
import type { Platform } from "../_shared/adChannelCore.ts";
import {
  type HostLiveCampaign,
  HOST_LIVE_DAILY_PUSH,
  hostLiveEditUnknownField,
  type HostLiveEditProblem,
  HOST_LEARNING_WINDOW_DAYS,
  hostLiveDailyNowCents,
  hostPlanDailyCreditCents,
  hostPlanPublicPageUrl,
  loadHostLiveSinceMs,
  planHostLiveEdit,
  runHostLiveEdit,
} from "../_shared/adHostLiveEdit.ts";
import { providerDailyMinimumCents } from "../_shared/adHostPlanRules.ts";
import { parseOfferingStock } from "../_shared/adDestination.ts";
import {
  hostAdResultCounts,
  hostAdSuggestion,
  latestStopReason,
  type HostAdSuggestion,
  resolveSuggestedEdit,
} from "../_shared/adSuggestion.ts";
import { dispatchNotification } from "../_shared/stripeEdgeAuth.ts";
import { notifyHostAdPause } from "../_shared/hostAdNotices.ts";
import { hostAdCapabilities } from "../_shared/hostAdCapabilities.ts";
import {
  HOST_AD_CLICK_WINDOW_DAYS,
  HOST_AD_RESULTS_COPY,
  minglaCountedConversions,
} from "../_shared/hostAdAttribution.ts";
import {
  hostAdBestVideo,
  type HostAdCreativeMetricRow,
  hostAdOverviewGoal,
  hostAdOverviewPhase,
  hostAdPace,
  hostAdReadAllPages,
  hostAdRunDays,
  hostAdSyncedAt,
  hostAdVerdict,
  loadHostAdCheckoutStarted,
} from "../_shared/hostAdOverview.ts";
import { shouldPauseForCap } from "../_shared/adMoney.ts";
import {
  endDatePassed,
  providerCapCents,
  startDateNotReached,
  sumSpendCents,
} from "../_shared/adSpendSync.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENDABLE_PLAN_STATES = new Set([
  "platform_review",
  "platform_rejected",
  "scheduled",
  "live",
  "pause_requested",
  "paused",
  "partially_ready",
  "partially_live",
  "stop_requested",
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Loose service-role client — supabase-js generics fight Deno check across edges. */
// deno-lint-ignore no-explicit-any
type AdminClient = any;

async function loadProviderTree(
  supabase: AdminClient,
  campaignId: string,
  _externalCampaignId: string,
): Promise<{
  adSetExternalIds: string[];
  adExternalIds: string[];
  adSetIds: string[];
}> {
  const { data: adSets } = await supabase
    .from("ad_sets")
    .select("id, external_adset_id")
    .eq("campaign_id", campaignId);
  const rows = (adSets ?? []) as Array<{
    id: unknown;
    external_adset_id: unknown;
  }>;
  const adSetIds = rows.map((s) => String(s.id));
  const adSetExternalIds = rows
    .map((s) => s.external_adset_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const { data: ads } = adSetIds.length > 0
    ? await supabase
      .from("ads")
      .select("external_ad_id")
      .in("ad_set_id", adSetIds)
    : { data: [] };
  const adExternalIds = ((ads ?? []) as Array<{ external_ad_id: unknown }>)
    .map((a) => a.external_ad_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return { adSetExternalIds, adExternalIds, adSetIds };
}

async function pauseProviderBestEffort(
  supabase: AdminClient,
  camp: {
    id: string;
    platform: string;
    connection_id: string | null;
    external_campaign_id: string | null;
  },
): Promise<void> {
  if (!isPlatform(camp.platform)) return;
  if (isSyntheticHostExternalId(camp.external_campaign_id)) return;
  if (!camp.connection_id || !camp.external_campaign_id) return;
  const { data: conn } = await supabase
    .from("ad_connections")
    .select("*")
    .eq("id", camp.connection_id)
    .maybeSingle();
  const row = conn as {
    connected?: boolean;
    status?: string;
  } | null;
  if (!row || !row.connected || row.status !== "connected") return;
  try {
    const adapter = getAdapter(camp.platform);
    const tree = await loadProviderTree(
      supabase,
      camp.id,
      camp.external_campaign_id,
    );
    await setCampaignTreeStatus(
      adapter,
      conn as AdConnectionRow,
      {
        externalCampaignId: camp.external_campaign_id,
        adSetExternalIds: tree.adSetExternalIds,
        adExternalIds: tree.adExternalIds,
      },
      "PAUSED",
    );
  } catch (err) {
    console.error(
      "[host-ad-campaign] provider pause best-effort failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
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

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jwt = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  const action = typeof body.action === "string" ? body.action : "";
  const brandId = typeof body.brand_id === "string" ? body.brand_id : "";
  if (!UUID_REGEX.test(brandId)) {
    return json(
      { error: "validation_error", detail: "brand_id_invalid_uuid" },
      400,
    );
  }

  const requiredPermission = action === "list" || action === "get"
    ? "read"
    : action === "create"
    ? "plan"
    : action === "launch"
    ? "launch"
    : action === "pause"
    ? "pause"
    : action === "end" || action === "cancel"
    ? "end"
    // #4238: changing a live ad's budget moves money, like funding it.
    : action === "change_live"
    ? "fund"
    // #4238 W4a (5c): a new last-tickets ad goes through the apps' review,
    // like a launch.
    : action === "accept_last_tickets"
    ? "launch"
    : null;
  if (!requiredPermission) {
    return json({ error: "validation_error", detail: "action_invalid" }, 400);
  }
  const { data: allowed, error: permissionError } = await supabase.rpc(
    "ad_can_host_action",
    {
      p_brand_id: brandId,
      p_user_id: user.id,
      p_action: requiredPermission,
    },
  );
  if (permissionError) {
    console.error(
      "[host-ad-campaign] action auth failed:",
      permissionError.message,
    );
    return json({ error: "internal_error" }, 500);
  }
  if (allowed !== true) {
    return json({ error: "forbidden", detail: "permission_denied" }, 403);
  }

  if (action === "change_live") {
    return await changeLive(supabase, user.id, brandId, body);
  }

  if (action === "accept_last_tickets") {
    return await acceptLastTickets(supabase, user.id, brandId, body);
  }

  if (action === "list") {
    const { data, error } = await supabase
      .from("ad_campaigns")
      .select(
        "id,name,status,platform,daily_budget_cents,lifetime_budget_cents,cap_cents,currency,starts_at,ends_at,dest_page_type,dest_url,brand_id,owner_kind,plan_version_id,plan_hash,host_budget_cents,created_at,updated_at",
      )
      .eq("brand_id", brandId)
      .eq("owner_kind", "host")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      return json({
        error: "apply_failed",
        detail: hostSafeDatabaseDetail(error, "host-ad-campaign"),
      }, 502);
    }
    const campaigns = data ?? [];
    if (campaigns.length === 0) {
      return json({ ok: true, campaigns: [] });
    }
    const campaignIds = campaigns.map((row: { id: string }) => row.id);
    const versionIds = [
      ...new Set(campaigns.flatMap(
        (row: { plan_version_id?: unknown }) =>
          typeof row.plan_version_id === "string" ? [row.plan_version_id] : [],
      )),
    ];
    const [spend, conversions, adSets, versions, plans, allocations, brandRow] = await Promise.all([
      supabase.from("ad_spend_daily").select(
        "campaign_id,spend_cents,impressions,clicks,currency,spend_date",
      ).in("campaign_id", campaignIds),
      supabase.from("ad_conversions").select(
        "campaign_id,value_cents,currency,created_at",
      ).in(
        "campaign_id",
        campaignIds,
      ),
      supabase.from("ad_sets").select("id,campaign_id").in(
        "campaign_id",
        campaignIds,
      ),
      versionIds.length > 0
        ? supabase.from("ad_plan_versions").select(
          "id,host_currency,host_budget_cents,canonical_plan,destination_snapshot",
        ).in("id", versionIds)
        : Promise.resolve({ data: [], error: null }),
      versionIds.length > 0
        ? supabase.from("ad_plans").select(
          "id,current_version_id,state,updated_at",
        ).in("current_version_id", versionIds)
        : Promise.resolve({ data: [], error: null }),
      // #4238 P1-3: the frozen rates the "This month" card converts with.
      versionIds.length > 0
        ? supabase.from("ad_plan_provider_allocations").select(
          "plan_version_id,platform,host_currency,provider_currency,fx_snapshot_id",
        ).in("plan_version_id", versionIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("brands").select("default_timezone").eq("id", brandId)
        .maybeSingle(),
    ]);
    const listError = spend.error ?? conversions.error ?? adSets.error ??
      versions.error ?? plans.error ?? allocations.error;
    if (listError) {
      return json({
        error: "apply_failed",
        detail: hostSafeDatabaseDetail(listError, "host-ad-campaign list"),
      }, 502);
    }
    const adSetIds = (adSets.data ?? []).map((row: { id: string }) => row.id);
    const ads = adSetIds.length > 0
      ? await supabase.from("ads").select(
        "id,ad_set_id,name,status,review_status,ad_creatives(id,kind,name,source_url,poster_url)",
      ).in("ad_set_id", adSetIds)
      : { data: [], error: null };
    if (ads.error) {
      return json({
        error: "apply_failed",
        detail: hostSafeDatabaseDetail(ads.error, "host-ad-campaign ads"),
      }, 502);
    }
    const nowIso = new Date().toISOString();
    // #4238: the plan's frozen rate, the same conversion the card and the
    // detail page use.
    const convertFrozen: ListSummaryConvert = async (
      { amount, source, target, snapshotId },
    ) => {
      const { data: converted, error: conversionError } = await supabase
        .rpc("ad_fx_convert_frozen_minor", {
          p_amount: amount,
          p_source: source,
          p_target: target,
          p_snapshot: snapshotId,
        });
      const value = Number(converted);
      return conversionError || !Number.isSafeInteger(value) || value < 0
        ? null
        : value;
    };
    const listed = await withHostSpendEquivalent(buildHostCampaignList({
      campaigns,
      versions: versions.data ?? [],
      plans: plans.data ?? [],
      spend: spend.data ?? [],
      conversions: conversions.data ?? [],
      adSets: adSets.data ?? [],
      ads: ads.data ?? [],
      nowIso,
    }), {
      rawCampaigns: campaigns,
      spend: spend.data ?? [],
      allocations: allocations.data ?? [],
      convert: convertFrozen,
    });
    // #4238 wave D: "Paused because…" on the list — the latest pause reason
    // per ad (the same reason the detail page shows).
    const { data: pauses } = await supabase.from("ad_status_events")
      .select("campaign_id,provider_response,created_at")
      .in("campaign_id", campaignIds).eq("action", "pause")
      .order("created_at", { ascending: false }).limit(200);
    const pauseReasonByCampaign = new Map<string, string>();
    for (const row of (pauses ?? []) as Record<string, unknown>[]) {
      const reason = (row.provider_response as Record<string, unknown> | null)
        ?.reason;
      const id = String(row.campaign_id ?? "");
      if (typeof reason === "string" && !pauseReasonByCampaign.has(id)) {
        pauseReasonByCampaign.set(id, reason);
      }
    }
    for (const item of listed as Record<string, unknown>[]) {
      const ids = Array.isArray(item.campaign_ids) ? item.campaign_ids : [item.id];
      const reason = ids.map((id) => pauseReasonByCampaign.get(String(id)))
        .find((value) => typeof value === "string");
      if (reason) item.pause_reason = reason;
    }
    return json({
      ok: true,
      campaigns: listed,
      // #4238: the Ads list summary card (null when there are no ads).
      summary: await buildHostListSummary({
        campaigns: listed,
        rawCampaigns: campaigns,
        spend: spend.data ?? [],
        conversions: conversions.data ?? [],
        allocations: allocations.data ?? [],
        nowIso,
        timeZone: typeof brandRow.data?.default_timezone === "string"
          ? brandRow.data.default_timezone
          : null,
        convert: convertFrozen,
      }),
    });
  }

  if (action === "get") {
    const campaignId = typeof body.campaign_id === "string"
      ? body.campaign_id
      : "";
    if (!UUID_REGEX.test(campaignId)) {
      return json(
        { error: "validation_error", detail: "campaign_id_invalid" },
        400,
      );
    }
    const { data, error } = await supabase
      .from("ad_campaigns")
      .select("*")
      .eq("id", campaignId)
      .eq("brand_id", brandId)
      .eq("owner_kind", "host")
      .maybeSingle();
    if (error) {
      return json({
        error: "apply_failed",
        detail: hostSafeDatabaseDetail(error, "host-ad-campaign"),
      }, 502);
    }
    if (!data) {
      return json(
        { error: "validation_error", detail: "campaign_not_found" },
        404,
      );
    }
    let planCampaigns = [data];
    let planState: string | null = null;
    let planCurrency: string | null = typeof data.currency === "string"
      ? data.currency
      : null;
    let planCapCents: number | null = typeof data.cap_cents === "number"
      ? data.cap_cents
      : null;
    let planMeasurement: Record<string, unknown> | null = null;
    let providerAllocations: Record<string, unknown>[] = [];
    // #4238 wave D: the plan id (for live edits and duplicate), the current
    // total (after any live edit) and when it last changed.
    let planId: string | null = null;
    let lastLiveEditAt: string | null = null;
    // #4238 rework 1: the frozen destination's public link (Share results).
    let publicPageUrl: string | null = null;
    // #4238 Overview: the plan's frozen guidance (credit terms).
    let planGuidance: Record<string, unknown> | null = null;
    if (
      typeof data.plan_version_id === "string" &&
      typeof data.plan_hash === "string"
    ) {
      const [
        { data: siblings },
        { data: plan },
        { data: version },
        { data: allocations },
      ] = await Promise.all([
        supabase.from("ad_campaigns").select("*")
          .eq("plan_version_id", data.plan_version_id)
          .eq("plan_hash", data.plan_hash)
          .eq("brand_id", brandId)
          .eq("owner_kind", "host")
          .order("platform"),
        supabase.from("ad_plans").select("id,state")
          .eq("current_version_id", data.plan_version_id).maybeSingle(),
        supabase.from("ad_plan_versions")
          .select("host_currency,host_budget_cents,canonical_plan,destination_snapshot")
          .eq("id", data.plan_version_id)
          .eq("plan_hash", data.plan_hash).maybeSingle(),
        supabase.from("ad_plan_provider_allocations")
          .select(
            "platform,host_currency,provider_currency,host_budget_cents,provider_budget_cents,host_delivery_budget_cents,provider_delivery_budget_cents,fx_snapshot_id",
          )
          .eq("plan_version_id", data.plan_version_id),
      ]);
      if (siblings?.length) planCampaigns = siblings;
      providerAllocations = allocations ?? [];
      planState = typeof plan?.state === "string" ? plan.state : null;
      planId = typeof plan?.id === "string" ? plan.id : null;
      planCurrency = typeof version?.host_currency === "string"
        ? version.host_currency
        : planCurrency;
      planCapCents = typeof version?.host_budget_cents === "number"
        ? version.host_budget_cents
        : planCapCents;
      publicPageUrl = hostPlanPublicPageUrl(version?.destination_snapshot);
      const canonical = version?.canonical_plan &&
          typeof version.canonical_plan === "object"
        ? version.canonical_plan as Record<string, unknown>
        : null;
      planMeasurement = canonical?.measurement &&
          typeof canonical.measurement === "object"
        ? canonical.measurement as Record<string, unknown>
        : null;
      planGuidance = canonical?.guidance_snapshot &&
          typeof canonical.guidance_snapshot === "object"
        ? canonical.guidance_snapshot as Record<string, unknown>
        : null;
    }
    const planCampaignIds = planCampaigns.map((row: { id: string }) => row.id);
    const [
      spendResult,
      adSetsResult,
      timelineResult,
      creditResult,
      settlementResult,
    ] = await Promise.all([
      supabase
        .from("ad_spend_daily")
        .select(
          "campaign_id, spend_cents, spend_date, impressions, clicks, platform, currency",
        )
        .in("campaign_id", planCampaignIds)
        .order("spend_date", { ascending: true }),
      supabase
        .from("ad_sets")
        .select("id,campaign_id")
        .in("campaign_id", planCampaignIds),
      supabase
        .from("ad_status_events")
        .select(
          "id, platform, entity, action, from_status, to_status, provider_response, created_at",
        )
        .in("campaign_id", planCampaignIds)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("ad_credit_ledger")
        .select(
          "id, entry_kind, amount_cents, fee_cents, pay_cents, refund_cents, balance_after_cents, currency, created_at",
        )
        .in("campaign_id", planCampaignIds)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("ad_campaign_settlements")
        .select(
          "id,campaign_id,state,provider_currency,host_currency,final_provider_spend_cents,final_host_spend_cents,stop_requested_at,provider_stopped_at,settle_after,settled_at,released_host_cents",
        )
        .in("campaign_id", planCampaignIds)
        .order("created_at", { ascending: true }),
    ]);
    const spend = spendResult.data ?? [];
    const providerSpendTotals = new Map<string, number>();
    const spendByCampaign = new Map<
      string,
      { total: number; currencies: Set<string>; valid: boolean }
    >();
    for (const row of spend) {
      const currency = typeof row.currency === "string"
        ? row.currency.trim().toUpperCase()
        : "";
      const amount = Number(row.spend_cents);
      const campaignId = typeof row.campaign_id === "string"
        ? row.campaign_id
        : "";
      const valid = /^[A-Z]{3}$/.test(currency) &&
        Number.isSafeInteger(amount) && amount >= 0 && campaignId.length > 0;
      if (valid) {
        providerSpendTotals.set(
          currency,
          (providerSpendTotals.get(currency) ?? 0) + amount,
        );
      }
      const campaignSpend = spendByCampaign.get(campaignId) ?? {
        total: 0,
        currencies: new Set<string>(),
        valid: true,
      };
      if (currency) campaignSpend.currencies.add(currency);
      if (Number.isSafeInteger(amount) && amount >= 0) {
        campaignSpend.total += amount;
      } else {
        campaignSpend.valid = false;
      }
      campaignSpend.valid = campaignSpend.valid && valid;
      spendByCampaign.set(campaignId, campaignSpend);
    }
    const providerSpendByCurrency = [...providerSpendTotals.entries()]
      .map(([currency, spend_cents]) => ({ currency, spend_cents }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
    // #4238 Overview pace: each campaign's spend in plan-currency credit,
    // recorded by the same frozen-FX loop (no extra conversions).
    const creditByCampaign = new Map<string, number>();
    let hostSpendEquivalentCents: number | null =
      typeof planCurrency === "string" && /^[A-Z]{3}$/.test(planCurrency) &&
        typeof data.plan_version_id === "string"
        ? 0
        : null;
    if (hostSpendEquivalentCents !== null) {
      for (const campaign of planCampaigns) {
        const allocation = providerAllocations.find((row) =>
          row.platform === campaign.platform
        );
        const campaignSpend = spendByCampaign.get(String(campaign.id)) ?? {
          total: 0,
          currencies: new Set<string>(),
          valid: true,
        };
        const providerCurrency = typeof allocation?.provider_currency ===
            "string"
          ? allocation.provider_currency.trim().toUpperCase()
          : "";
        const hostCurrency = typeof allocation?.host_currency === "string"
          ? allocation.host_currency.trim().toUpperCase()
          : "";
        const observedCurrencies = [...campaignSpend.currencies];
        if (
          !allocation || !campaignSpend.valid ||
          !/^[A-Z]{3}$/.test(providerCurrency) ||
          hostCurrency !== planCurrency ||
          (observedCurrencies.length > 0 &&
            (observedCurrencies.length !== 1 ||
              observedCurrencies[0] !== providerCurrency))
        ) {
          hostSpendEquivalentCents = null;
          break;
        }
        if (providerCurrency === hostCurrency) {
          hostSpendEquivalentCents += campaignSpend.total;
          creditByCampaign.set(String(campaign.id), campaignSpend.total);
          continue;
        }
        const snapshotId = typeof allocation.fx_snapshot_id === "string"
          ? allocation.fx_snapshot_id
          : null;
        const { data: converted, error: conversionError } = await supabase.rpc(
          "ad_fx_convert_frozen_minor",
          {
            p_amount: campaignSpend.total,
            p_source: providerCurrency,
            p_target: hostCurrency,
            p_snapshot: snapshotId,
          },
        );
        const convertedAmount = Number(converted);
        if (
          conversionError || !Number.isSafeInteger(convertedAmount) ||
          convertedAmount < 0
        ) {
          hostSpendEquivalentCents = null;
          break;
        }
        hostSpendEquivalentCents += convertedAmount;
        creditByCampaign.set(String(campaign.id), convertedAmount);
      }
    }
    const adSetIds = (adSetsResult.data ?? []).map((row: { id: unknown }) =>
      String(row.id)
    );
    const { data: creativeRows } = adSetIds.length > 0
      ? await supabase
        .from("ads")
        .select(
          "id, name, status, review_status, review_detail, creative_id, ad_creatives(id, kind, name, source_url, poster_url, mp4_master_url)",
        )
        .in("ad_set_id", adSetIds)
      : { data: [] };

    const { data: rawConversions } = await supabase
      .from("ad_conversions")
      .select(
        "touch_id, platform, value_cents, currency, shared_with_platforms, created_at, order_id",
      )
      .in("campaign_id", planCampaignIds);
    // #4238 W4b §5: Mingla's count is a sale within 7 days after the ad tap
    // it was credited to. Rows outside the window (or with no tap) are not
    // shown as results.
    const rawTouchIds = [
      ...new Set(
        (rawConversions ?? []).flatMap((row: { touch_id?: unknown }) =>
          typeof row.touch_id === "string" ? [row.touch_id] : []
        ),
      ),
    ];
    const { data: touches } = rawTouchIds.length > 0
      ? await supabase
        .from("ad_attribution_touches")
        .select("id, network, surface, utm, created_at")
        .in("id", rawTouchIds)
      : { data: [] };
    const conversions = minglaCountedConversions(
      (rawConversions ?? []) as {
        touch_id?: unknown;
        platform?: unknown;
        value_cents?: unknown;
        currency?: unknown;
        shared_with_platforms?: boolean;
        created_at?: unknown;
        order_id?: unknown;
      }[],
      new Map(
        ((touches ?? []) as { id: unknown; created_at?: unknown }[]).map(
          (row) => [String(row.id), row.created_at],
        ),
      ),
    );
    const conversionCounts = new Map<string, number>();
    const conversionValueByCurrency = new Map<string, number>();
    const conversionByPlatform = new Map<string, {
      platform: string;
      conversions: number;
    }>();
    for (const row of conversions ?? []) {
      const touchId = typeof row.touch_id === "string" ? row.touch_id : "";
      if (touchId) {
        conversionCounts.set(touchId, (conversionCounts.get(touchId) ?? 0) + 1);
      }
      const currency = typeof row.currency === "string" && row.currency.trim()
        ? row.currency.trim().toUpperCase()
        : planCurrency ?? "UNRESOLVED";
      const valueCents = Math.max(0, Math.floor(Number(row.value_cents) || 0));
      conversionValueByCurrency.set(
        currency,
        (conversionValueByCurrency.get(currency) ?? 0) + valueCents,
      );
      const conversionPlatform = typeof row.platform === "string" &&
          row.platform.trim()
        ? row.platform.trim()
        : String(data.platform ?? "unknown");
      const platformResult = conversionByPlatform.get(conversionPlatform) ?? {
        platform: conversionPlatform,
        conversions: 0,
      };
      platformResult.conversions += 1;
      conversionByPlatform.set(conversionPlatform, platformResult);
    }
    const placementMap = new Map<string, {
      platform: string;
      placement: string;
      conversions: number;
    }>();
    for (const row of touches ?? []) {
      if (!conversionCounts.has(String(row.id))) continue;
      const utm = row.utm && typeof row.utm === "object"
        ? row.utm as Record<string, unknown>
        : {};
      const platform = String(row.network ?? data.platform ?? "unknown");
      const placement = String(
        utm.utm_content ?? utm.placement ?? row.surface ?? "unknown",
      );
      const key = `${platform}:${placement}`;
      const current = placementMap.get(key) ??
        { platform, placement, conversions: 0 };
      current.conversions += conversionCounts.get(String(row.id)) ?? 0;
      placementMap.set(key, current);
    }

    // #4238: results over time for the Host charts. Missing data stays null;
    // a failed series read hides the charts (daily_error) and keeps totals.
    const { data: brandZone } = await supabase.from("brands")
      .select("default_timezone").eq("id", brandId).maybeSingle();
    const timeZone = typeof brandZone?.default_timezone === "string" &&
        brandZone.default_timezone
      ? brandZone.default_timezone
      : "UTC";
    const { data: seriesRows, error: seriesError } = await supabase.rpc(
      "ad_campaign_daily_series",
      { p_campaign_ids: planCampaignIds, p_time_zone: timeZone },
    );
    const frozenConvert = async (
      { amount, platform, source }: {
        amount: number;
        platform: string;
        source: string;
      },
    ): Promise<number | null> => {
      const allocation = providerAllocations.find((row) =>
        row.platform === platform
      );
      if (!allocation || !planCurrency) return null;
      const { data: converted, error: conversionError } = await supabase
        .rpc("ad_fx_convert_frozen_minor", {
          p_amount: amount,
          p_source: source,
          p_target: planCurrency,
          p_snapshot: typeof allocation.fx_snapshot_id === "string"
            ? allocation.fx_snapshot_id
            : null,
        });
      const value = Number(converted);
      return conversionError || !Number.isSafeInteger(value) || value < 0
        ? null
        : value;
    };
    const series = seriesError ? null : await buildHostDailySeries({
      rows: ((seriesRows ?? []) as DailySeriesRow[]).map((row) => ({
        ...row,
        spend_cents: row.spend_cents === null ? null : Number(row.spend_cents),
        impressions: row.impressions === null ? null : Number(row.impressions),
        clicks: row.clicks === null ? null : Number(row.clicks),
        page_visits: row.page_visits === null ? null : Number(row.page_visits),
        results: row.results === null ? null : Number(row.results),
      })),
      hostCurrency: planCurrency,
      convert: frozenConvert,
    });
    if (planId) {
      const [{ data: hold }, { data: lastEdit }] = await Promise.all([
        supabase.from("ad_plan_funding_holds").select("amount_cents,state")
          .eq("plan_version_id", data.plan_version_id).maybeSingle(),
        supabase.from("host_ad_live_edits").select("created_at")
          .eq("plan_id", planId).order("created_at", { ascending: false })
          .limit(1).maybeSingle(),
      ]);
      if (hold?.state === "held" && Number.isSafeInteger(hold.amount_cents)) {
        planCapCents = hold.amount_cents;
      }
      lastLiveEditAt = typeof lastEdit?.created_at === "string"
        ? lastEdit.created_at
        : null;
    }
    // #4238 W5 (8a/8b): results in tickets and sign-ups, the 7-day click
    // count, the learning window and the one suggestion (Ari reads these
    // through get_ad_campaign_report; change_live recomputes the suggestion).
    const nowMs = Date.now();
    let w5: Record<string, unknown> = {};
    // #4238 rework 2 (tester P3-2): a lifetime (total) budget app spends its
    // pace, not the plan daily; set from the live-edit context below.
    let liveDailyNow: number | null | undefined;
    let liveSinceMs: number | null = null;
    let planCounts: { orders: number; tickets: number; sign_ups: number } | null = null;
    if (planId) {
      const { data: planRow } = await supabase.from("ad_plans")
        .select("id,brand_id,owner_kind,state,current_version_id,destination_family,destination_key")
        .eq("id", planId).maybeSingle();
      const loaded = planRow && planRow.owner_kind === "host" &&
          planRow.brand_id === brandId
        ? await loadLiveEditContext(supabase, planRow)
        : null;
      if (loaded?.ok && loaded.ctx.lines.some((line) => line.lifetime === true)) {
        liveDailyNow = hostLiveDailyNowCents(
          loaded.ctx.lines,
          nowMs,
          Date.parse(loaded.ctx.currentEnds ?? ""),
        );
      }
      const counts = await loadPlanResults(supabase, planCampaignIds, "sales", nowMs);
      planCounts = counts;
      liveSinceMs = loaded?.ok ? loaded.ctx.liveSinceMs : null;
      const spendForCost = hostSpendEquivalentCents;
      const learningUntil = loaded?.ok && loaded.ctx.liveSinceMs !== null
        ? loaded.ctx.liveSinceMs + HOST_LEARNING_WINDOW_DAYS * 86_400_000
        : null;
      w5 = {
        results_w5: {
          orders: counts.orders,
          tickets: counts.tickets,
          sign_ups: counts.sign_ups,
          clicks: counts.clicks,
          clicks_7d: counts.clicks_7d,
          cost_per_ticket_cents: spendForCost !== null && counts.tickets > 0
            ? Math.round(spendForCost / counts.tickets)
            : null,
          cost_per_sign_up_cents: spendForCost !== null && counts.sign_ups > 0
            ? Math.round(spendForCost / counts.sign_ups)
            : null,
        },
        days_live: loaded?.ok && loaded.ctx.liveSinceMs !== null
          ? Math.floor((nowMs - loaded.ctx.liveSinceMs) / 86_400_000) + 1
          : null,
        learning: learningUntil === null ? null : {
          state: nowMs < learningUntil ? "learning" : "done",
          until: new Date(learningUntil).toISOString(),
        },
        next_live_edit_at: lastLiveEditAt
          ? new Date(Date.parse(lastLiveEditAt) + 86_400_000).toISOString()
          : null,
        suggestion: loaded?.ok && planRow
          ? await loadPlanSuggestion(supabase, brandId, planRow, loaded.ctx, nowMs)
          : null,
      };
    }
    // #4238 Overview ("is my ad working?"). Additive and optional: a failure
    // here never fails `get`; the whole block falls back to null.
    let overview: Record<string, unknown> | null = null;
    try {
      overview = await buildHostAdOverview({
        // deno-lint-ignore no-explicit-any
        db: supabase as any,
        planId,
        planState,
        planCurrency,
        planCapCents,
        planGuidance,
        planCampaigns: planCampaigns as Record<string, unknown>[],
        planCampaignIds,
        spendByCampaign,
        creditByCampaign,
        hostSpendEquivalentCents,
        counts: planCounts,
        conversions: conversions as { touch_id?: unknown; order_id?: unknown }[],
        series,
        creatives: (creativeRows ?? []) as Record<string, unknown>[],
        liveSinceMs,
        nowMs,
        convert: frozenConvert,
      });
    } catch (cause) {
      console.warn(
        "[host-ad-campaign] overview unavailable:",
        cause instanceof Error ? cause.message : "unknown",
      );
      overview = null;
    }
    // #4238 W4b §2: what this teammate can do on this ad, and who to ask.
    const capabilities = await hostAdCapabilities(supabase, brandId, user.id);
    return json({
      ok: true,
      capabilities,
      campaign: data,
      plan_id: planId,
      last_live_edit_at: lastLiveEditAt,
      plan_campaigns: planCampaigns,
      daily: series?.daily ?? [],
      by_platform_spend: series?.by_platform_spend ?? [],
      time_zone: timeZone,
      ...(seriesError ? { daily_error: "unavailable" } : {}),
      plan_state: planState,
      plan_currency: planCurrency,
      plan_cap_cents: planCapCents,
      // #4238 rework 1 (tester P1-2/P1-3): the apps' daily amount in the
      // brand's money, from the plan allocation (amendment-aware). Null when
      // unknown (no plan, or an app without a readable allocation).
      plan_daily_credit_cents: liveDailyNow !== undefined
        ? liveDailyNow
        : typeof data.plan_version_id === "string"
        ? hostPlanDailyCreditCents({
          campaigns: planCampaigns,
          allocations: providerAllocations,
        })
        : null,
      public_page_url: publicPageUrl,
      provider_spend_by_currency: providerSpendByCurrency,
      host_spend_equivalent_cents: hostSpendEquivalentCents,
      host_spend_equivalent_quality: hostSpendEquivalentCents === null
        ? "unavailable"
        : "frozen_plan_fx",
      spend_daily: spend,
      results: {
        ...((w5.results_w5 as Record<string, unknown> | undefined) ?? {}),
        conversions: (conversions ?? []).length,
        value_cents: Object.fromEntries(conversionValueByCurrency),
        spend_by_currency: providerSpendByCurrency,
        host_spend_equivalent_cents: hostSpendEquivalentCents,
        by_platform: [...conversionByPlatform.values()].sort((a, b) =>
          b.conversions - a.conversions
        ),
      },
      measurement: {
        manifest: planMeasurement,
        // #4238 W4b §5: how the count above was made.
        counted_by: "mingla",
        click_window_days: HOST_AD_CLICK_WINDOW_DAYS,
        view_through: false,
        excluded_outside_window_count: (rawConversions ?? []).length -
          conversions.length,
        copy: HOST_AD_RESULTS_COPY,
        trusted_conversion_count: (conversions ?? []).length,
        platform_shared_conversion_count: (conversions ?? []).filter(
          (row: { shared_with_platforms?: boolean }) =>
            row.shared_with_platforms === true,
        ).length,
        platform_withheld_conversion_count: (conversions ?? []).filter(
          (row: { shared_with_platforms?: boolean }) =>
            row.shared_with_platforms !== true,
        ).length,
        observed_through: (conversions ?? []).reduce(
          (latest: string | null, row: { created_at?: unknown }) => {
            const value = typeof row.created_at === "string"
              ? row.created_at
              : null;
            return value && (!latest || value > latest) ? value : latest;
          },
          null,
        ),
      },
      by_placement: [...placementMap.values()].sort((a, b) =>
        b.conversions - a.conversions
      ),
      days_live: w5.days_live ?? null,
      learning: w5.learning ?? null,
      next_live_edit_at: w5.next_live_edit_at ?? null,
      suggestion: w5.suggestion ?? null,
      creatives: creativeRows ?? [],
      timeline: timelineResult.data ?? [],
      credit_events: creditResult.data ?? [],
      settlements: settlementResult.data ?? [],
      overview,
    });
  }

  if (action === "create") {
    return json({
      error: "plan_required",
      detail:
        "Create the immutable ad plan first, then use the shared provider writer with its version and hash.",
    }, 409);
  }

  if (
    action === "launch" || action === "pause" || action === "end" ||
    action === "cancel"
  ) {
    const campaignId = typeof body.campaign_id === "string"
      ? body.campaign_id
      : "";
    const idem = typeof body.idempotency_key === "string"
      ? body.idempotency_key.trim()
      : "";
    if (!UUID_REGEX.test(campaignId)) {
      return json(
        { error: "validation_error", detail: "campaign_id_invalid" },
        400,
      );
    }
    const { data: camp, error: campErr } = await supabase
      .from("ad_campaigns")
      .select(
        "id, status, brand_id, owner_kind, cap_cents, currency, provider_currency, daily_budget_cents, name, platform, connection_id, external_campaign_id, targeting, starts_at, ends_at, plan_version_id, plan_hash, host_budget_cents, provider_budget_cents",
      )
      .eq("id", campaignId)
      .eq("brand_id", brandId)
      .eq("owner_kind", "host")
      .maybeSingle();
    if (campErr || !camp) {
      return json(
        { error: "validation_error", detail: "campaign_not_found" },
        404,
      );
    }
    const hasBoundPlan = typeof camp.plan_version_id === "string" &&
      UUID_REGEX.test(camp.plan_version_id) &&
      typeof camp.plan_hash === "string" &&
      /^[0-9a-f]{64}$/.test(camp.plan_hash);
    if (action !== "pause" && !hasBoundPlan) {
      return json({
        error: "legacy_campaign_reconciliation_required",
        detail:
          "This campaign predates final-spend settlement and cannot move money or relaunch until Mingla reconciles it.",
      }, 409);
    }

    // Wave 8's synchronous finalization used campaign_has_spend_use_end,
    // campaign_no_spend_use_cancel, status: "DELETED", and
    // cancel_return:host:. v1.4 deliberately replaces those direct mutations
    // with provider stop requests plus final-spend settlement below.
    if ((action === "cancel" || action === "end") && hasBoundPlan) {
      const { data: planCampaigns, error: planCampaignError } = await supabase
        .from("ad_campaigns")
        .select(
          "id,platform,connection_id,external_campaign_id,plan_version_id,plan_hash",
        )
        .eq("plan_version_id", camp.plan_version_id)
        .eq("plan_hash", camp.plan_hash)
        .eq("brand_id", brandId)
        .eq("owner_kind", "host")
        .order("platform");
      if (planCampaignError || !planCampaigns?.length) {
        return json({
          error: "stop_request_failed",
          detail: planCampaignError
            ? hostSafeDatabaseDetail(planCampaignError, "host-ad-campaign stop")
            : "plan_campaigns_missing",
        }, 409);
      }
      const [planResult, allocationResult] = await Promise.all([
        supabase.from("ad_plans").select("id,state")
          .eq("current_version_id", camp.plan_version_id).maybeSingle(),
        supabase.from("ad_plan_provider_allocations").select("platform")
          .eq("plan_version_id", camp.plan_version_id),
      ]);
      if (
        planResult.error || !planResult.data ||
        !ENDABLE_PLAN_STATES.has(String(planResult.data.state))
      ) {
        return json({
          error: "stop_request_failed",
          detail: planResult.error
            ? hostSafeDatabaseDetail(planResult.error, "host-ad-campaign stop")
            : "plan_state_not_endable",
        }, 409);
      }
      const expectedPlatforms = new Set(
        (allocationResult.data ?? []).map((row: { platform: unknown }) =>
          String(row.platform)
        ),
      );
      const boundPlatforms = new Set(
        planCampaigns.map((row: { platform: unknown }) => String(row.platform)),
      );
      if (
        allocationResult.error || expectedPlatforms.size === 0 ||
        boundPlatforms.size !== expectedPlatforms.size ||
        [...expectedPlatforms].some((platform) => !boundPlatforms.has(platform))
      ) {
        return json({
          error: "stop_request_failed",
          detail: "partial_plan_reconciliation_required",
        }, 409);
      }
      const settlements: unknown[] = [];
      for (const target of planCampaigns) {
        await pauseProviderBestEffort(supabase, {
          id: String(target.id),
          platform: String(target.platform ?? ""),
          connection_id: typeof target.connection_id === "string"
            ? target.connection_id
            : null,
          external_campaign_id: typeof target.external_campaign_id === "string"
            ? target.external_campaign_id
            : null,
        });
        const { data: settlement, error: settlementError } = await supabase.rpc(
          "ad_request_campaign_stop",
          { p_campaign_id: target.id },
        );
        if (settlementError) {
          return json({
            error: "stop_request_failed",
            detail: hostSafeDatabaseDetail(
              settlementError,
              "host-ad-campaign stop",
            ),
            campaign_id: target.id,
            settlements,
          }, 409);
        }
        settlements.push(settlement);
        await supabase.from("ad_status_events").insert({
          campaign_id: target.id,
          platform: target.platform,
          entity: "campaign",
          action: "stop_requested",
          actor: user.id,
          from_status: camp.status,
          to_status: "PAUSED",
          external_ids: { external_campaign_id: target.external_campaign_id },
          provider_response: { requested_action: action },
        });
        if (settlement?.state === "stop_requested") {
          const { error: attemptError } = await supabase.rpc(
            "ad_record_provider_attempt",
            {
              p_plan_version_id: camp.plan_version_id,
              p_plan_hash: camp.plan_hash,
              p_platform: target.platform,
              p_command: "stop",
              p_idempotency_key: `stop:${camp.plan_hash}:${target.platform}`,
              p_state: "running",
              p_external_ids: { campaign_id: target.external_campaign_id },
              p_provider_response: null,
              p_error_detail: null,
            },
          );
          if (attemptError) {
            console.error(
              "[host-ad-campaign] stop attempt audit failed:",
              attemptError.message,
            );
          }
        }
      }
      return json({
        ok: true,
        campaign_id: campaignId,
        campaign_ids: planCampaigns.map((row: { id: string }) => row.id),
        status: "STOP_REQUESTED",
        settlements,
        unspent_returned_cents: 0,
        final_spend_pending: true,
      });
    }

    if (action === "pause") {
      const status = String(camp.status ?? "").toUpperCase();
      if (status === "PAUSED") {
        return json({
          ok: true,
          campaign_id: campaignId,
          status: "PAUSED",
          replayed: true,
        });
      }
      if (status !== "ACTIVE") {
        return json({
          error: "validation_error",
          detail: "campaign_not_pausable",
        }, 409);
      }
      if (!isPlatform(camp.platform)) {
        return json({
          error: "validation_error",
          detail: "platform_invalid",
        }, 422);
      }
      if (isSyntheticHostExternalId(camp.external_campaign_id)) {
        return json({
          error: "validation_error",
          detail: "provider_not_synced",
        }, 409);
      }
      const { data: conn } = await supabase
        .from("ad_connections")
        .select("*")
        .eq("id", camp.connection_id)
        .maybeSingle();
      if (!conn || !conn.connected || conn.status !== "connected") {
        return json({ error: `${String(camp.platform)}_not_connected` }, 424);
      }
      if (hasBoundPlan) {
        await supabase.from("ad_plans").update({ state: "pause_requested" })
          .eq("current_version_id", camp.plan_version_id)
          .in("state", ["live", "partially_live"]);
        await supabase.rpc("ad_record_provider_attempt", {
          p_plan_version_id: camp.plan_version_id,
          p_plan_hash: camp.plan_hash,
          p_platform: camp.platform,
          p_command: "pause",
          p_idempotency_key: `pause:${camp.plan_hash}:${camp.platform}`,
          p_state: "running",
          p_external_ids: { campaign_id: camp.external_campaign_id },
          p_provider_response: null,
          p_error_detail: null,
        });
      }
      const tree = await loadProviderTree(
        supabase,
        campaignId,
        String(camp.external_campaign_id),
      );
      try {
        await setCampaignTreeStatus(
          getAdapter(camp.platform),
          conn as unknown as AdConnectionRow,
          {
            externalCampaignId: String(camp.external_campaign_id),
            adSetExternalIds: tree.adSetExternalIds,
            adExternalIds: tree.adExternalIds,
          },
          "PAUSED",
        );
      } catch (err) {
        if (hasBoundPlan) {
          await supabase.rpc("ad_record_provider_attempt", {
            p_plan_version_id: camp.plan_version_id,
            p_plan_hash: camp.plan_hash,
            p_platform: camp.platform,
            p_command: "pause",
            p_idempotency_key: `pause:${camp.plan_hash}:${camp.platform}`,
            p_state: "failed_retryable",
            p_external_ids: { campaign_id: camp.external_campaign_id },
            p_provider_response: null,
            p_error_detail: err instanceof Error
              ? err.message.slice(0, 500)
              : String(err).slice(0, 500),
          });
          await supabase.from("ad_plans").update({ state: "live" })
            .eq("current_version_id", camp.plan_version_id)
            .eq("state", "pause_requested");
        }
        if (err instanceof AdNotConnectedError) {
          return json({
            error: `${String(camp.platform)}_not_connected`,
            detail: err.detail,
          }, 424);
        }
        const detail = err instanceof Error ? err.message : String(err);
        return json({
          error: "provider_pause_failed",
          detail: detail.slice(0, 500),
        }, 502);
      }
      const { data: paused, error } = await supabase
        .from("ad_campaigns")
        .update({
          status: "PAUSED",
          status_synced_at: new Date().toISOString(),
        })
        .eq("id", campaignId)
        .eq("status", "ACTIVE")
        .select("id")
        .maybeSingle();
      if (error) {
        return json({
        error: "apply_failed",
        detail: hostSafeDatabaseDetail(error, "host-ad-campaign"),
      }, 502);
      }
      if (!paused) {
        return json({
          error: "validation_error",
          detail: "campaign_pause_conflict",
        }, 409);
      }
      if (hasBoundPlan) {
        await supabase.rpc("ad_record_provider_attempt", {
          p_plan_version_id: camp.plan_version_id,
          p_plan_hash: camp.plan_hash,
          p_platform: camp.platform,
          p_command: "pause",
          p_idempotency_key: `pause:${camp.plan_hash}:${camp.platform}`,
          p_state: "succeeded",
          p_external_ids: { campaign_id: camp.external_campaign_id },
          p_provider_response: { status: "PAUSED" },
          p_error_detail: null,
        });
        const { data: planCampaigns } = await supabase.from("ad_campaigns")
          .select("status").eq("plan_version_id", camp.plan_version_id)
          .eq("plan_hash", camp.plan_hash);
        if (
          (planCampaigns ?? []).length > 0 &&
          (planCampaigns ?? []).every((row: { status: string }) =>
            String(row.status).toUpperCase() === "PAUSED"
          )
        ) {
          await supabase.from("ad_plans").update({ state: "paused" })
            .eq("current_version_id", camp.plan_version_id)
            .eq("state", "pause_requested");
        }
      }
      // #4238 W4b: the rest of the team hears that a teammate paused it
      // (the person who paused does not). Never blocks the pause.
      await notifyHostAdPause(supabase, {
        planVersionId: camp.plan_version_id,
        campaignId,
        reason: "host_paused",
        pauseRef: `host:${idem || `${campaignId}:${new Date().toISOString()}`}`,
        actorId: user.id,
      }, dispatchNotification);
      return json({
        ok: true,
        campaign_id: campaignId,
        status: "PAUSED",
        provider_sync: "synced",
      });
    }

    // launch — funding is already held against the immutable plan. Activating
    // must never debit the Host wallet again.
    const launchAlertBase = {
      source: "host" as const,
      campaignId,
      brandId,
      platform: typeof camp.platform === "string" ? camp.platform : null,
      name: typeof camp.name === "string" ? camp.name : null,
      actorId: user.id,
    };
    if (camp.status === "ACTIVE") {
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "accepted",
        detail: "replayed_already_active",
        idempotencyKey: `ads_launch:host:${campaignId}:active`,
      });
      return json({
        ok: true,
        campaign_id: campaignId,
        status: "ACTIVE",
        replayed: true,
        provider_sync: "synced",
      });
    }
    if (String(camp.status).toUpperCase() !== "PAUSED") {
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "rejected",
        detail: "campaign_not_launchable",
        idempotencyKey: `ads_launch:host:${campaignId}:not_launchable`,
      });
      return json({
        error: "validation_error",
        detail: "campaign_not_launchable",
      }, 409);
    }
    if (!isPlatform(camp.platform)) {
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "rejected",
        detail: "platform_invalid",
        idempotencyKey: `ads_launch:host:${campaignId}:platform`,
      });
      return json({
        error: "validation_error",
        detail: "platform_invalid",
      }, 422);
    }
    if (isSyntheticHostExternalId(camp.external_campaign_id)) {
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "rejected",
        detail: "provider_not_synced",
        idempotencyKey: `ads_launch:host:${campaignId}:not_synced`,
      });
      return json({
        error: "validation_error",
        detail: "provider_not_synced",
      }, 409);
    }
    const held = Number(camp.host_budget_cents ?? camp.cap_cents ?? 0);
    if (!Number.isFinite(held) || held <= 0) {
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "rejected",
        detail: "budget_invalid",
        idempotencyKey: `ads_launch:host:${campaignId}:budget_invalid`,
      });
      return json({ error: "validation_error", detail: "budget_invalid" }, 400);
    }
    if (startDateNotReached(camp.starts_at ?? null)) {
      return json({
        error: "launch_blocked",
        detail: "start_date_not_reached",
      }, 409);
    }
    if (endDatePassed(camp.ends_at ?? null)) {
      return json({ error: "launch_blocked", detail: "end_date_passed" }, 409);
    }
    const providerCap = providerCapCents(camp);
    if (providerCap === null) {
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "rejected",
        detail: "provider_cap_unresolved",
        idempotencyKey: `ads_launch:host:${campaignId}:provider_cap`,
      });
      return json({
        error: "launch_blocked",
        detail: "provider_cap_unresolved",
      }, 409);
    }
    const { data: spendRows, error: spendError } = await supabase
      .from("ad_spend_daily")
      .select("spend_cents,currency")
      .eq("campaign_id", campaignId);
    if (spendError) {
      return json({
        error: "launch_blocked",
        detail: "spend_read_failed",
      }, 503);
    }
    const providerCurrency = typeof camp.provider_currency === "string"
      ? camp.provider_currency.trim().toUpperCase()
      : "";
    if (
      !/^[A-Z]{3}$/.test(providerCurrency) ||
      (spendRows ?? []).some((row: { currency?: unknown }) =>
        typeof row.currency !== "string" ||
        row.currency.trim().toUpperCase() !== providerCurrency
      )
    ) {
      return json({
        error: "launch_blocked",
        detail: "provider_currency_mismatch",
      }, 409);
    }
    const cumulativeProviderSpend = sumSpendCents(
      (spendRows ?? []).map((row: { spend_cents?: unknown }) => ({
        spend_date: "1970-01-01",
        spend_cents: Number(row.spend_cents) || 0,
      })),
    );
    if (shouldPauseForCap(cumulativeProviderSpend, providerCap)) {
      return json({
        error: "launch_blocked",
        detail: "hard_cap_reached",
      }, 409);
    }

    const { data: conn } = await supabase
      .from("ad_connections")
      .select("*")
      .eq("id", camp.connection_id)
      .maybeSingle();
    if (!conn || !conn.connected || conn.status !== "connected") {
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "rejected",
        detail: `${String(camp.platform)}_not_connected`,
        idempotencyKey: `ads_launch:host:${campaignId}:not_connected`,
      });
      return json({ error: `${String(camp.platform)}_not_connected` }, 424);
    }
    const { error: launchableError } = await supabase.rpc(
      "ad_plan_assert_launchable",
      {
        p_plan_version_id: camp.plan_version_id,
        p_plan_hash: camp.plan_hash,
      },
    );
    if (launchableError) {
      return json({
        error: "plan_not_launchable",
        detail: hostSafeDatabaseDetail(
          launchableError,
          "host-ad-campaign launch",
        ),
      }, 409);
    }

    const tree = await loadProviderTree(
      supabase,
      campaignId,
      String(camp.external_campaign_id),
    );
    const adapter = getAdapter(camp.platform);
    const providerTree = {
      externalCampaignId: String(camp.external_campaign_id),
      adSetExternalIds: tree.adSetExternalIds,
      adExternalIds: tree.adExternalIds,
    };
    try {
      await setCampaignTreeStatus(
        adapter,
        conn as unknown as AdConnectionRow,
        providerTree,
        "ACTIVE",
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await setCampaignTreeStatus(
        adapter,
        conn as unknown as AdConnectionRow,
        providerTree,
        "PAUSED",
      ).catch(() => undefined);
      await supabase.rpc("ad_record_provider_attempt", {
        p_plan_version_id: camp.plan_version_id,
        p_plan_hash: camp.plan_hash,
        p_platform: camp.platform,
        p_command: "activate",
        p_idempotency_key: `activate:${camp.plan_hash}:${camp.platform}`,
        p_state: "failed_retryable",
        p_external_ids: { campaign_id: camp.external_campaign_id },
        p_provider_response: null,
        p_error_detail: detail.slice(0, 500),
      });
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "failed",
        detail: `provider_activate_failed:${detail}`.slice(0, 500),
        idempotencyKey: `ads_launch:host:${campaignId}:activate_failed`,
      });
      if (err instanceof AdNotConnectedError) {
        return json({
          error: `${String(camp.platform)}_not_connected`,
          detail: err.detail,
        }, 424);
      }
      return json({
        error: "provider_activate_failed",
        detail: detail.slice(0, 500),
        funding_remains_held: true,
      }, 502);
    }

    const { data: claimed, error } = await supabase
      .from("ad_campaigns")
      .update({
        status: "ACTIVE",
        status_synced_at: new Date().toISOString(),
      })
      .eq("id", campaignId)
      .eq("status", "PAUSED")
      .select("id")
      .maybeSingle();
    if (error) {
      await setCampaignTreeStatus(
        adapter,
        conn as unknown as AdConnectionRow,
        providerTree,
        "PAUSED",
      ).catch(() => undefined);
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "failed",
        detail: error.message,
        idempotencyKey: `ads_launch:host:${campaignId}:claim_failed`,
      });
      return json({
        error: "apply_failed",
        detail: hostSafeDatabaseDetail(error, "host-ad-campaign"),
      }, 502);
    }
    if (!claimed?.id) {
      // Another launch won the claim; debit was idempotent on campaign key.
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "accepted",
        detail: "replayed_claim_lost",
        idempotencyKey: `ads_launch:host:${campaignId}:accepted`,
      });
      return json({
        ok: true,
        campaign_id: campaignId,
        status: "ACTIVE",
        replayed: true,
        held_cents: held,
        provider_sync: "synced",
      });
    }
    if (tree.adSetIds.length > 0) {
      await supabase.from("ad_sets").update({ status: "ACTIVE" }).in(
        "id",
        tree.adSetIds,
      );
      await supabase.from("ads").update({ status: "ACTIVE" }).in(
        "ad_set_id",
        tree.adSetIds,
      );
    }
    await supabase.rpc("ad_record_provider_attempt", {
      p_plan_version_id: camp.plan_version_id,
      p_plan_hash: camp.plan_hash,
      p_platform: camp.platform,
      p_command: "activate",
      p_idempotency_key: `activate:${camp.plan_hash}:${camp.platform}`,
      p_state: "succeeded",
      p_external_ids: { campaign_id: camp.external_campaign_id },
      p_provider_response: { status: "ACTIVE" },
      p_error_detail: null,
    });
    const { data: planCampaigns } = await supabase.from("ad_campaigns")
      .select("status").eq("plan_version_id", camp.plan_version_id)
      .eq("plan_hash", camp.plan_hash);
    const activeCount =
      (planCampaigns ?? []).filter((row: { status: string }) =>
        String(row.status).toUpperCase() === "ACTIVE"
      ).length;
    if ((planCampaigns ?? []).length > 0 && activeCount > 0) {
      const nextPlanState = activeCount === (planCampaigns ?? []).length
        ? "live"
        : "partially_live";
      await supabase.from("ad_plans").update({ state: nextPlanState })
        .eq("current_version_id", camp.plan_version_id)
        .in("state", [
          "platform_review",
          "scheduled",
          "paused",
          "partially_live",
        ]);
    }
    await notifyAdLaunchAttempt({
      ...launchAlertBase,
      outcome: "accepted",
      detail: `held_cents=${held};provider=${String(camp.platform)}`,
      idempotencyKey: `ads_launch:host:${campaignId}:accepted`,
    });
    return json({
      ok: true,
      campaign_id: campaignId,
      status: "ACTIVE",
      held_cents: held,
      provider_sync: "synced",
    });
  }

  return json({ error: "validation_error", detail: "action_invalid" }, 400);
});

/**
 * #4238 W4a (5c, D-5): the Host accepts the last-tickets offer. Marks the
 * pending offer(s) accepted; the hourly sweep then adds the new ads with the
 * frozen last-tickets words through the apps' normal review and pauses the
 * old ads once the new ones are live. Once per event: a plan for the same
 * event that already used it is refused.
 */
// deno-lint-ignore no-explicit-any
async function acceptLastTickets(db: any, actorId: string, brandId: string, body: Record<string, unknown>): Promise<Response> {
  const planId = typeof body.plan_id === "string" ? body.plan_id : "";
  if (!UUID_REGEX.test(planId)) {
    return json({ error: "validation_error", detail: "plan_id_invalid" }, 400);
  }
  const { data: plan, error: planError } = await db.from("ad_plans")
    .select("id,brand_id,owner_kind,state,destination_family,destination_key")
    .eq("id", planId).maybeSingle();
  if (planError) return json({ error: "plan_lookup_failed" }, 503);
  if (!plan || plan.owner_kind !== "host" || plan.brand_id !== brandId) {
    return json({ error: "forbidden", detail: "plan_not_found" }, 403);
  }
  // #4238 W5: Ari's (one-tap) suggestion is recomputed; a stale id is refused.
  if ("suggestion_id" in body) {
    const { data: full } = await db.from("ad_plans")
      .select("id,brand_id,owner_kind,state,current_version_id,destination_family,destination_key")
      .eq("id", planId).maybeSingle();
    const loaded = full?.current_version_id ? await loadLiveEditContext(db, full) : null;
    const suggestion = loaded?.ok ? await loadPlanSuggestion(db, brandId, full, loaded.ctx, Date.now()) : null;
    if (
      !suggestion || suggestion.kind !== "accept_last_tickets" ||
      suggestion.suggestion_id !== body.suggestion_id
    ) {
      return json({ error: "ad_suggestion_stale", detail: "ad_suggestion_stale" }, 409);
    }
  }
  const { data: offers, error: offerError } = await db.from("ad_plan_automation_events")
    .select("id,platform,status,detail").eq("plan_id", planId).eq("kind", "low_stock_copy");
  if (offerError) return json({ error: "plan_lookup_failed" }, 503);
  const rows = (offers ?? []) as Record<string, unknown>[];
  const open = rows.filter((row) =>
    row.status === "pending" &&
    typeof (row.detail as Record<string, unknown> | null)?.accepted_at !== "string"
  );
  if (open.length === 0) {
    const used = rows.some((row) =>
      row.status === "applied" ||
      typeof (row.detail as Record<string, unknown> | null)?.accepted_at === "string"
    );
    return json({
      error: used ? "host_ad_last_tickets_already_used" : "host_ad_last_tickets_not_offered",
    }, 409);
  }
  // Once per event: another plan for the same page that accepted it wins.
  const { data: siblings } = await db.from("ad_plans").select("id")
    .eq("brand_id", brandId).eq("destination_family", plan.destination_family)
    .eq("destination_key", plan.destination_key).neq("id", planId);
  const siblingIds = ((siblings ?? []) as Record<string, unknown>[]).map((row) => String(row.id));
  if (siblingIds.length > 0) {
    const { data: used } = await db.from("ad_plan_automation_events")
      .select("id,status,detail").in("plan_id", siblingIds).eq("kind", "low_stock_copy");
    if (
      ((used ?? []) as Record<string, unknown>[]).some((row) =>
        row.status === "applied" ||
        typeof (row.detail as Record<string, unknown> | null)?.accepted_at === "string"
      )
    ) {
      return json({ error: "host_ad_last_tickets_already_used" }, 409);
    }
  }
  const acceptedAt = new Date().toISOString();
  for (const row of open) {
    const { error } = await db.from("ad_plan_automation_events").update({
      detail: {
        ...(row.detail as Record<string, unknown> ?? {}),
        accepted_at: acceptedAt,
        accepted_by: actorId,
      },
    }).eq("id", row.id).eq("status", "pending");
    if (error) {
      console.error("[host-ad-campaign] last tickets accept failed:", String(error.message ?? "").slice(0, 300));
      return json({ error: "host_ad_last_tickets_not_recorded" }, 503);
    }
  }
  return json({
    ok: true,
    accepted: open.map((row) => row.platform),
    // #4238 W4c: the hourly sweep applies it on Meta, Snapchat and TikTok.
    applied_by_sweep: open.map((row) => row.platform).filter((platform) =>
      platform === "meta" || platform === "snapchat" || platform === "tiktok"
    ),
  }, 200);
}

/**
 * #4238 media-buyer, wave D: change a live Host ad's total budget and/or end
 * date (once a day). Body: { brand_id, plan_id, new_budget_cents?,
 * new_ends_at?, idempotency_key }. Money moves only in host_ad_amend_live.
 */
// deno-lint-ignore no-explicit-any
async function changeLive(db: any, actorId: string, brandId: string, body: Record<string, unknown>): Promise<Response> {
  // #4238 amendment B item 7: budget and end date only; any other key is
  // refused by name before anything is claimed or pushed.
  const notEditable = hostLiveEditUnknownField(body);
  if (notEditable !== null) {
    return json({
      error: "validation_error",
      detail: `host_ad_live_edit_field_not_editable:${notEditable.slice(0, 64)}`,
    }, 400);
  }
  const planId = typeof body.plan_id === "string" ? body.plan_id : "";
  const key = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
  if (!UUID_REGEX.test(planId) || key.length < 8 || key.length > 160) {
    return json({ error: "validation_error", detail: "change_live_invalid" }, 400);
  }
  const { data: plan, error: planError } = await db.from("ad_plans")
    .select("id,brand_id,owner_kind,state,current_version_id,destination_family,destination_key")
    .eq("id", planId).maybeSingle();
  if (planError) return json({ error: "plan_lookup_failed" }, 503);
  if (!plan || plan.owner_kind !== "host" || plan.brand_id !== brandId || !plan.current_version_id) {
    return json({ error: "forbidden", detail: "plan_not_found" }, 403);
  }
  // #4238 r8 P1-2: claim the edit under the plan lock BEFORE any app is
  // touched. A same-key retry gets the saved edit; a second tap or device
  // gets "in progress" / "once a day" and never pushes.
  const editKey = `host_live_${planId}_${key}`.slice(0, 200);
  const { data: claim, error: claimError } = await db.rpc("host_ad_live_edit_claim", {
    p_plan_id: planId,
    p_actor_id: actorId,
    p_idempotency_key: editKey,
  });
  if (claimError) {
    const message = String(claimError.message ?? "");
    const code = [
      "host_ad_live_edit_once_a_day",
      "host_ad_live_edit_in_progress",
      "host_ad_live_edit_state_invalid",
    ].find((item) => message.includes(item));
    if (!code) {
      console.error("[host-ad-campaign] live edit claim failed:", message.slice(0, 300));
    }
    return json({ error: code ?? "host_ad_live_edit_not_recorded" }, code ? 409 : 503);
  }
  // #4238 r9 P3: a claim left by a request that crashed after a push but
  // before the record. The app may be on an amount Mingla never recorded.
  if (claim?.lapsed_claim && typeof claim.lapsed_claim === "object") {
    const lapsed = claim.lapsed_claim as Record<string, unknown>;
    const { data: lapsedRows } = await db.from("ad_campaigns")
      .select("id,platform,status").eq("plan_version_id", String(plan.current_version_id));
    const rows = (lapsedRows ?? []) as Record<string, unknown>[];
    // r10: only apps Mingla pushes to can be on an unrecorded amount.
    const platforms = [...new Set(rows.map((row) => row.platform as Platform))]
      .filter((platform) => HOST_LIVE_DAILY_PUSH.has(platform));
    if (platforms.length > 0) {
      await recordLiveEditProblem(db, {
        planId,
        versionId: String(plan.current_version_id),
        brandId,
        actorId,
        editKey: String(lapsed.idempotency_key ?? editKey),
        rows,
        problem: {
          kind: "lapsed_claim",
          platforms,
          detail: `claim ${String(lapsed.idempotency_key ?? "?")} from ${String(lapsed.claimed_at ?? "?")} never recorded`,
        },
      });
    }
  }
  if (claim?.replay === true) {
    return json({
      ok: true,
      replayed: true,
      edit: claim.edit ?? null,
      daily_not_pushed: [],
      end_not_pushed: [],
    }, 200);
  }
  let recorded = false;
  try {
    const result = await planAndRunLiveEdit(db, actorId, brandId, plan, editKey, body);
    recorded = result.status === 200;
    return json(result.body, result.status);
  } finally {
    if (!recorded) {
      const { error: releaseError } = await db.rpc("host_ad_live_edit_release", {
        p_plan_id: planId,
        p_idempotency_key: editKey,
      });
      // The claim lapses on its own after 10 minutes if this fails.
      if (releaseError) {
        console.error("[host-ad-campaign] live edit release failed:", String(releaseError.message ?? "").slice(0, 300));
      }
    }
  }
}

type LiveEditContext = {
  version: Record<string, unknown>;
  rows: Record<string, unknown>[];
  hold: { amount_cents: number; currency: string; state: string };
  lastEditAt: string | null;
  lastBookableAt: string | null;
  destination: Record<string, unknown> | null;
  hostSpend: number;
  lines: HostLiveCampaign[];
  currentEnds: string | null;
  liveSinceMs: number | null;
};

/**
 * #4238 W5: everything a live edit is planned from, shared by change_live and
 * by the suggestion (so `get` and `change_live` recompute the same one).
 */
async function loadLiveEditContext(
  // deno-lint-ignore no-explicit-any
  db: any,
  plan: Record<string, unknown>,
): Promise<{ ok: true; ctx: LiveEditContext } | { ok: false; status: number; body: Record<string, unknown> }> {
  const planId = String(plan.id);
  const versionId = String(plan.current_version_id);
  const [{ data: version }, { data: campaigns }, { data: allocations }, { data: hold }, { data: lastEdit }] =
    await Promise.all([
      db.from("ad_plan_versions").select("id,plan_hash,canonical_plan").eq("id", versionId).maybeSingle(),
      db.from("ad_campaigns").select("*").eq("plan_version_id", versionId).order("id"),
      db.from("ad_plan_provider_allocations").select("*").eq("plan_version_id", versionId),
      db.from("ad_plan_funding_holds").select("amount_cents,currency,state").eq("plan_version_id", versionId).maybeSingle(),
      db.from("host_ad_live_edits").select("created_at").eq("plan_id", planId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
  const rows = (campaigns ?? []) as Record<string, unknown>[];
  if (!version || rows.length === 0 || !hold || hold.state !== "held") {
    return { ok: false, status: 409, body: { error: "plan_conflict", detail: "plan_not_live" } };
  }
  const { data: destination } = await db.rpc("ad_plan_destination_resolve", {
    p_destination_family: plan.destination_family,
    p_destination_key: plan.destination_key,
    p_platforms: rows.map((row) => row.platform),
  });
  // #4238 r8 P2-2: each app's daily minimum, the same rule create_version uses.
  const { data: connectionRows, error: connectionError } = await db.from("ad_connections")
    .select("id,platform,currency,extra")
    .in("id", rows.map((row) => String(row.connection_id)));
  if (connectionError) {
    return { ok: false, status: 503, body: { error: "plan_lookup_failed" } };
  }
  const optimizationByPlatform = (
    (version.canonical_plan as Record<string, unknown> | null)?.optimization_by_platform ?? {}
  ) as Record<string, unknown>;
  let hostSpend = 0;
  const lines: HostLiveCampaign[] = [];
  for (const row of rows) {
    const allocation = ((allocations ?? []) as Record<string, unknown>[])
      .find((item) => item.platform === row.platform) ?? {};
    const { data: spendRows } = await db.from("ad_spend_daily")
      .select("spend_cents").eq("campaign_id", row.id);
    const providerSpend = ((spendRows ?? []) as Record<string, unknown>[])
      .reduce((sum, item) => sum + Number(item.spend_cents ?? 0), 0);
    let spendInHost = providerSpend;
    if (row.provider_currency !== hold.currency && providerSpend > 0) {
      const { data: converted, error } = await db.rpc("fx_convert_minor", {
        p_amount: providerSpend,
        p_source: row.provider_currency,
        p_target: hold.currency,
        p_snapshot: row.fx_snapshot_id,
      });
      if (error || !Number.isSafeInteger(converted)) {
        return { ok: false, status: 409, body: { error: "plan_conflict", detail: "spend_unknown" } };
      }
      spendInHost = Number(converted);
    }
    hostSpend += spendInHost;
    const connection = ((connectionRows ?? []) as Record<string, unknown>[])
      .find((item) => item.id === row.connection_id) ?? {};
    lines.push({
      id: String(row.id),
      platform: row.platform as Platform,
      host_budget_cents: Number(allocation.host_budget_cents),
      host_delivery_budget_cents: Number(allocation.host_delivery_budget_cents),
      provider_budget_cents: Number(allocation.provider_budget_cents),
      provider_delivery_budget_cents: Number(allocation.provider_delivery_budget_cents),
      current_cap_cents: Number(row.amended_provider_budget_cents ?? row.provider_budget_cents),
      current_daily_cents: Number(row.amended_provider_delivery_budget_cents ?? row.provider_delivery_budget_cents),
      provider_spend_cents: providerSpend,
      lifetime: Number(row.lifetime_budget_cents ?? 0) > 0,
      provider_daily_minimum_cents: providerDailyMinimumCents(
        String(row.platform),
        connection,
        optimizationByPlatform[String(row.platform)] === "sales" ? "sales" : "visits",
      ),
    });
  }
  const currentEnds = rows.map((row) => row.ends_at).filter((v): v is string => typeof v === "string").sort().pop() ?? null;
  return {
    ok: true,
    ctx: {
      version,
      rows,
      hold,
      lastEditAt: typeof lastEdit?.created_at === "string" ? lastEdit.created_at : null,
      lastBookableAt: typeof destination?.last_bookable_at === "string" ? destination.last_bookable_at : null,
      destination: destination && typeof destination === "object" ? destination as Record<string, unknown> : null,
      hostSpend,
      lines,
      currentEnds,
      liveSinceMs: await loadHostLiveSinceMs(db, rows),
    },
  };
}

/**
 * #4238 W5 (8b): the plan's one suggestion, from the live-edit context plus
 * results, the frozen guidance, stock, the wallet and the last-tickets offer.
 * A budget or end suggestion is dry-run through planHostLiveEdit, so one that
 * the live-edit rules (floors, spend, last bookable) would refuse is never
 * shown.
 */
async function loadPlanSuggestion(
  // deno-lint-ignore no-explicit-any
  db: any,
  brandId: string,
  plan: Record<string, unknown>,
  ctx: LiveEditContext,
  nowMs: number,
): Promise<HostAdSuggestion | null> {
  const canonical = (ctx.version.canonical_plan ?? {}) as Record<string, unknown>;
  const snapshot = (canonical.guidance_snapshot ?? null) as Record<string, unknown> | null;
  const goal = snapshot?.goal === "sales" || snapshot?.goal === "signups" ? snapshot.goal : "visits";
  const mid = Number(snapshot?.cost_per_result_cents);
  const high = Number(snapshot?.cost_per_result_high_cents);
  const ids = ctx.rows.map((row) => String(row.id));
  const results = await loadPlanResults(db, ids, goal, nowMs);
  const eventId = ctx.destination?.event_id;
  let stock: { remaining: number | null; total: number | null; unlimited: boolean } | null = null;
  if (typeof eventId === "string" && UUID_REGEX.test(eventId)) {
    const { data, error } = await db.rpc("ad_offering_stock", {
      p_event_id: eventId,
      p_occurrence_key: typeof canonical.occurrence_key === "string" ? canonical.occurrence_key : null,
    });
    const parsed = error ? null : parseOfferingStock(data);
    stock = parsed ? { remaining: parsed.remaining, total: parsed.total, unlimited: parsed.unlimited } : null;
  }
  const [{ data: wallet }, { data: offers }] = await Promise.all([
    db.from("ad_credit_wallets").select("balance_cents,currency").eq("brand_id", brandId).maybeSingle(),
    db.from("ad_plan_automation_events").select("status,detail").eq("plan_id", String(plan.id))
      .eq("kind", "low_stock_copy"),
  ]);
  const walletCents = wallet && wallet.currency === ctx.hold.currency && Number.isSafeInteger(Number(wallet.balance_cents))
    ? Number(wallet.balance_cents)
    : null;
  const lastTicketsOffered = ((offers ?? []) as Record<string, unknown>[]).some((row) =>
    row.status === "pending" &&
    typeof (row.detail as Record<string, unknown> | null)?.accepted_at !== "string"
  );
  // #4238 rework 3 (tester P3-3): the latest pause/stop reason on the plan's
  // campaigns, so Ari never suggests extending a sold-out or passed ad.
  const { data: stops } = ids.length > 0
    ? await db.from("ad_status_events")
      .select("provider_response,created_at")
      .in("campaign_id", ids).in("action", ["pause", "end"])
      .order("created_at", { ascending: false }).limit(20)
    : { data: [] };
  const stopReason = latestStopReason((stops ?? []) as Record<string, unknown>[]);
  const suggestion = await hostAdSuggestion({
    planId: String(plan.id),
    planState: String(plan.state),
    nowMs,
    liveSinceMs: ctx.liveSinceMs,
    lastEditAt: ctx.lastEditAt,
    goal,
    currency: String(ctx.hold.currency),
    currentTotalCents: Number(ctx.hold.amount_cents),
    currentEndsAt: ctx.currentEnds,
    lastBookableAt: ctx.lastBookableAt,
    spendCents: ctx.hostSpend,
    results: goal === "sales" ? results.tickets : goal === "signups" ? results.sign_ups : results.clicks,
    resultsLast3Days: results.last3Days,
    costPerResult: Number.isFinite(mid) && mid > 0 && Number.isFinite(high) && high > 0
      ? { midCents: mid, highCents: high }
      : null,
    stock,
    walletCents,
    lastTicketsOffered,
    stopReason,
  });
  if (!suggestion || suggestion.apply_action !== "change_live") return suggestion;
  const dry = planHostLiveEdit(liveEditInput(plan, ctx, nowMs, {
    newHostBudgetCents: suggestion.host_budget_cents,
    newEndsAt: suggestion.ends_at,
    acknowledgeLearningReset: false,
  }));
  return dry.ok ? suggestion : null;
}

/**
 * #4238 Overview: loads what the pure hostAdOverview maths needs and builds
 * the additive `overview` block. Any field whose read fails is null.
 */
async function buildHostAdOverview(input: {
  // deno-lint-ignore no-explicit-any
  db: any;
  planId: string | null;
  planState: string | null;
  planCurrency: string | null;
  planCapCents: number | null;
  planGuidance: Record<string, unknown> | null;
  planCampaigns: Record<string, unknown>[];
  planCampaignIds: string[];
  spendByCampaign: Map<string, { total: number; currencies: Set<string>; valid: boolean }>;
  creditByCampaign: Map<string, number>;
  hostSpendEquivalentCents: number | null;
  counts: { orders: number; tickets: number; sign_ups: number } | null;
  conversions: { touch_id?: unknown; order_id?: unknown }[];
  series: Awaited<ReturnType<typeof buildHostDailySeries>> | null;
  creatives: Record<string, unknown>[];
  liveSinceMs: number | null;
  nowMs: number;
  convert: (input: { amount: number; platform: string; source: string }) => Promise<number | null>;
}): Promise<Record<string, unknown>> {
  const phase = hostAdOverviewPhase({ planState: input.planState, campaigns: input.planCampaigns });
  const goal = hostAdOverviewGoal(input.planGuidance);
  const total = (key: "impressions" | "clicks" | "page_visits"): number | null => {
    if (!input.series) return null;
    const values = input.series.daily.map((point) => point[key])
      .filter((value): value is number => typeof value === "number");
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
  };
  const shown = total("impressions");
  const taps = total("clicks");
  const visits = total("page_visits");
  const bought = input.counts
    ? goal === "signups" ? input.counts.sign_ups : input.counts.orders
    : null;
  let checkoutStarted: number | null = null;
  if (goal === "sales" && input.counts) {
    const purchaseTouchIds = [
      ...new Set(input.conversions.flatMap((row) =>
        typeof row.order_id === "string" && typeof row.touch_id === "string" ? [row.touch_id] : []
      )),
    ];
    checkoutStarted = await loadHostAdCheckoutStarted(input.db, {
      campaignIds: input.planCampaignIds,
      purchaseTouchIds,
      bought: input.counts.orders,
    });
  }
  const starts = input.planCampaigns.map((row) => row.starts_at);
  const startMs = starts.map((value) => typeof value === "string" ? Date.parse(value) : NaN)
    .filter((value) => Number.isFinite(value));
  const verdict = hostAdVerdict({
    snapshot: input.planGuidance,
    spendCredit: input.hostSpendEquivalentCents,
    results: input.counts
      ? goal === "signups" ? input.counts.sign_ups : input.counts.tickets
      : 0,
    liveSinceMs: input.liveSinceMs,
    earliestStartMs: startMs.length > 0 ? Math.min(...startMs) : null,
    nowMs: input.nowMs,
    phase,
    hasPlan: input.planId !== null && input.counts !== null,
    funnel: { shown, taps, visits, checkout: checkoutStarted, bought },
  });
  const visitsByCampaign = new Map(
    (input.series?.by_campaign_visits ?? []).map((row) => [row.campaign_id, row.page_visits]),
  );
  const pace = hostAdPace({
    phase,
    currency: input.planCurrency,
    totalCreditCents: input.planCapCents,
    spentCreditCents: input.hostSpendEquivalentCents,
    nowMs: input.nowMs,
    campaigns: input.planCampaigns.map((row) => {
      const id = String(row.id);
      return {
        ...(row as unknown as Parameters<typeof providerCapCents>[0]),
        id,
        platform: row.platform as Platform,
        starts_at: typeof row.starts_at === "string" ? row.starts_at : null,
        ends_at: typeof row.ends_at === "string" ? row.ends_at : null,
        status_synced_at: typeof row.status_synced_at === "string" ? row.status_synced_at : null,
        auto_pause_reason: typeof row.auto_pause_reason === "string" ? row.auto_pause_reason : null,
        provider_spend_cents: input.spendByCampaign.get(id)?.total ?? 0,
        spent_credit_cents: input.creditByCampaign.get(id) ?? null,
        page_visits: visitsByCampaign.get(id) ?? 0,
      };
    }),
  });
  let bestVideo: Awaited<ReturnType<typeof hostAdBestVideo>> = null;
  if (phase !== "review" && phase !== "rejected" && input.planCampaignIds.length > 0) {
    const metricRows = await hostAdReadAllPages<HostAdCreativeMetricRow>((from, to) =>
      input.db.from("ad_creative_metrics_daily")
        .select("creative_id, platform, spend_cents, link_clicks, currency")
        .in("campaign_id", input.planCampaignIds).order("id").range(from, to)
    );
    const names = new Map<string, string>();
    for (const ad of input.creatives) {
      const linked = Array.isArray(ad.ad_creatives) ? ad.ad_creatives[0] : ad.ad_creatives;
      const creative = linked && typeof linked === "object" ? linked as Record<string, unknown> : null;
      if (creative && typeof creative.id === "string" && typeof creative.name === "string" && creative.name.trim()) {
        names.set(creative.id, creative.name.trim());
      }
    }
    bestVideo = metricRows === null ? null : await hostAdBestVideo({
      rows: metricRows.map((row) => ({
        ...row,
        spend_cents: row.spend_cents === null ? null : Number(row.spend_cents),
        link_clicks: row.link_clicks === null ? null : Number(row.link_clicks),
      })),
      hostCurrency: input.planCurrency,
      convert: input.convert,
      names,
    });
  }
  return {
    verdict,
    checkout_started: checkoutStarted,
    run_days: hostAdRunDays(starts, input.planCampaigns.map((row) => row.ends_at)),
    synced_at: hostAdSyncedAt(input.planCampaigns),
    pace,
    best_video: bestVideo,
  };
}

/** #4238 W5 (8a): counted results for a plan's campaigns, in tickets. */
async function loadPlanResults(
  // deno-lint-ignore no-explicit-any
  db: any,
  campaignIds: string[],
  goal: "sales" | "signups" | "visits",
  nowMs: number,
): Promise<{ orders: number; tickets: number; sign_ups: number; clicks: number; clicks_7d: number; last3Days: number }> {
  const sinceDay = (days: number) => new Date(nowMs - days * 86_400_000).toISOString().slice(0, 10);
  const { data: spendRows } = await db.from("ad_spend_daily").select("clicks,spend_date")
    .in("campaign_id", campaignIds);
  const spend = (spendRows ?? []) as { clicks?: unknown; spend_date?: unknown }[];
  const clicks = spend.reduce((sum, row) => sum + Math.max(0, Number(row.clicks) || 0), 0);
  const clicks7d = spend.filter((row) => String(row.spend_date ?? "") >= sinceDay(7))
    .reduce((sum, row) => sum + Math.max(0, Number(row.clicks) || 0), 0);
  const { data: raw } = await db.from("ad_conversions")
    .select("touch_id, event_type, order_id, event_id, created_at")
    .in("campaign_id", campaignIds);
  const rawRows = (raw ?? []) as Record<string, unknown>[];
  const touchIds = [...new Set(rawRows.flatMap((row) => typeof row.touch_id === "string" ? [row.touch_id] : []))];
  const { data: touches } = touchIds.length > 0
    ? await db.from("ad_attribution_touches").select("id, created_at").in("id", touchIds)
    : { data: [] };
  const counted = minglaCountedConversions(
    rawRows,
    new Map(((touches ?? []) as { id: unknown; created_at?: unknown }[]).map((row) => [String(row.id), row.created_at])),
  );
  const counts = await countPlanResults(db, counted);
  const recent = counted.filter((row) => String(row.created_at ?? "") >= new Date(nowMs - 3 * 86_400_000).toISOString());
  const recentCounts = await countPlanResults(db, recent);
  return {
    ...counts,
    clicks,
    clicks_7d: clicks7d,
    last3Days: goal === "sales"
      ? recentCounts.tickets
      : goal === "signups"
      ? recentCounts.sign_ups
      : spend.filter((row) => String(row.spend_date ?? "") >= sinceDay(3))
        .reduce((sum, row) => sum + Math.max(0, Number(row.clicks) || 0), 0),
  };
}

/** Tickets per counted order and heads per counted RSVP (8a). */
async function countPlanResults(
  // deno-lint-ignore no-explicit-any
  db: any,
  rows: Record<string, unknown>[],
): Promise<{ orders: number; tickets: number; sign_ups: number }> {
  const orderIds = [...new Set(rows.flatMap((row) => typeof row.order_id === "string" ? [row.order_id] : []))];
  const rsvpIds = [
    ...new Set(rows.flatMap((row) =>
      row.event_type === "reservation" && typeof row.order_id !== "string" &&
        typeof row.event_id === "string" && UUID_REGEX.test(row.event_id)
        ? [row.event_id]
        : []
    )),
  ];
  const [{ data: tickets }, { data: rsvps }] = await Promise.all([
    orderIds.length > 0
      ? db.from("tickets").select("order_id").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    rsvpIds.length > 0
      ? db.from("event_rsvps").select("id, plus_count").in("id", rsvpIds)
      : Promise.resolve({ data: [] }),
  ]);
  const ticketsByOrder = new Map<string, number>();
  for (const row of (tickets ?? []) as { order_id: unknown }[]) {
    const key = String(row.order_id);
    ticketsByOrder.set(key, (ticketsByOrder.get(key) ?? 0) + 1);
  }
  const rsvpHeads = new Map<string, number>(
    ((rsvps ?? []) as { id: unknown; plus_count?: unknown }[]).map((row) => [
      String(row.id),
      1 + Math.max(0, Math.floor(Number(row.plus_count) || 0)),
    ]),
  );
  return hostAdResultCounts({ conversions: rows, ticketsByOrder, rsvpHeads });
}

function liveEditInput(
  plan: Record<string, unknown>,
  ctx: LiveEditContext,
  nowMs: number,
  change: { newHostBudgetCents: unknown; newEndsAt: unknown; acknowledgeLearningReset: boolean },
): Parameters<typeof planHostLiveEdit>[0] {
  return {
    planState: String(plan.state),
    lastEditAt: ctx.lastEditAt,
    nowMs,
    newHostBudgetCents: change.newHostBudgetCents,
    newEndsAt: change.newEndsAt,
    currentHostBudgetCents: Number(ctx.hold.amount_cents),
    currentEndsAt: ctx.currentEnds,
    lastBookableAt: ctx.lastBookableAt,
    hostSpendCents: ctx.hostSpend,
    campaigns: ctx.lines,
    // #4238 6a: the learning-reset guard needs the live date and the Host's
    // explicit acknowledgement (only the literal true counts).
    liveSinceMs: ctx.liveSinceMs,
    acknowledgeLearningReset: change.acknowledgeLearningReset,
  };
}

async function planAndRunLiveEdit(
  // deno-lint-ignore no-explicit-any
  db: any,
  actorId: string,
  brandId: string,
  plan: Record<string, unknown>,
  editKey: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const planId = String(plan.id);
  const versionId = String(plan.current_version_id);
  const loaded = await loadLiveEditContext(db, plan);
  if (!loaded.ok) return { status: loaded.status, body: loaded.body };
  const ctx = loaded.ctx;
  const nowMs = Date.now();
  const suggested = resolveSuggestedEdit(
    body,
    "suggestion_id" in body ? await loadPlanSuggestion(db, brandId, plan, ctx, nowMs) : null,
    { currentTotalCents: Number(ctx.hold.amount_cents), liveSinceMs: ctx.liveSinceMs, nowMs },
  );
  if (!suggested.ok) {
    return { status: suggested.status, body: { error: suggested.error, detail: suggested.error } };
  }
  const rows = ctx.rows;
  const currentEnds = ctx.currentEnds;
  const planned = planHostLiveEdit(liveEditInput(plan, ctx, nowMs, suggested.change));
  if (!planned.ok) {
    return {
      status: planned.error === "host_ad_live_edit_once_a_day" ||
          planned.error === "host_ad_live_edit_learning_reset"
        ? 409
        : 422,
      body: {
        error: planned.error,
        ...(planned.detail ? { detail: planned.detail } : {}),
        ...(planned.learning ? planned.learning : {}),
      },
    };
  }
  const onProblem = (problem: HostLiveEditProblem): Promise<void> =>
    recordLiveEditProblem(db, { planId, versionId, brandId, actorId, editKey, rows, problem });
  return await runHostLiveEdit({ db, getAdapter, onProblem }, {
    plan: planned,
    planId,
    versionId,
    planHash: String(ctx.version.plan_hash),
    campaigns: rows,
    actorId,
    idempotencyKey: editKey,
    previousEndsAt: currentEnds,
  });
}

/**
 * #4238 r8 P2-1 / r9 P3: an app may be on an amount Mingla did not record.
 * Written on each affected campaign's status trail, then staff are emailed.
 * Never throws.
 */
async function recordLiveEditProblem(
  // deno-lint-ignore no-explicit-any
  db: any,
  input: {
    planId: string;
    versionId: string;
    brandId: string;
    actorId: string;
    editKey: string;
    rows: Record<string, unknown>[];
    problem: HostLiveEditProblem;
  },
): Promise<void> {
  const { problem } = input;
  const affected = input.rows.filter((row) => problem.platforms.includes(row.platform as Platform));
  if (affected.length > 0) {
    try {
      const { error } = await db.from("ad_status_events").insert(affected.map((row) => ({
        campaign_id: row.id,
        platform: row.platform,
        entity: "campaign",
        action: "budget_change",
        actor: input.actorId,
        from_status: row.status ?? null,
        to_status: row.status ?? null,
        external_ids: { plan_id: input.planId, plan_version_id: input.versionId },
        provider_response: {
          host_live_edit_problem: problem.kind,
          detail: problem.detail.slice(0, 500),
          idempotency_key: input.editKey,
        },
      })));
      if (error) {
        console.error("[host-ad-campaign] live edit problem not recorded:", String(error.message ?? "").slice(0, 300));
      }
    } catch (error) {
      console.error("[host-ad-campaign] live edit problem not recorded:", error instanceof Error ? error.message : String(error));
    }
  }
  await notifyHostLiveEditProblem({
    planId: input.planId,
    brandId: input.brandId,
    actorId: input.actorId,
    kind: problem.kind,
    platforms: problem.platforms,
    detail: problem.detail,
    idempotencyKey: input.editKey,
  });
}
