/**
 * host-ad-campaign — toward #3697 Wave 7c / Wave 8.
 *
 * Host-owned ad campaigns (owner_kind=host): list / create / launch / pause /
 * end / cancel. Launch debits Ads credit (campaign_spend). Cancel only before
 * any platform spend (full credit return); End after spend. Wave 8: every
 * launch attempt emails admins. Provider adapter create/sync remains deferred.
 *
 * Actions: list | get | create | launch | pause | end | cancel
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
      .select("id, platform, connected, status")
      .eq("platform", platform)
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

    const brandCompact = brandId.replace(/-/g, "").slice(0, 12);
    const externalCampaignId = `host_${brandCompact}_${
      idem.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40)
    }`
      .slice(0, 100);
    const { data: existing } = await supabase
      .from("ad_campaigns")
      .select("id, status, name, brand_id")
      .eq("platform", platform)
      .eq("external_campaign_id", externalCampaignId)
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
      });
    }

    const destUrl = resolved.canonical_url;
    const { data: created, error } = await supabase
      .from("ad_campaigns")
      .insert({
        connection_id: conn.id,
        name,
        platform,
        status: "PAUSED",
        objective: platform === "meta" ? "OUTCOME_TRAFFIC" : "TRAFFIC",
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
        external_campaign_id: externalCampaignId,
        targeting: {
          primary_text: primaryText,
          plan_source: "host_ari",
          provider_sync: "pending",
        },
      })
      .select("id, status, name")
      .single();
    if (error) {
      console.error("[host-ad-campaign] create failed:", error.message);
      return json({ error: "apply_failed", detail: error.message }, 502);
    }
    return json({
      ok: true,
      campaign: created,
      campaign_id: created.id,
      replayed: false,
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
        "id, status, brand_id, owner_kind, cap_cents, currency, daily_budget_cents, name, platform",
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
      const { data: paused, error } = await supabase
        .from("ad_campaigns")
        .update({ status: "PAUSED" })
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
      return json({ ok: true, campaign_id: campaignId, status: "PAUSED" });
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

    // launch — claim PAUSED→ACTIVE under a row filter, debit once per campaign.
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
        provider_sync: "pending",
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
    const { data: claimed, error } = await supabase
      .from("ad_campaigns")
      .update({ status: "ACTIVE" })
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
      });
    }
    await notifyAdLaunchAttempt({
      ...launchAlertBase,
      outcome: "accepted",
      detail: `debited_cents=${debit}`,
      idempotencyKey: `ads_launch:host:${campaignId}:accepted`,
    });
    return json({
      ok: true,
      campaign_id: campaignId,
      status: "ACTIVE",
      debited_cents: debit,
      provider_sync: "pending",
    });
  }

  return json({ error: "validation_error", detail: "action_invalid" }, 400);
});
