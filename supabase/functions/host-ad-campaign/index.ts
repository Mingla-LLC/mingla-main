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
  isSyntheticHostExternalId,
  setCampaignTreeStatus,
} from "../_shared/adCampaignProviderSync.ts";
import { notifyAdLaunchAttempt } from "../_shared/adLaunchAttemptOpsAlert.ts";
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

  if (action === "list") {
    const { data, error } = await supabase
      .from("ad_campaigns")
      .select(
        "id, name, status, platform, daily_budget_cents, lifetime_budget_cents, cap_cents, currency, starts_at, ends_at, dest_page_type, dest_url, brand_id, owner_kind, created_at",
      )
      .eq("brand_id", brandId)
      .eq("owner_kind", "host")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      return json({ error: "apply_failed", detail: error.message }, 502);
    }
    return json({ ok: true, campaigns: data ?? [] });
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
      return json({ error: "apply_failed", detail: error.message }, 502);
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
        supabase.from("ad_plans").select("state")
          .eq("current_version_id", data.plan_version_id).maybeSingle(),
        supabase.from("ad_plan_versions")
          .select("host_currency,host_budget_cents,canonical_plan")
          .eq("id", data.plan_version_id)
          .eq("plan_hash", data.plan_hash).maybeSingle(),
        supabase.from("ad_plan_provider_allocations")
          .select(
            "platform,host_currency,provider_currency,host_budget_cents,provider_budget_cents,fx_snapshot_id",
          )
          .eq("plan_version_id", data.plan_version_id),
      ]);
      if (siblings?.length) planCampaigns = siblings;
      providerAllocations = allocations ?? [];
      planState = typeof plan?.state === "string" ? plan.state : null;
      planCurrency = typeof version?.host_currency === "string"
        ? version.host_currency
        : planCurrency;
      planCapCents = typeof version?.host_budget_cents === "number"
        ? version.host_budget_cents
        : planCapCents;
      const canonical = version?.canonical_plan &&
          typeof version.canonical_plan === "object"
        ? version.canonical_plan as Record<string, unknown>
        : null;
      planMeasurement = canonical?.measurement &&
          typeof canonical.measurement === "object"
        ? canonical.measurement as Record<string, unknown>
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

    const { data: conversions } = await supabase
      .from("ad_conversions")
      .select(
        "touch_id, platform, value_cents, currency, shared_with_platforms, created_at",
      )
      .in("campaign_id", planCampaignIds);
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
    const touchIds = [...conversionCounts.keys()];
    const { data: touches } = touchIds.length > 0
      ? await supabase
        .from("ad_attribution_touches")
        .select("id, network, surface, utm")
        .in("id", touchIds)
      : { data: [] };
    const placementMap = new Map<string, {
      platform: string;
      placement: string;
      conversions: number;
    }>();
    for (const row of touches ?? []) {
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

    return json({
      ok: true,
      campaign: data,
      plan_campaigns: planCampaigns,
      plan_state: planState,
      plan_currency: planCurrency,
      plan_cap_cents: planCapCents,
      provider_spend_by_currency: providerSpendByCurrency,
      host_spend_equivalent_cents: hostSpendEquivalentCents,
      host_spend_equivalent_quality: hostSpendEquivalentCents === null
        ? "unavailable"
        : "frozen_plan_fx",
      spend_daily: spend,
      results: {
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
      creatives: creativeRows ?? [],
      timeline: timelineResult.data ?? [],
      credit_events: creditResult.data ?? [],
      settlements: settlementResult.data ?? [],
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
          detail: planCampaignError?.message ?? "plan_campaigns_missing",
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
          detail: planResult.error?.message ?? "plan_state_not_endable",
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
            detail: settlementError.message,
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
        return json({ error: "apply_failed", detail: error.message }, 502);
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
        detail: launchableError.message,
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
      return json({ error: "apply_failed", detail: error.message }, 502);
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
