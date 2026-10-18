/**
 * Issue #3697 — Admin-only native-app provider certification lifecycle.
 * Provider objects are created by the shared native create endpoint only after
 * an exact owner approval. This endpoint loads/approves, activates, stops, and
 * records bounded canary evidence; it never creates a provider campaign.
 */

// @ts-ignore Deno ESM runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno ESM runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AdConnectionRow,
  getAdapter,
  isPlatform,
} from "../_shared/adChannel.ts";
import type { Platform } from "../_shared/adChannelCore.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const APP_KEYS = new Set(["explorer", "business"]);
const OPERATING_SYSTEMS = new Set(["ios", "android"]);
const MUTATION_ORIGINS = new Set([
  "https://admin.usemingla.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(
  row: Record<string, unknown>,
  keys: string[],
): boolean {
  return Object.keys(row).sort().join(",") === [...keys].sort().join(",");
}

function validCell(row: Record<string, unknown>): boolean {
  return APP_KEYS.has(String(row.app_key)) &&
    OPERATING_SYSTEMS.has(String(row.os)) && isPlatform(row.provider);
}

function requiredPhrase(row: Record<string, unknown>): string | null {
  const currency = typeof row.approved_currency === "string"
    ? row.approved_currency
    : "";
  const ceiling = Number(row.approved_spend_ceiling_cents);
  if (!currency || !Number.isSafeInteger(ceiling) || ceiling <= 0) return null;
  return `APPROVE ${String(row.provider).toUpperCase()} ${
    String(row.app_key).toUpperCase()
  } ${String(row.os).toUpperCase()} ${currency} ${ceiling}`;
}

function mediaSource(provider: Platform): string {
  return {
    meta: "facebook_int",
    tiktok: "tiktokglobal_int",
    snapchat: "snapchat_int",
    google: "googleadwords_int",
    reddit: "reddit_int",
  }[provider];
}

function confirmsActive(status: {
  status: string | null;
  effectiveStatus: string | null;
}): boolean {
  const value = `${status.status ?? ""} ${status.effectiveStatus ?? ""}`
    .toUpperCase();
  return /(^|[^A-Z])(ACTIVE|ENABLED?|DELIVERING)([^A-Z]|$)/.test(value) &&
    !/(INACTIVE|DISABLED|PAUSED)/.test(value);
}

function confirmsPaused(status: {
  status: string | null;
  effectiveStatus: string | null;
}): boolean {
  const value = `${status.status ?? ""} ${status.effectiveStatus ?? ""}`
    .toUpperCase();
  return /(PAUSED|DISABLE|SUSPENDED|NOT_DELIVERING)/.test(value) &&
    !/(ACTIVE|ENABLED|DELIVERING)/.test(value.replace("NOT_DELIVERING", ""));
}

async function readConfirmedStatus(
  adapter: ReturnType<typeof getAdapter>,
  connection: AdConnectionRow,
  campaignId: string,
  predicate: (status: {
    status: string | null;
    effectiveStatus: string | null;
  }) => boolean,
) {
  let latest = {
    status: null as string | null,
    effectiveStatus: null as string | null,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    latest = await adapter.getStatus(connection, "campaign", campaignId);
    if (predicate(latest)) return latest;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("provider_status_not_confirmed");
}

// deno-lint-ignore no-explicit-any
async function loadCell(db: any, appKey: string, os: string, provider: string) {
  const { data } = await db.from("ad_app_acquisition_canaries").select("*")
    .eq("app_key", appKey).eq("os", os).eq("provider", provider)
    .maybeSingle();
  return record(data);
}

serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "unauthorized" }, 401);
  const origin = request.headers.get("Origin");
  if (!origin || !MUTATION_ORIGINS.has(origin)) {
    return json({ error: "origin_forbidden" }, 403);
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jwt = authorization.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await db.auth.getUser(jwt);
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const { data: admin } = await db.from("admin_users").select("id,role")
    .eq("email", user.email).eq("status", "active").maybeSingle();
  if (!admin) return json({ error: "forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 16_384) {
      return json({ error: "invalid_request" }, 400);
    }
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const action = String(body.action ?? "");
  if (!validCell(body)) return json({ error: "invalid_request" }, 400);
  const appKey = String(body.app_key);
  const os = String(body.os);
  const provider = body.provider as Platform;

  if (action === "load") {
    if (!exactKeys(body, ["action", "app_key", "os", "provider"])) {
      return json({ error: "invalid_request" }, 400);
    }
    const canary = await loadCell(db, appKey, os, provider);
    if (!canary) return json({ error: "not_found" }, 404);
    const [auditResult, configResult] = await Promise.all([
      db.from("ad_app_canary_audit").select(
        "id,action,actor,reason,previous_state,new_state,created_at",
      ).eq("app_key", appKey).eq("os", os).eq("provider", provider)
        .order("created_at", { ascending: false }).limit(20),
      db.from("admin_config").select("value")
        .eq("key", "enable_native_app_campaign_certification").maybeSingle(),
    ]);
    return json({
      contract_version: 1,
      server_now: new Date().toISOString(),
      role: admin.role,
      enabled: configResult.data?.value === true,
      canary: { ...canary, required_phrase: requiredPhrase(canary) },
      audit: auditResult.data ?? [],
    });
  }

  const commonKeys = [
    "action",
    "app_key",
    "os",
    "provider",
    "expected_canary_version",
    "idempotency_key",
    "reason",
  ];
  if (
    !Number.isSafeInteger(body.expected_canary_version) ||
    Number(body.expected_canary_version) < 1 ||
    typeof body.idempotency_key !== "string" ||
    !UUID_RE.test(body.idempotency_key) ||
    typeof body.reason !== "string" || body.reason.trim().length < 8 ||
    body.reason.length > 240
  ) return json({ error: "invalid_request" }, 400);
  const reason = body.reason.trim();

  const transition = async (extra: Record<string, unknown>) => {
    const { data, error } = await db.rpc("transition_ad_app_canary", {
      p_change: {
        action: extra.transition_action ?? action,
        app_key: appKey,
        os,
        provider,
        actor: user.id,
        reason,
        expected_canary_version: body.expected_canary_version,
        idempotency_key: body.idempotency_key,
        ...Object.fromEntries(
          Object.entries(extra).filter(([key]) => key !== "transition_action"),
        ),
      },
    });
    if (error) {
      return json(
        { error: "certification_conflict", detail: error.message },
        409,
      );
    }
    return json({ ok: true, canary: data });
  };

  if (action === "request_approval") {
    if (
      !exactKeys(body, [...commonKeys, "plan_version_id", "plan_hash"]) ||
      typeof body.plan_version_id !== "string" ||
      !ANY_UUID_RE.test(body.plan_version_id) ||
      typeof body.plan_hash !== "string" || !HASH_RE.test(body.plan_hash)
    ) return json({ error: "invalid_request" }, 400);
    return transition({
      plan_version_id: body.plan_version_id,
      plan_hash: body.plan_hash,
    });
  }
  if (action === "approve") {
    if (
      !exactKeys(body, [
        ...commonKeys,
        "approval_reference",
        "confirm_phrase",
      ]) ||
      admin.role !== "owner" || typeof body.approval_reference !== "string" ||
      typeof body.confirm_phrase !== "string"
    ) return json({ error: "forbidden" }, 403);
    return transition({
      approval_reference: body.approval_reference,
      confirm_phrase: body.confirm_phrase,
    });
  }
  if (action === "expire") {
    if (!exactKeys(body, commonKeys)) {
      return json({ error: "invalid_request" }, 400);
    }
    return transition({ transition_action: "expire" });
  }
  if (action === "record_evidence") {
    if (
      !exactKeys(body, [
        ...commonKeys,
        "result",
        "provenance",
        "install_timestamp",
      ]) || !["passed", "failed"].includes(String(body.result)) ||
      !["provider_api", "appsflyer_api", "provider_dashboard"].includes(
        String(body.provenance),
      ) || typeof body.install_timestamp !== "string" ||
      !Number.isFinite(Date.parse(body.install_timestamp))
    ) return json({ error: "invalid_request" }, 400);
    const canary = await loadCell(db, appKey, os, provider);
    const { data: settlement, error: settlementError } =
      canary?.local_campaign_id
        ? await db.from("ad_campaign_settlements")
          .select("state,final_host_spend_cents,final_provider_spend_cents")
          .eq("campaign_id", canary.local_campaign_id).maybeSingle()
        : { data: null, error: null };
    if (settlementError || !settlement) {
      return json({ error: "certification_spend_not_final" }, 409);
    }
    if (settlement.state === "attention_required") {
      return transition({ transition_action: "spend_exceeded" });
    }
    if (
      settlement.state !== "settled" ||
      !Number.isSafeInteger(Number(settlement.final_host_spend_cents))
    ) {
      return json({
        error: "certification_spend_not_final",
        detail: "Wait for provider spend sync and the 24-hour finality window.",
      }, 409);
    }
    const { data: target } = await db.from("ad_app_targets")
      .select("store_identifier").eq("app_key", appKey).eq("os", os)
      .eq("active", true).maybeSingle();
    if (!canary?.safe_provider_campaign_id || !target?.store_identifier) {
      return json({ error: "certification_conflict" }, 409);
    }
    return transition({
      transition_action: body.result === "passed"
        ? "evidence_passed"
        : "evidence_failed",
      safe_evidence: {
        provenance: body.provenance,
        store_identifier: target.store_identifier,
        media_source: mediaSource(provider),
        campaign_id: canary.safe_provider_campaign_id,
        install_timestamp: body.install_timestamp,
        device_os: os,
        result: body.result,
      },
    });
  }

  if (action !== "launch" && action !== "stop") {
    return json({ error: "invalid_request" }, 400);
  }
  const expectedKeys = action === "launch"
    ? [...commonKeys, "confirm_phrase"]
    : commonKeys;
  if (
    !exactKeys(body, expectedKeys) ||
    (action === "launch" && body.confirm_phrase !== "LAUNCH CERTIFICATION")
  ) return json({ error: "invalid_request" }, 400);

  const canary = await loadCell(db, appKey, os, provider);
  if (!canary || typeof canary.local_campaign_id !== "string") {
    return json({ error: "certification_conflict" }, 409);
  }
  const { data: campaign } = await db.from("ad_campaigns").select("*")
    .eq("id", canary.local_campaign_id).maybeSingle();
  if (!campaign || campaign.platform !== provider) {
    return json({ error: "certification_conflict" }, 409);
  }
  const { data: connectionRow } = await db.from("ad_connections").select("*")
    .eq("id", campaign.connection_id).maybeSingle();
  if (
    !connectionRow || connectionRow.connected !== true ||
    connectionRow.status !== "connected"
  ) return json({ error: `${provider}_not_connected` }, 424);
  const connection = connectionRow as unknown as AdConnectionRow;
  const adapter = getAdapter(provider);
  const { data: adSets } = await db.from("ad_sets").select("*")
    .eq("campaign_id", campaign.id);
  const adSetIds = (adSets ?? []).map((row: Record<string, unknown>) =>
    String(row.id)
  );
  const { data: ads } = adSetIds.length
    ? await db.from("ads").select("*").in("ad_set_id", adSetIds)
    : { data: [] };

  if (action === "launch") {
    const { data: allowed, error: allowedError } = await db.rpc(
      "can_run_native_app_canary",
      {
        p_app_key: appKey,
        p_os: os,
        p_provider: provider,
        p_plan_version_id: canary.plan_version_id,
        p_plan_hash: canary.plan_hash,
      },
    );
    if (allowedError || allowed !== true) {
      return json({ error: "certification_launch_not_authorized" }, 409);
    }
    try {
      await adapter.setStatus(
        connection,
        "campaign",
        campaign.external_campaign_id,
        "ACTIVE",
      );
      for (const row of adSets ?? []) {
        await adapter.setStatus(
          connection,
          "ad_set",
          String(row.external_adset_id),
          "ACTIVE",
        );
      }
      for (const row of ads ?? []) {
        await adapter.setStatus(
          connection,
          "ad",
          String(row.external_ad_id),
          "ACTIVE",
        );
      }
      const status = await readConfirmedStatus(
        adapter,
        connection,
        campaign.external_campaign_id,
        confirmsActive,
      );
      const effective = status.effectiveStatus ?? status.status ?? "ACTIVE";
      const response = await transition({
        transition_action: "provider_started",
        provider_effective_status: effective,
      });
      if (response.status >= 400) {
        await adapter.setStatus(
          connection,
          "campaign",
          campaign.external_campaign_id,
          "PAUSED",
        ).catch(() => undefined);
        return response;
      }
      await db.from("ad_campaigns").update({
        status: "ACTIVE",
        delivery_status: effective,
        status_synced_at: new Date().toISOString(),
      }).eq("id", campaign.id);
      if (adSetIds.length) {
        await db.from("ad_sets").update({ status: "ACTIVE" }).in(
          "id",
          adSetIds,
        );
        await db.from("ads").update({ status: "ACTIVE" }).in(
          "ad_set_id",
          adSetIds,
        );
      }
      await db.from("ad_plans").update({ state: "live" })
        .eq("current_version_id", canary.plan_version_id);
      await db.from("ad_status_events").insert({
        campaign_id: campaign.id,
        platform: provider,
        entity: "campaign",
        action: "launch",
        actor: user.id,
        from_status: campaign.status,
        to_status: "ACTIVE",
        external_ids: { external_campaign_id: campaign.external_campaign_id },
        provider_response: { effective_status: effective, certification: true },
      });
      return response;
    } catch (error) {
      await adapter.setStatus(
        connection,
        "campaign",
        campaign.external_campaign_id,
        "PAUSED",
      ).catch(() => undefined);
      return json({
        error: "certification_launch_failed",
        detail: error instanceof Error ? error.message : String(error),
      }, 502);
    }
  }

  if (canary.status !== "running") {
    return json({ error: "certification_stop_state_invalid" }, 409);
  }
  try {
    await adapter.setStatus(
      connection,
      "campaign",
      campaign.external_campaign_id,
      "PAUSED",
    );
    const status = await readConfirmedStatus(
      adapter,
      connection,
      campaign.external_campaign_id,
      confirmsPaused,
    );
    const effective = status.effectiveStatus ?? status.status ?? "PAUSED";
    const { error: stopRequestError } = await db.rpc(
      "ad_request_campaign_stop",
      {
        p_campaign_id: campaign.id,
        p_requested_at: new Date().toISOString(),
      },
    );
    if (stopRequestError) {
      return json({
        error: "certification_stop_recovery_required",
        detail: stopRequestError.message,
      }, 503);
    }
    const { data: spendRows, error: spendError } = await db
      .from("ad_spend_daily").select("spend_cents")
      .eq("campaign_id", campaign.id);
    if (spendError) {
      return json({ error: "certification_stop_spend_unavailable" }, 503);
    }
    const actualSpend = (spendRows ?? []).reduce(
      (sum: number, row: Record<string, unknown>) =>
        sum + Math.max(0, Number(row.spend_cents) || 0),
      0,
    );
    const response = await transition({
      transition_action: "provider_stopped",
      provider_effective_status: effective,
      actual_spend_cents: actualSpend,
    });
    if (response.status >= 400) return response;
    await db.from("ad_campaigns").update({
      status: "PAUSED",
      delivery_status: effective,
      status_synced_at: new Date().toISOString(),
    }).eq("id", campaign.id);
    await db.from("ad_plans").update({ state: "paused" })
      .eq("current_version_id", canary.plan_version_id);
    await db.from("ad_status_events").insert({
      campaign_id: campaign.id,
      platform: provider,
      entity: "campaign",
      action: "pause",
      actor: user.id,
      from_status: campaign.status,
      to_status: "PAUSED",
      external_ids: { external_campaign_id: campaign.external_campaign_id },
      provider_response: {
        effective_status: effective,
        actual_spend_cents: actualSpend,
        certification: true,
      },
    });
    return response;
  } catch (error) {
    return json({
      error: "certification_stop_not_confirmed",
      detail: error instanceof Error ? error.message : String(error),
    }, 502);
  }
});
