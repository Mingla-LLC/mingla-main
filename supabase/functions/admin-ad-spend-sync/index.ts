/**
 * admin-ad-spend-sync — toward #3697 Wave 2 (#3701 / #3705).
 *
 * Hourly worker (pg_cron): pull platform daily spend into ad_spend_daily,
 * pause ACTIVE campaigns at 98% of cap_cents or after ends_at.
 *
 * Auth: service-role Bearer (cron) OR active admin JWT (manual refresh).
 * verify_jwt = false so the cron POST is accepted; in-code gate is mandatory.
 *
 * Meta: Graph insights (time_increment=1). Other platforms: skip fetch this
 * wave (no spend rows written) but still enforce end-date pause when set.
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
  isPlatform,
  type Platform,
} from "../_shared/adChannel.ts";
import {
  type CampaignSpendTarget,
  decideSpendSync,
  parseMetaInsightsSpend,
  type SpendDayRow,
} from "../_shared/adSpendSync.ts";
import { metaGraph, resolveMetaClient } from "../_shared/meta.ts";

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

function isServiceBearer(req: Request): boolean {
  if (!SERVICE_KEY) return false;
  const header = req.headers.get("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (presented.length !== SERVICE_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < SERVICE_KEY.length; i += 1) {
    diff |= presented.charCodeAt(i) ^ SERVICE_KEY.charCodeAt(i);
  }
  return diff === 0;
}

async function isActiveAdmin(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  req: Request,
): Promise<boolean> {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const jwt = header.slice(7).trim();
  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user?.email) return false;
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  return !!adminRow;
}

async function fetchMetaSpendDays(
  conn: AdConnectionRow,
  externalCampaignId: string,
): Promise<SpendDayRow[]> {
  const client = resolveMetaClient(conn);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const until = new Date();
  const payload = await metaGraph(
    client,
    "GET",
    `${externalCampaignId}/insights`,
    {
      fields:
        "spend,impressions,clicks,inline_link_clicks,account_currency,date_start",
      time_increment: 1,
      time_range: JSON.stringify({
        since: since.toISOString().slice(0, 10),
        until: until.toISOString().slice(0, 10),
      }),
      level: "campaign",
      limit: 100,
    },
  );
  return parseMetaInsightsSpend(payload);
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const serviceOk = isServiceBearer(req);
  const adminOk = serviceOk ? false : await isActiveAdmin(supabase, req);
  if (!serviceOk && !adminOk) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    body = {};
  }
  const onlyCampaignId = typeof body.campaign_id === "string"
    ? body.campaign_id
    : null;

  let query = supabase
    .from("ad_campaigns")
    .select(
      "id, platform, external_campaign_id, status, cap_cents, ends_at, currency, connection_id",
    )
    .in("status", ["ACTIVE", "PAUSED"])
    .order("status_synced_at", { ascending: true, nullsFirst: true })
    .limit(80);
  if (onlyCampaignId) query = query.eq("id", onlyCampaignId);

  const { data: campaigns, error: listErr } = await query;
  if (listErr) {
    return json({ error: "list_failed", detail: listErr.message }, 503);
  }

  const results: Array<Record<string, unknown>> = [];
  let paused = 0;
  let upserted = 0;

  for (const raw of campaigns ?? []) {
    const row = raw as Record<string, unknown>;
    const platform = String(row.platform ?? "");
    if (!isPlatform(platform)) {
      results.push({ campaign_id: row.id, skipped: "platform_invalid" });
      continue;
    }
    const target: CampaignSpendTarget = {
      id: String(row.id),
      platform: platform as Platform,
      external_campaign_id: String(row.external_campaign_id ?? ""),
      status: String(row.status ?? ""),
      cap_cents: typeof row.cap_cents === "number" ? row.cap_cents : null,
      ends_at: typeof row.ends_at === "string" ? row.ends_at : null,
      currency: typeof row.currency === "string" ? row.currency : "USD",
    };
    if (!target.external_campaign_id) {
      results.push({ campaign_id: target.id, skipped: "no_external_id" });
      continue;
    }

    let days: SpendDayRow[] = [];
    try {
      if (platform === "meta") {
        const { data: conn } = await supabase
          .from("ad_connections")
          .select("*")
          .eq("id", row.connection_id)
          .maybeSingle();
        if (!conn) throw new AdNotConnectedError("meta");
        days = await fetchMetaSpendDays(
          conn as AdConnectionRow,
          target.external_campaign_id,
        );
      }
      // Other platforms: empty days this wave; end-date pause still applies.
    } catch (err) {
      const detail =
        err instanceof AdApiError || err instanceof AdNotConnectedError
          ? err.message
          : err instanceof Error
          ? err.message
          : String(err);
      results.push({ campaign_id: target.id, error: detail });
      continue;
    }

    const decision = decideSpendSync({ campaign: target, days });
    if (decision.upserts.length > 0) {
      const { error: upErr } = await supabase.from("ad_spend_daily").upsert(
        decision.upserts,
        { onConflict: "campaign_id,platform,spend_date" },
      );
      if (upErr) {
        results.push({ campaign_id: target.id, error: upErr.message });
        continue;
      }
      upserted += decision.upserts.length;
    }

    if (decision.pause && target.status === "ACTIVE") {
      try {
        const { data: conn } = await supabase
          .from("ad_connections")
          .select("*")
          .eq("id", row.connection_id)
          .maybeSingle();
        if (conn) {
          const adapter = getAdapter(platform as Platform);
          await adapter.setStatus(
            conn as AdConnectionRow,
            "campaign",
            target.external_campaign_id,
            "PAUSED",
          );
        }
        await supabase
          .from("ad_campaigns")
          .update({
            status: "PAUSED",
            status_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", target.id);
        await supabase.from("ad_status_events").insert({
          campaign_id: target.id,
          platform: target.platform,
          entity: "campaign",
          action: "pause",
          actor: null,
          from_status: "ACTIVE",
          to_status: "PAUSED",
          external_ids: { external_campaign_id: target.external_campaign_id },
          provider_response: {
            reason: decision.pause,
            total_spend_cents: decision.total_spend_cents,
            cap_cents: target.cap_cents,
          },
        });
        paused += 1;
        results.push({
          campaign_id: target.id,
          paused: decision.pause,
          total_spend_cents: decision.total_spend_cents,
          days: decision.upserts.length,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        results.push({
          campaign_id: target.id,
          pause_failed: detail,
          total_spend_cents: decision.total_spend_cents,
        });
      }
    } else {
      results.push({
        campaign_id: target.id,
        total_spend_cents: decision.total_spend_cents,
        days: decision.upserts.length,
      });
    }
  }

  return json({
    ok: true,
    scanned: (campaigns ?? []).length,
    upserted,
    paused,
    results,
  });
});
