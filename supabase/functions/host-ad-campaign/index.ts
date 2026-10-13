/**
 * host-ad-campaign — toward #3697 Wave 7c.
 *
 * Host-owned ad campaigns (owner_kind=host): list / create / launch / pause / end.
 * Launch debits Ads credit (campaign_spend). Platform adapter sync is best-effort
 * Meta-deferred: rows land PAUSED/ACTIVE in DB; Admin adapters remain the full
 * creative matrix. Ari tools call these actions.
 *
 * Actions: list | get | create | launch | pause | end
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
    return json({ error: "validation_error", detail: "brand_id_invalid_uuid" }, 400);
  }

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
    if (error) return json({ error: "apply_failed", detail: error.message }, 502);
    return json({ ok: true, campaigns: data ?? [] });
  }

  if (action === "get") {
    const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : "";
    if (!UUID_REGEX.test(campaignId)) {
      return json({ error: "validation_error", detail: "campaign_id_invalid" }, 400);
    }
    const { data, error } = await supabase
      .from("ad_campaigns")
      .select("*")
      .eq("id", campaignId)
      .eq("brand_id", brandId)
      .eq("owner_kind", "host")
      .maybeSingle();
    if (error) return json({ error: "apply_failed", detail: error.message }, 502);
    if (!data) return json({ error: "validation_error", detail: "campaign_not_found" }, 404);
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
      : "USD";
    const budgetCents = typeof body.budget_cents === "number" ? body.budget_cents : NaN;
    const destUrl = typeof body.dest_url === "string" ? body.dest_url.trim() : "";
    const destPageType = typeof body.dest_page_type === "string"
      ? body.dest_page_type.trim()
      : "brand";
    const primaryText = typeof body.primary_text === "string"
      ? body.primary_text.trim()
      : "";
    const startsAt = typeof body.starts_at === "string" ? body.starts_at : null;
    const endsAt = typeof body.ends_at === "string" ? body.ends_at : null;
    const idem = typeof body.idempotency_key === "string"
      ? body.idempotency_key.trim()
      : "";
    if (name.length < 2 || !Number.isFinite(budgetCents) || budgetCents < 100) {
      return json({ error: "validation_error", detail: "create_fields_invalid" }, 400);
    }
    if (destUrl.length < 8 || !/^https?:\/\//i.test(destUrl)) {
      return json({ error: "validation_error", detail: "dest_url_invalid" }, 400);
    }
    if (idem.length < 8) {
      return json({
        error: "validation_error",
        detail: "idempotency_key_required",
      }, 400);
    }

    // connection_id is NOT NULL — Host create requires an existing platform connection.
    const { data: conn } = await supabase
      .from("ad_connections")
      .select("id, platform")
      .eq("platform", platform)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conn?.id) {
      return json({
        error: "validation_error",
        detail: "ad_connection_required",
      }, 409);
    }

    const { data: brandRow } = await supabase
      .from("brands")
      .select("slug")
      .eq("id", brandId)
      .maybeSingle();
    const brandSlug = typeof brandRow?.slug === "string" && brandRow.slug.length > 0
      ? brandRow.slug
      : brandId.slice(0, 8);

    const externalCampaignId = `host_draft_${idem.slice(0, 40)}`;
    const { data: existing } = await supabase
      .from("ad_campaigns")
      .select("id, status, name")
      .eq("platform", platform)
      .eq("external_campaign_id", externalCampaignId)
      .maybeSingle();
    if (existing?.id) {
      return json({
        ok: true,
        campaign: existing,
        campaign_id: existing.id,
        replayed: true,
      });
    }

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
        dest_page_type: destPageType,
        dest_brand_slug: brandSlug,
        dest_url: destUrl,
        // A4.f demoted OneLink slot — Host drafts reuse dest_url until AppsFlyer build lands.
        dest_smart_link: destUrl,
        starts_at: startsAt,
        ends_at: endsAt,
        created_by: user.id,
        request_id: idem.slice(0, 120),
        external_campaign_id: externalCampaignId,
        targeting: { primary_text: primaryText, plan_source: "host_ari" },
      })
      .select("id, status, name")
      .single();
    if (error) {
      console.error("[host-ad-campaign] create failed:", error.message);
      return json({ error: "apply_failed", detail: error.message }, 502);
    }
    return json({ ok: true, campaign: created, campaign_id: created.id, replayed: false });
  }

  if (action === "launch" || action === "pause" || action === "end") {
    const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : "";
    const idem = typeof body.idempotency_key === "string"
      ? body.idempotency_key.trim()
      : "";
    if (!UUID_REGEX.test(campaignId)) {
      return json({ error: "validation_error", detail: "campaign_id_invalid" }, 400);
    }
    const { data: camp, error: campErr } = await supabase
      .from("ad_campaigns")
      .select("id, status, brand_id, owner_kind, cap_cents, currency, daily_budget_cents")
      .eq("id", campaignId)
      .eq("brand_id", brandId)
      .eq("owner_kind", "host")
      .maybeSingle();
    if (campErr || !camp) {
      return json({ error: "validation_error", detail: "campaign_not_found" }, 404);
    }

    if (action === "pause") {
      const { error } = await supabase
        .from("ad_campaigns")
        .update({ status: "PAUSED" })
        .eq("id", campaignId);
      if (error) return json({ error: "apply_failed", detail: error.message }, 502);
      return json({ ok: true, campaign_id: campaignId, status: "PAUSED" });
    }

    if (action === "end") {
      const { data: spendRows } = await supabase
        .from("ad_spend_daily")
        .select("spend_cents")
        .eq("campaign_id", campaignId);
      const spent = (spendRows ?? []).reduce(
        (n, r) => n + Number(r.spend_cents ?? 0),
        0,
      );
      const cap = Number(camp.cap_cents ?? camp.daily_budget_cents ?? 0);
      const unspent = Math.max(0, cap - spent);
      if (unspent > 0 && idem.length >= 8) {
        await supabase.rpc("ad_credit_apply", {
          p_brand_id: brandId,
          p_entry_kind: "unspend_return",
          p_amount_cents: unspent,
          p_currency: camp.currency ?? "USD",
          p_idempotency_key: `unspend:${campaignId}:${idem}`,
          p_fee_cents: 0,
          p_pay_cents: null,
          p_refund_cents: null,
          p_campaign_id: campaignId,
          p_external_ref: null,
          p_actor_id: user.id,
          p_metadata: { source: "host-ad-campaign", action: "end" },
        });
      }
      const { error } = await supabase
        .from("ad_campaigns")
        .update({ status: "ARCHIVED" })
        .eq("id", campaignId);
      if (error) return json({ error: "apply_failed", detail: error.message }, 502);
      return json({
        ok: true,
        campaign_id: campaignId,
        status: "ARCHIVED",
        unspent_returned_cents: unspent,
      });
    }

    // launch
    if (idem.length < 8) {
      return json({
        error: "validation_error",
        detail: "idempotency_key_required",
      }, 400);
    }
    if (camp.status === "ACTIVE") {
      return json({ ok: true, campaign_id: campaignId, status: "ACTIVE", replayed: true });
    }
    const debit = Number(camp.cap_cents ?? camp.daily_budget_cents ?? 0);
    if (!Number.isFinite(debit) || debit <= 0) {
      return json({ error: "validation_error", detail: "budget_invalid" }, 400);
    }
    const { error: debitErr } = await supabase.rpc("ad_credit_apply", {
      p_brand_id: brandId,
      p_entry_kind: "campaign_spend",
      p_amount_cents: debit,
      p_currency: camp.currency ?? "USD",
      p_idempotency_key: `campaign_spend:${campaignId}:${idem}`,
      p_fee_cents: 0,
      p_pay_cents: null,
      p_refund_cents: null,
      p_campaign_id: campaignId,
      p_external_ref: null,
      p_actor_id: user.id,
      p_metadata: { source: "host-ad-campaign", action: "launch" },
    });
    if (debitErr) {
      const msg = debitErr.message ?? "";
      if (msg.includes("ad_credit_insufficient")) {
        return json({ error: "insufficient_credit", detail: "balance_too_low" }, 409);
      }
      return json({ error: "apply_failed", detail: msg }, 409);
    }
    const { error } = await supabase
      .from("ad_campaigns")
      .update({ status: "ACTIVE" })
      .eq("id", campaignId);
    if (error) return json({ error: "apply_failed", detail: error.message }, 502);
    return json({
      ok: true,
      campaign_id: campaignId,
      status: "ACTIVE",
      debited_cents: debit,
    });
  }

  return json({ error: "validation_error", detail: "action_invalid" }, 400);
});
