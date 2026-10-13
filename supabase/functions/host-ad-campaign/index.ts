/**
 * host-ad-campaign — toward #3697 Wave 7c / Wave 8 / Wave 9.
 *
 * Host-owned ad campaigns (owner_kind=host): list / create / launch / pause /
 * end / cancel. Launch debits Ads credit (campaign_spend). Cancel only before
 * any platform spend (full credit return); End after spend. Wave 8: every
 * launch attempt emails admins. Wave 9: Meta business-lane create via
 * createFullCampaignAtomic + READY image creative; launch/pause call Meta
 * setStatus (credit compensate if activate fails).
 *
 * Actions: list | get | create | launch | pause | end | cancel
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AdApiError,
  AdNotConnectedError,
  type AdConnectionRow,
  AtomicCreateError,
  createFullCampaignAtomic,
  getAdapter,
} from "../_shared/adChannel.ts";
import {
  buildHostMetaAtomicInput,
  hostDefaultCountriesForCurrency,
  isSyntheticHostExternalId,
  setCampaignTreeStatus,
} from "../_shared/adCampaignProviderSync.ts";
import {
  AdDestinationError,
  resolveAdDestination,
} from "../_shared/adDestination.ts";
import { notifyAdLaunchAttempt } from "../_shared/adLaunchAttemptOpsAlert.ts";

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
  if (camp.platform !== "meta") return;
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
    const adapter = getAdapter("meta");
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

  const isReadAction = action === "list" || action === "get";
  if (isReadAction) {
    const { data: canView, error: viewErr } = await supabase.rpc(
      "biz_can_view_payments_for_brand",
      { p_brand_id: brandId, p_user_id: user.id },
    );
    if (viewErr) {
      console.error("[host-ad-campaign] view auth failed:", viewErr.message);
      return json({ error: "internal_error" }, 500);
    }
    if (canView !== true) {
      return json({ error: "forbidden", detail: "permission_denied" }, 403);
    }
  } else {
    const { data: canManage, error: manageErr } = await supabase.rpc(
      "biz_can_manage_payments_for_brand",
      { p_brand_id: brandId, p_user_id: user.id },
    );
    if (manageErr) {
      console.error("[host-ad-campaign] manage auth failed:", manageErr.message);
      return json({ error: "internal_error" }, 500);
    }
    if (canManage !== true) {
      return json({ error: "forbidden", detail: "permission_denied" }, 403);
    }
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
    const { data: spend } = await supabase
      .from("ad_spend_daily")
      .select("spend_cents, day")
      .eq("campaign_id", campaignId);
    const spendTotal = (spend ?? []).reduce(
      (n, r) => n + Number(r.spend_cents ?? 0),
      0,
    );
    return json({ ok: true, campaign: data, spend_total_cents: spendTotal });
  }

  if (action === "create") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const platform = typeof body.platform === "string"
      ? body.platform.trim().toLowerCase()
      : "meta";
    const currency = typeof body.currency === "string"
      ? body.currency.trim().toUpperCase()
      : "";
    const budgetCents = typeof body.budget_cents === "number"
      ? body.budget_cents
      : NaN;
    const destPageType = typeof body.dest_page_type === "string"
      ? body.dest_page_type.trim()
      : "";
    const destBrandSlug = typeof body.dest_brand_slug === "string"
      ? body.dest_brand_slug.trim()
      : "";
    const destEntitySlug = typeof body.dest_entity_slug === "string"
      ? body.dest_entity_slug.trim()
      : null;
    const primaryText = typeof body.primary_text === "string"
      ? body.primary_text.trim()
      : "";
    const creativeLibraryId = typeof body.creative_library_id === "string"
      ? body.creative_library_id.trim()
      : "";
    const startsAt = typeof body.starts_at === "string" ? body.starts_at : null;
    const endsAt = typeof body.ends_at === "string" ? body.ends_at : null;
    const idem = typeof body.idempotency_key === "string"
      ? body.idempotency_key.trim()
      : "";
    if (
      name.length < 2 ||
      !Number.isFinite(budgetCents) ||
      budgetCents < 100 ||
      !/^[A-Z]{3}$/.test(currency) ||
      destPageType.length < 2 ||
      destBrandSlug.length < 1
    ) {
      return json({
        error: "validation_error",
        detail: "create_fields_invalid",
      }, 400);
    }
    if (idem.length < 8) {
      return json({
        error: "validation_error",
        detail: "idempotency_key_required",
      }, 400);
    }
    // Wave 9: Host provider create is Meta + READY image only.
    if (platform !== "meta") {
      return json({
        error: "validation_error",
        detail: "platform_unsupported",
      }, 422);
    }
    if (!UUID_REGEX.test(creativeLibraryId)) {
      return json({
        error: "validation_error",
        detail: "creative_library_id_required",
      }, 400);
    }
    if (primaryText.length < 1) {
      return json({
        error: "validation_error",
        detail: "primary_text_required",
      }, 400);
    }

    let resolved;
    try {
      resolved = await resolveAdDestination(supabase, {
        page_type: destPageType,
        brand_slug: destBrandSlug,
        entity_slug: destEntitySlug,
      });
    } catch (e) {
      if (e instanceof AdDestinationError) {
        return json({ error: "validation_error", detail: e.code }, e.status);
      }
      throw e;
    }
    if (destPageType === "marketing") {
      return json({
        error: "validation_error",
        detail: "destination_not_host_owned",
      }, 400);
    }
    const { data: brandRow } = await supabase
      .from("brands")
      .select("slug")
      .eq("id", brandId)
      .maybeSingle();
    if (!brandRow?.slug || brandRow.slug !== resolved.brand_slug) {
      return json(
        { error: "forbidden", detail: "destination_brand_mismatch" },
        403,
      );
    }

    const { data: conn } = await supabase
      .from("ad_connections")
      .select("*")
      .eq("platform", "meta")
      .eq("lane", "business")
      .eq("connected", true)
      .eq("status", "connected")
      .maybeSingle();
    if (!conn?.id) {
      return json({
        error: "validation_error",
        detail: "ad_connection_required",
      }, 409);
    }
    const connection = conn as unknown as AdConnectionRow;

    // Idempotency: replay by request_id on this connection (real Meta create).
    const { data: existing } = await supabase
      .from("ad_campaigns")
      .select("id, status, name, brand_id, external_campaign_id")
      .eq("connection_id", connection.id)
      .eq("request_id", idem.slice(0, 120))
      .eq("owner_kind", "host")
      .maybeSingle();
    if (existing?.id) {
      if (existing.brand_id !== brandId) {
        return json({
          error: "validation_error",
          detail: "idempotency_collision",
        }, 409);
      }
      return json({
        ok: true,
        campaign: existing,
        campaign_id: existing.id,
        replayed: true,
        provider_sync: "synced",
      });
    }

    // READY image creative only (business lane, matching content hash).
    const { data: libCreative } = await supabase
      .from("ad_creatives")
      .select("id, kind, status, content_hash")
      .eq("id", creativeLibraryId)
      .maybeSingle();
    if (
      !libCreative ||
      libCreative.kind !== "image" ||
      libCreative.status !== "active" ||
      !libCreative.content_hash
    ) {
      return json({
        error: "validation_error",
        detail: "creative_not_ready",
      }, 422);
    }
    const { data: readyRef } = await supabase
      .from("ad_creative_platform_refs")
      .select("external_ref")
      .eq("creative_id", creativeLibraryId)
      .eq("platform", "meta")
      .eq("lane", "business")
      .eq("external_account_id", connection.external_account_id)
      .eq("external_kind", "image")
      .eq("content_hash", libCreative.content_hash)
      .eq("status", "ready")
      .maybeSingle();
    if (!readyRef?.external_ref) {
      return json({
        error: "validation_error",
        detail: "creative_not_ready",
      }, 422);
    }

    const countries = hostDefaultCountriesForCurrency(currency);
    const destUrl = resolved.canonical_url;
    const atomicInput = buildHostMetaAtomicInput({
      name,
      destUrl,
      message: primaryText,
      imageHash: String(readyRef.external_ref),
      budgetCents,
      countries,
      startsAt,
      endsAt,
    });

    const adapter = getAdapter("meta");
    let created;
    try {
      created = await createFullCampaignAtomic(adapter, connection, atomicInput);
    } catch (err) {
      if (err instanceof AdNotConnectedError) {
        return json({ error: "meta_not_connected", detail: err.detail }, 424);
      }
      if (err instanceof AtomicCreateError) {
        console.error(
          "[host-ad-campaign] atomic create failed:",
          err.message,
          err.failure,
        );
        return json({
          error: "provider_create_failed",
          detail: err.message.slice(0, 500),
          step: err.failure.step,
        }, 502);
      }
      if (err instanceof AdApiError) {
        return json({
          error: "provider_create_failed",
          detail: err.message.slice(0, 500),
        }, 502);
      }
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[host-ad-campaign] create unexpected:", detail);
      return json({ error: "internal_error" }, 500);
    }

    let deliveryStatus: string | null = null;
    try {
      const status = await adapter.getStatus(
        connection,
        "campaign",
        created.externalCampaignId,
      );
      deliveryStatus = status.effectiveStatus;
    } catch {
      deliveryStatus = null;
    }

    const targeting = {
      ...atomicInput.adSet.targeting,
      primary_text: primaryText,
      plan_source: "host_ari",
      provider_sync: "synced",
      creative_library_id: creativeLibraryId,
      countries,
    };

    const { data: campaignRow, error: campaignInsertError } = await supabase
      .from("ad_campaigns")
      .insert({
        connection_id: connection.id,
        name,
        platform: "meta",
        status: "PAUSED",
        objective: "OUTCOME_TRAFFIC",
        daily_budget_cents: budgetCents,
        lifetime_budget_cents: null,
        cap_cents: budgetCents,
        currency,
        brand_id: brandId,
        owner_kind: "host",
        dest_page_type: resolved.page_type,
        dest_brand_slug: resolved.brand_slug,
        dest_entity_slug: resolved.entity_slug ?? null,
        dest_url: destUrl,
        dest_smart_link: destUrl,
        starts_at: startsAt,
        ends_at: endsAt,
        created_by: user.id,
        request_id: idem.slice(0, 120),
        external_campaign_id: created.externalCampaignId,
        delivery_status: deliveryStatus,
        status_synced_at: new Date().toISOString(),
        targeting,
      })
      .select("id, status, name, external_campaign_id")
      .single();
    if (campaignInsertError || !campaignRow) {
      // Compensate: roll back Meta tree so we do not orphan spendable objects.
      try {
        if (adapter.rollbackCreative && created.externalCreativeId) {
          await adapter.rollbackCreative(
            connection,
            created.externalCreativeId,
          );
        }
        if (adapter.rollbackCampaign) {
          await adapter.rollbackCampaign(
            connection,
            created.externalCampaignId,
          );
        }
      } catch (rbErr) {
        console.error(
          "[host-ad-campaign] post-persist rollback failed:",
          rbErr instanceof Error ? rbErr.message : String(rbErr),
          created,
        );
      }
      console.error(
        "[host-ad-campaign] persist campaign failed:",
        campaignInsertError?.message,
      );
      return json({
        error: "apply_failed",
        detail: campaignInsertError?.message ?? "campaign_persist_failed",
      }, 502);
    }

    const { data: adSetRow, error: adSetErr } = await supabase
      .from("ad_sets")
      .insert({
        campaign_id: campaignRow.id,
        external_adset_id: created.externalAdSetId,
        name: atomicInput.adSet.name,
        targeting: atomicInput.adSet.targeting,
        budget_cents: null,
        optimization_goal: "LINK_CLICKS",
        billing_event: "IMPRESSIONS",
        status: "PAUSED",
        schedule_start_at: startsAt,
        schedule_end_at: endsAt,
      })
      .select("id")
      .single();
    if (adSetErr || !adSetRow) {
      console.error("[host-ad-campaign] persist ad_set failed:", adSetErr?.message);
      return json({
        error: "apply_failed",
        detail: adSetErr?.message ?? "ad_set_persist_failed",
      }, 502);
    }

    const { error: adErr } = await supabase.from("ads").insert({
      ad_set_id: adSetRow.id,
      external_ad_id: created.externalAdId,
      external_creative_id: created.externalCreativeId,
      creative_id: creativeLibraryId,
      name: atomicInput.ad.name,
      status: "PAUSED",
      review_status: created.reviewStatus,
    });
    if (adErr) {
      console.error("[host-ad-campaign] persist ad failed:", adErr.message);
      return json({ error: "apply_failed", detail: adErr.message }, 502);
    }

    return json({
      ok: true,
      campaign: campaignRow,
      campaign_id: campaignRow.id,
      replayed: false,
      provider_sync: "synced",
      external_campaign_id: created.externalCampaignId,
    });
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
        "id, status, brand_id, owner_kind, cap_cents, currency, daily_budget_cents, name, platform, connection_id, external_campaign_id, targeting",
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

    if (action === "cancel") {
      const status = String(camp.status ?? "").toUpperCase();
      if (status === "ARCHIVED" || status === "DELETED") {
        return json({
          ok: true,
          campaign_id: campaignId,
          status,
          replayed: true,
          credit_returned_cents: 0,
          action: "cancel",
        });
      }
      if (status !== "ACTIVE" && status !== "PAUSED") {
        return json({
          error: "validation_error",
          detail: "campaign_not_cancelable",
        }, 409);
      }
      const { data: spendRows, error: spendErr } = await supabase
        .from("ad_spend_daily")
        .select("spend_cents")
        .eq("campaign_id", campaignId);
      if (spendErr) {
        return json({
          error: "apply_failed",
          detail: "spend_read_failed",
        }, 502);
      }
      const spent = (spendRows ?? []).reduce(
        (n, r) => n + Number(r.spend_cents ?? 0),
        0,
      );
      // Cancel only before any platform spend — after spend, hosts must End.
      if (spent > 0) {
        return json({
          error: "validation_error",
          detail: "campaign_has_spend_use_end",
        }, 409);
      }
      const { data: spendHold, error: holdErr } = await supabase
        .from("ad_credit_ledger")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("entry_kind", "campaign_spend")
        .limit(1)
        .maybeSingle();
      if (holdErr) {
        return json({ error: "apply_failed", detail: holdErr.message }, 502);
      }
      const cap = Number(camp.cap_cents ?? camp.daily_budget_cents ?? 0);
      let creditReturned = 0;
      if (spendHold && cap > 0) {
        const { error: creditErr } = await supabase.rpc("ad_credit_apply", {
          p_brand_id: brandId,
          p_entry_kind: "unspend_return",
          p_amount_cents: cap,
          p_currency: camp.currency,
          p_idempotency_key: `cancel_return:host:${campaignId}`,
          p_fee_cents: 0,
          p_pay_cents: null,
          p_refund_cents: null,
          p_campaign_id: campaignId,
          p_external_ref: null,
          p_actor_id: user.id,
          p_metadata: { source: "host-ad-campaign", action: "cancel" },
        });
        if (creditErr) {
          return json(
            { error: "apply_failed", detail: creditErr.message },
            409,
          );
        }
        creditReturned = cap;
      }
      await pauseProviderBestEffort(supabase, {
        id: camp.id,
        platform: String(camp.platform ?? ""),
        connection_id: typeof camp.connection_id === "string"
          ? camp.connection_id
          : null,
        external_campaign_id: typeof camp.external_campaign_id === "string"
          ? camp.external_campaign_id
          : null,
      });
      const { data: deleted, error } = await supabase
        .from("ad_campaigns")
        .update({ status: "DELETED" })
        .eq("id", campaignId)
        .in("status", ["ACTIVE", "PAUSED"])
        .select("id")
        .maybeSingle();
      if (error) {
        return json({ error: "apply_failed", detail: error.message }, 502);
      }
      if (!deleted?.id) {
        return json({
          ok: true,
          campaign_id: campaignId,
          status: "DELETED",
          replayed: true,
          credit_returned_cents: creditReturned,
          action: "cancel",
        });
      }
      return json({
        ok: true,
        campaign_id: campaignId,
        status: "DELETED",
        credit_returned_cents: creditReturned,
        action: "cancel",
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
      if (camp.platform !== "meta") {
        return json({
          error: "validation_error",
          detail: "platform_unsupported",
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
        return json({ error: "meta_not_connected" }, 424);
      }
      const tree = await loadProviderTree(
        supabase,
        campaignId,
        String(camp.external_campaign_id),
      );
      try {
        await setCampaignTreeStatus(
          getAdapter("meta"),
          conn as unknown as AdConnectionRow,
          {
            externalCampaignId: String(camp.external_campaign_id),
            adSetExternalIds: tree.adSetExternalIds,
            adExternalIds: tree.adExternalIds,
          },
          "PAUSED",
        );
      } catch (err) {
        if (err instanceof AdNotConnectedError) {
          return json({ error: "meta_not_connected", detail: err.detail }, 424);
        }
        const detail = err instanceof Error ? err.message : String(err);
        return json({ error: "provider_pause_failed", detail: detail.slice(0, 500) }, 502);
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
      return json({
        ok: true,
        campaign_id: campaignId,
        status: "PAUSED",
        provider_sync: "synced",
      });
    }

    if (action === "end") {
      const status = String(camp.status ?? "").toUpperCase();
      if (status === "ARCHIVED" || status === "DELETED") {
        return json({
          ok: true,
          campaign_id: campaignId,
          status,
          replayed: true,
          unspent_returned_cents: 0,
        });
      }
      if (status !== "ACTIVE" && status !== "PAUSED") {
        return json({
          error: "validation_error",
          detail: "campaign_not_endable",
        }, 409);
      }
      // Only release credit that was previously held by launch (campaign_spend).
      // A never-launched PAUSED draft must not mint unspend_return.
      const { data: spendHold, error: holdErr } = await supabase
        .from("ad_credit_ledger")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("entry_kind", "campaign_spend")
        .limit(1)
        .maybeSingle();
      if (holdErr) {
        return json({ error: "apply_failed", detail: holdErr.message }, 502);
      }
      if (!spendHold) {
        return json({
          error: "validation_error",
          detail: "campaign_never_launched",
        }, 409);
      }
      // Pause first so spend feed cannot keep growing while we reconcile.
      if (status === "ACTIVE") {
        await pauseProviderBestEffort(supabase, {
          id: camp.id,
          platform: String(camp.platform ?? ""),
          connection_id: typeof camp.connection_id === "string"
            ? camp.connection_id
            : null,
          external_campaign_id: typeof camp.external_campaign_id === "string"
            ? camp.external_campaign_id
            : null,
        });
        const { error: pauseErr } = await supabase
          .from("ad_campaigns")
          .update({ status: "PAUSED" })
          .eq("id", campaignId)
          .eq("status", "ACTIVE");
        if (pauseErr) {
          return json({ error: "apply_failed", detail: pauseErr.message }, 502);
        }
      }
      const { data: spendRows, error: spendErr } = await supabase
        .from("ad_spend_daily")
        .select("spend_cents")
        .eq("campaign_id", campaignId);
      if (spendErr) {
        return json({
          error: "apply_failed",
          detail: "spend_read_failed",
        }, 502);
      }
      const spent = (spendRows ?? []).reduce(
        (n, r) => n + Number(r.spend_cents ?? 0),
        0,
      );
      // End only after platform spend has begun — before spend, hosts Cancel.
      if (spent <= 0) {
        return json({
          error: "validation_error",
          detail: "campaign_no_spend_use_cancel",
        }, 409);
      }
      const cap = Number(camp.cap_cents ?? camp.daily_budget_cents ?? 0);
      const unspent = Math.max(0, cap - spent);
      // Campaign-scoped key: a second end with a new client key cannot double-credit.
      if (unspent > 0) {
        const { error: creditErr } = await supabase.rpc("ad_credit_apply", {
          p_brand_id: brandId,
          p_entry_kind: "unspend_return",
          p_amount_cents: unspent,
          p_currency: camp.currency,
          p_idempotency_key: `unspend_return:host:${campaignId}`,
          p_fee_cents: 0,
          p_pay_cents: null,
          p_refund_cents: null,
          p_campaign_id: campaignId,
          p_external_ref: null,
          p_actor_id: user.id,
          p_metadata: { source: "host-ad-campaign", action: "end" },
        });
        if (creditErr) {
          return json(
            { error: "apply_failed", detail: creditErr.message },
            409,
          );
        }
      }
      const { data: archived, error } = await supabase
        .from("ad_campaigns")
        .update({ status: "ARCHIVED" })
        .eq("id", campaignId)
        .in("status", ["ACTIVE", "PAUSED"])
        .select("id")
        .maybeSingle();
      if (error) {
        return json({ error: "apply_failed", detail: error.message }, 502);
      }
      if (!archived?.id) {
        return json({
          ok: true,
          campaign_id: campaignId,
          status: "ARCHIVED",
          replayed: true,
          unspent_returned_cents: unspent,
        });
      }
      return json({
        ok: true,
        campaign_id: campaignId,
        status: "ARCHIVED",
        unspent_returned_cents: unspent,
      });
    }

    // launch — debit credit, activate on Meta, then claim PAUSED→ACTIVE.
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
    if (camp.platform !== "meta") {
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "rejected",
        detail: "platform_unsupported",
        idempotencyKey: `ads_launch:host:${campaignId}:platform`,
      });
      return json({
        error: "validation_error",
        detail: "platform_unsupported",
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
    const debit = Number(camp.cap_cents ?? camp.daily_budget_cents ?? 0);
    if (!Number.isFinite(debit) || debit <= 0) {
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "rejected",
        detail: "budget_invalid",
        idempotencyKey: `ads_launch:host:${campaignId}:budget_invalid`,
      });
      return json({ error: "validation_error", detail: "budget_invalid" }, 400);
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
        detail: "meta_not_connected",
        idempotencyKey: `ads_launch:host:${campaignId}:not_connected`,
      });
      return json({ error: "meta_not_connected" }, 424);
    }

    // Campaign-scoped debit key so concurrent client keys cannot double-charge.
    const { error: debitErr } = await supabase.rpc("ad_credit_apply", {
      p_brand_id: brandId,
      p_entry_kind: "campaign_spend",
      p_amount_cents: debit,
      p_currency: camp.currency,
      p_idempotency_key: `campaign_spend:host:${campaignId}`,
      p_fee_cents: 0,
      p_pay_cents: null,
      p_refund_cents: null,
      p_campaign_id: campaignId,
      p_external_ref: null,
      p_actor_id: user.id,
      p_metadata: {
        source: "host-ad-campaign",
        action: "launch",
        provider_sync: "synced",
        client_idempotency_key: idem.length >= 8 ? idem : null,
      },
    });
    if (debitErr) {
      const msg = debitErr.message ?? "";
      if (msg.includes("ad_credit_insufficient")) {
        await notifyAdLaunchAttempt({
          ...launchAlertBase,
          outcome: "rejected",
          detail: "balance_too_low",
          idempotencyKey: `ads_launch:host:${campaignId}:insufficient`,
        });
        return json(
          { error: "insufficient_credit", detail: "balance_too_low" },
          409,
        );
      }
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "failed",
        detail: msg.slice(0, 500),
        idempotencyKey: `ads_launch:host:${campaignId}:debit_failed`,
      });
      return json({ error: "apply_failed", detail: msg }, 409);
    }

    const tree = await loadProviderTree(
      supabase,
      campaignId,
      String(camp.external_campaign_id),
    );
    try {
      await setCampaignTreeStatus(
        getAdapter("meta"),
        conn as unknown as AdConnectionRow,
        {
          externalCampaignId: String(camp.external_campaign_id),
          adSetExternalIds: tree.adSetExternalIds,
          adExternalIds: tree.adExternalIds,
        },
        "ACTIVE",
      );
    } catch (err) {
      // Compensate: return the debit so activate failure does not keep credit.
      const { error: compensateErr } = await supabase.rpc("ad_credit_apply", {
        p_brand_id: brandId,
        p_entry_kind: "unspend_return",
        p_amount_cents: debit,
        p_currency: camp.currency,
        p_idempotency_key: `launch_activate_fail_return:host:${campaignId}`,
        p_fee_cents: 0,
        p_pay_cents: null,
        p_refund_cents: null,
        p_campaign_id: campaignId,
        p_external_ref: null,
        p_actor_id: user.id,
        p_metadata: {
          source: "host-ad-campaign",
          action: "launch_activate_compensate",
        },
      });
      if (compensateErr) {
        console.error(
          "[host-ad-campaign] launch compensate failed:",
          compensateErr.message,
        );
      }
      const detail = err instanceof Error ? err.message : String(err);
      await notifyAdLaunchAttempt({
        ...launchAlertBase,
        outcome: "failed",
        detail: `provider_activate_failed:${detail}`.slice(0, 500),
        idempotencyKey: `ads_launch:host:${campaignId}:activate_failed`,
      });
      if (err instanceof AdNotConnectedError) {
        return json({ error: "meta_not_connected", detail: err.detail }, 424);
      }
      return json({
        error: "provider_activate_failed",
        detail: detail.slice(0, 500),
        credit_compensated: !compensateErr,
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
        debited_cents: debit,
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
    await notifyAdLaunchAttempt({
      ...launchAlertBase,
      outcome: "accepted",
      detail: `debited_cents=${debit};provider=meta`,
      idempotencyKey: `ads_launch:host:${campaignId}:accepted`,
    });
    return json({
      ok: true,
      campaign_id: campaignId,
      status: "ACTIVE",
      debited_cents: debit,
      provider_sync: "synced",
    });
  }

  return json({ error: "validation_error", detail: "action_invalid" }, 400);
});
