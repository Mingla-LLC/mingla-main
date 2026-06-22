// ORCH-1201 — Admin API-Health probe (hourly via pg_cron + pg_net).
//
// One HTTP handler per hourly tick. Service-role-Bearer guarded (D0.5). Runs:
//   Layer-A: allSettled poll of vendor statuspage /api/v2/status.json feeds.
//   Layer-B: allSettled authed synthetic probes (cheapest liveness per vendor).
//   Layer-C: reads notification_deliveries (email/sms/push) + webhook freshness
//            tables + api_health_observations (real-traffic from recordApiCall).
// Inserts api_health_checks rows, runs the alert state machine, and — on the
// 13:00-UTC tick — sends the daily digest.
//
// Hard contract: one dead/slow vendor NEVER throws the tick (allSettled +
// per-probe AbortSignal). Alerts go ONLY through sendOpsAlertEmail (D0.6 /
// I-PROPOSED-1201-ALERT-EMAIL-SINGLE-OWNER). Probes are read-only against
// vendors (I-PROPOSED-1201-PROBE-NO-WRITE-SIDE-EFFECTS); the only non-GET vendor
// calls are the Serper search (read-only) + the Stripe/Paystack SDK reads.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createStripeClientForRole } from "../_shared/stripe.ts";
import { resolveStripeMode } from "../_shared/stripeMode.ts";
import {
  PAYSTACK_BASE_URL,
  resolvePaystackMode,
  resolvePaystackSecretKey,
} from "../_shared/paystack.ts";
import { sendOpsAlertEmail } from "../_shared/stripeOpsAlertEmail.ts";
import { logError, structuredLog } from "../_shared/structuredLog.ts";
import {
  buildCheckRows,
  computeEffectiveStatus,
  decideAvailabilityTransitions,
  decideBalanceTransition,
  type HealthStatus,
  indicatorToStatus,
  type ProbeResult,
  STATUS_PAGE_URLS,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 5000;

// ── low-balance thresholds (env-overridable, §3.5) ──
function num(envVar: string, def: number): number {
  const raw = Deno.env.get(envVar);
  const v = raw == null ? NaN : Number(raw);
  return Number.isFinite(v) ? v : def;
}

function alertRecipients(): string[] {
  const raw = Deno.env.get("API_HEALTH_ALERT_EMAILS") ?? "seth@usemingla.com";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function adminUrl(): string {
  return Deno.env.get("API_HEALTH_ADMIN_URL") ?? "https://admin.usemingla.com";
}

// A row to be inserted into api_health_checks.
interface CheckRow {
  service_key: string;
  layer: "status_page" | "synthetic" | "passive" | "webhook";
  status: HealthStatus;
  latency_ms: number | null;
  mode: "test" | "live" | null;
  http_status: number | null;
  detail: Record<string, unknown>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── timed fetch with per-probe abort ──
async function timedFetch(
  url: string,
  init: RequestInit = {},
): Promise<{ res: Response; latencyMs: number }> {
  const t0 = Date.now();
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  return { res, latencyMs: Date.now() - t0 };
}

function httpToStatus(httpStatus: number): HealthStatus {
  if (httpStatus >= 200 && httpStatus < 300) return "healthy";
  if (httpStatus === 429 || httpStatus >= 500) return "degraded";
  return "down"; // 4xx-auth / other
}

// ════════════════════════════════════════════════════════════════════════
// LAYER A — statuspage poll
// ════════════════════════════════════════════════════════════════════════
async function probeStatusPage(serviceKey: string, url: string): Promise<CheckRow> {
  try {
    const { res, latencyMs } = await timedFetch(url, { method: "GET" });
    if (!res.ok) {
      return {
        service_key: serviceKey, layer: "status_page", status: "unknown",
        latency_ms: latencyMs, mode: null, http_status: res.status,
        detail: { error: `status feed http ${res.status}` },
      };
    }
    const json = await res.json().catch(() => null) as
      | { status?: { indicator?: string; description?: string } }
      | null;
    const indicator = json?.status?.indicator ?? null;
    return {
      service_key: serviceKey, layer: "status_page",
      status: indicatorToStatus(indicator),
      latency_ms: latencyMs, mode: null, http_status: res.status,
      detail: { indicator, description: json?.status?.description ?? null },
    };
  } catch (err) {
    return {
      service_key: serviceKey, layer: "status_page", status: "unknown",
      latency_ms: null, mode: null, http_status: null,
      detail: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

// ════════════════════════════════════════════════════════════════════════
// LAYER B — authed synthetic probes
// ════════════════════════════════════════════════════════════════════════
function synthRow(
  serviceKey: string,
  p: ProbeResult,
  mode: "test" | "live" | null = null,
): CheckRow {
  return {
    service_key: serviceKey, layer: "synthetic", status: p.status,
    latency_ms: p.latencyMs, mode, http_status: p.httpStatus ?? null,
    detail: p.detail,
  };
}

async function probeGemini(): Promise<ProbeResult> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return { ok: false, latencyMs: null, status: "unknown", detail: { error: "GEMINI_API_KEY missing" } };
  try {
    const { res, latencyMs } = await timedFetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    );
    const body = await res.json().catch(() => null) as { models?: unknown[] } | null;
    const ok = res.ok && Array.isArray(body?.models);
    return { ok, latencyMs, httpStatus: res.status, status: ok ? "healthy" : httpToStatus(res.status), detail: {} };
  } catch (e) {
    return { ok: false, latencyMs: null, status: "down", detail: { error: String(e) } };
  }
}

async function probeOpenAI(): Promise<ProbeResult> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return { ok: false, latencyMs: null, status: "unknown", detail: { error: "OPENAI_API_KEY missing" } };
  try {
    const { res, latencyMs } = await timedFetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    return { ok: res.ok, latencyMs, httpStatus: res.status, status: httpToStatus(res.status), detail: {} };
  } catch (e) {
    return { ok: false, latencyMs: null, status: "down", detail: { error: String(e) } };
  }
}

async function probeStripe(): Promise<ProbeResult> {
  let mode: "test" | "live" | null = null;
  try {
    mode = resolveStripeMode();
  } catch { /* mode unset — leave null */ }
  const t0 = Date.now();
  try {
    const client = createStripeClientForRole("BALANCES");
    const bal = await client.balance.retrieve();
    const first = bal?.available?.[0];
    return {
      ok: true, latencyMs: Date.now() - t0, status: "healthy",
      detail: {
        mode,
        balance: first ? first.amount : null,
        currency: first ? first.currency : null,
      },
    };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, status: "down", detail: { mode, error: e instanceof Error ? e.message : String(e) } };
  }
}

async function probePaystack(): Promise<ProbeResult> {
  let mode: "test" | "live" | null = null;
  try {
    mode = resolvePaystackMode();
  } catch { /* leave null */ }
  let secret: string;
  try {
    secret = resolvePaystackSecretKey();
  } catch (e) {
    return { ok: false, latencyMs: null, status: "unknown", detail: { mode, error: e instanceof Error ? e.message : String(e) } };
  }
  try {
    const { res, latencyMs } = await timedFetch(`${PAYSTACK_BASE_URL}/balance`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const json = await res.json().catch(() => null) as
      | { status?: boolean; data?: Array<{ balance?: number; currency?: string }> }
      | null;
    const ok = res.ok && json?.status === true;
    const first = json?.data?.[0];
    return {
      ok, latencyMs, httpStatus: res.status,
      status: ok ? "healthy" : httpToStatus(res.status),
      detail: { mode, balance: first?.balance ?? null, currency: first?.currency ?? null },
    };
  } catch (e) {
    return { ok: false, latencyMs: null, status: "down", detail: { mode, error: String(e) } };
  }
}

async function probeMapbox(): Promise<ProbeResult> {
  const token = Deno.env.get("MAPBOX_ACCESS_TOKEN");
  if (!token) return { ok: false, latencyMs: null, status: "unknown", detail: { error: "MAPBOX_ACCESS_TOKEN missing" } };
  try {
    const { res, latencyMs } = await timedFetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/test.json?limit=1&access_token=${token}`,
    );
    const body = await res.json().catch(() => null) as { features?: unknown[] } | null;
    const ok = res.ok && Array.isArray(body?.features);
    return { ok, latencyMs, httpStatus: res.status, status: ok ? "healthy" : httpToStatus(res.status), detail: {} };
  } catch (e) {
    return { ok: false, latencyMs: null, status: "down", detail: { error: String(e) } };
  }
}

async function probeGooglePlaces(): Promise<ProbeResult> {
  const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!key) return { ok: false, latencyMs: null, status: "unknown", detail: { error: "GOOGLE_MAPS_API_KEY missing" } };
  try {
    const { res, latencyMs } = await timedFetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=coffee&key=${key}`,
    );
    const body = await res.json().catch(() => null) as { status?: string } | null;
    const ok = res.ok && (body?.status === "OK" || body?.status === "ZERO_RESULTS");
    return { ok, latencyMs, httpStatus: res.status, status: ok ? "healthy" : httpToStatus(res.status), detail: { google_status: body?.status ?? null } };
  } catch (e) {
    return { ok: false, latencyMs: null, status: "down", detail: { error: String(e) } };
  }
}

async function probeTicketmaster(): Promise<ProbeResult> {
  const key = Deno.env.get("TICKETMASTER_API_KEY");
  if (!key) return { ok: false, latencyMs: null, status: "unknown", detail: { error: "TICKETMASTER_API_KEY missing" } };
  try {
    const { res, latencyMs } = await timedFetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?size=1&apikey=${key}`,
    );
    return {
      ok: res.ok, latencyMs, httpStatus: res.status, status: httpToStatus(res.status),
      detail: { rate_limit: res.headers.get("Rate-Limit-Available") ?? res.headers.get("rate-limit") ?? null },
    };
  } catch (e) {
    return { ok: false, latencyMs: null, status: "down", detail: { error: String(e) } };
  }
}

async function probeSerper(): Promise<ProbeResult> {
  const key = Deno.env.get("SERPER_API_KEY");
  if (!key) return { ok: false, latencyMs: null, status: "unknown", detail: { error: "SERPER_API_KEY missing" } };
  try {
    // Read-only search (no vendor mutation) — I-PROPOSED-1201-PROBE-NO-WRITE-SIDE-EFFECTS exception.
    const { res, latencyMs } = await timedFetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: "mingla healthcheck", num: 1 }),
    });
    return { ok: res.ok, latencyMs, httpStatus: res.status, status: httpToStatus(res.status), detail: {} };
  } catch (e) {
    return { ok: false, latencyMs: null, status: "down", detail: { error: String(e) } };
  }
}

async function probePexels(): Promise<ProbeResult> {
  const key = Deno.env.get("PEXELS_API_KEY");
  if (!key) return { ok: false, latencyMs: null, status: "unknown", detail: { error: "PEXELS_API_KEY missing" } };
  try {
    const { res, latencyMs } = await timedFetch(
      "https://api.pexels.com/v1/search?query=city&per_page=1",
      { headers: { Authorization: key } },
    );
    return {
      ok: res.ok, latencyMs, httpStatus: res.status, status: httpToStatus(res.status),
      detail: {
        rate_remaining: res.headers.get("X-Ratelimit-Remaining"),
        rate_reset: res.headers.get("X-Ratelimit-Reset"),
      },
    };
  } catch (e) {
    return { ok: false, latencyMs: null, status: "down", detail: { error: String(e) } };
  }
}

async function probeOneSignal(appIdVar: string, restKeyVar: string): Promise<ProbeResult> {
  const appId = Deno.env.get(appIdVar);
  const restKey = Deno.env.get(restKeyVar);
  if (!appId || !restKey) {
    return { ok: false, latencyMs: null, status: "unknown", detail: { error: `${appIdVar}/${restKeyVar} missing` } };
  }
  try {
    // Auth scheme confirmed = `Key ${restKey}` (push-utils.ts:156).
    const { res, latencyMs } = await timedFetch(`https://api.onesignal.com/apps/${appId}`, {
      headers: { Authorization: `Key ${restKey}` },
    });
    return { ok: res.ok, latencyMs, httpStatus: res.status, status: httpToStatus(res.status), detail: {} };
  } catch (e) {
    return { ok: false, latencyMs: null, status: "down", detail: { error: String(e) } };
  }
}

async function probeResend(): Promise<ProbeResult> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, latencyMs: null, status: "unknown", detail: { error: "RESEND_API_KEY missing" } };
  try {
    const { res, latencyMs } = await timedFetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
    });
    return { ok: res.ok, latencyMs, httpStatus: res.status, status: httpToStatus(res.status), detail: {} };
  } catch (e) {
    return { ok: false, latencyMs: null, status: "down", detail: { error: String(e) } };
  }
}

async function probeTwilio(): Promise<ProbeResult> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!sid || !token) return { ok: false, latencyMs: null, status: "unknown", detail: { error: "TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN missing" } };
  const basic = btoa(`${sid}:${token}`);
  try {
    const { res, latencyMs } = await timedFetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
      { headers: { Authorization: `Basic ${basic}` } },
    );
    if (!res.ok) {
      return { ok: false, latencyMs, httpStatus: res.status, status: httpToStatus(res.status), detail: {} };
    }
    // balance is a separate call; best-effort, never fails the probe.
    let balance: number | null = null;
    let currency: string | null = null;
    try {
      const balRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`,
        { headers: { Authorization: `Basic ${basic}` }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
      );
      if (balRes.ok) {
        const b = await balRes.json().catch(() => null) as { balance?: string; currency?: string } | null;
        if (b?.balance != null) balance = Number(b.balance);
        currency = b?.currency ?? null;
      }
    } catch { /* balance optional */ }
    return { ok: true, latencyMs, httpStatus: res.status, status: "healthy", detail: { balance, currency } };
  } catch (e) {
    return { ok: false, latencyMs: null, status: "down", detail: { error: String(e) } };
  }
}

async function probeCloudinary(): Promise<ProbeResult> {
  const cloud = Deno.env.get("CLOUDINARY_CLOUD_NAME");
  const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
  const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");
  if (!cloud || !apiKey || !apiSecret) {
    return { ok: false, latencyMs: null, status: "unknown", detail: { error: "CLOUDINARY_* missing" } };
  }
  const basic = btoa(`${apiKey}:${apiSecret}`);
  try {
    const { res, latencyMs } = await timedFetch(
      `https://api.cloudinary.com/v1_1/${cloud}/usage`,
      { headers: { Authorization: `Basic ${basic}` } },
    );
    if (!res.ok) return { ok: false, latencyMs, httpStatus: res.status, status: httpToStatus(res.status), detail: {} };
    const b = await res.json().catch(() => null) as { credits?: { usage?: number; limit?: number } } | null;
    return {
      ok: true, latencyMs, httpStatus: res.status, status: "healthy",
      detail: { credits_used: b?.credits?.usage ?? null, credits_limit: b?.credits?.limit ?? null },
    };
  } catch (e) {
    return { ok: false, latencyMs: null, status: "down", detail: { error: String(e) } };
  }
}

// ════════════════════════════════════════════════════════════════════════
// ALERT STATE MACHINE
// ════════════════════════════════════════════════════════════════════════
interface AlertStateRow {
  service_key: string;
  current_state: "ok" | "alerting";
  consecutive_failures: number;
  last_alert_at: string | null;
  last_recovery_at: string | null;
  last_balance_alert_at: string | null;
  last_balance_state: "ok" | "low" | "unknown";
}

interface ServiceTickContext {
  serviceKey: string;
  displayName: string;
  effectiveStatus: HealthStatus;
  failedTick: boolean;
  failingLayer: string | null;
  failingDetail: Record<string, unknown> | null;
  mode: string | null;
  // balance evaluation
  balanceLow: boolean | null; // null = no balance signal
  balanceText: string | null;
}

// deno-lint-ignore no-explicit-any
async function runAlertStateMachine(
  contexts: ServiceTickContext[],
  // deno-lint-ignore no-explicit-any
  serviceClient: any,
  nowMs: number,
): Promise<number> {
  let alertsSent = 0;
  const recipients = alertRecipients();
  const sentKeys = new Set<string>();
  const hourBucket = new Date(nowMs).toISOString().slice(0, 13); // YYYY-MM-DDTHH

  // Load all state rows once.
  const { data: stateRows } = await serviceClient
    .from("api_health_alert_state")
    .select("*");
  const stateByKey = new Map<string, AlertStateRow>();
  for (const r of (stateRows ?? []) as AlertStateRow[]) stateByKey.set(r.service_key, r);

  for (const ctx of contexts) {
    const prev = stateByKey.get(ctx.serviceKey);
    if (!prev) continue; // no seeded state row → skip (should not happen)

    // ── availability transitions (pure decision) ──
    const decision = decideAvailabilityTransitions({
      currentState: prev.current_state,
      consecutiveFailures: prev.consecutive_failures,
      lastAlertAt: prev.last_alert_at,
      failedTick: ctx.failedTick,
      nowMs,
      cooldownMs: SIX_HOURS_MS,
    });

    // ── balance transition (pure decision) ──
    const balDecision = decideBalanceTransition({
      balanceLow: ctx.balanceLow,
      lastBalanceState: prev.last_balance_state,
      lastBalanceAlertAt: prev.last_balance_alert_at,
      nowMs,
      cooldownMs: 24 * 60 * 60 * 1000,
    });

    // ── persist new state ──
    const patch: Partial<AlertStateRow> & { updated_at: string } = {
      current_state: decision.nextState,
      consecutive_failures: decision.nextConsecutiveFailures,
      last_balance_state: balDecision.nextBalanceState,
      updated_at: new Date(nowMs).toISOString(),
    };
    if (decision.setLastAlertAt) patch.last_alert_at = new Date(nowMs).toISOString();
    if (decision.setLastRecoveryAt) patch.last_recovery_at = new Date(nowMs).toISOString();
    if (balDecision.setLastBalanceAlertAt) patch.last_balance_alert_at = new Date(nowMs).toISOString();

    await serviceClient
      .from("api_health_alert_state")
      .update(patch)
      .eq("service_key", ctx.serviceKey);

    // ── send emails (idempotency: one per service per state per hour bucket) ──
    const trySend = async (kind: string, subject: string, paragraphs: string[]) => {
      const idemKey = `api-health:${ctx.serviceKey}:${kind}:${hourBucket}`;
      if (sentKeys.has(idemKey)) return;
      sentKeys.add(idemKey);
      await sendOpsAlertEmail({
        subject,
        paragraphs,
        recipients,
        cta: { label: "Open API Health hub", url: `${adminUrl()}/#/api-health` },
      });
      alertsSent += 1;
    };

    if (decision.sendDownAlert) {
      await trySend(
        "alerting",
        `⚠️ [API HEALTH] ${ctx.displayName} is DOWN`,
        [
          `${ctx.displayName} failed ${decision.nextConsecutiveFailures} consecutive health checks.`,
          `Layer: ${ctx.failingLayer ?? "n/a"}. Last error: ${
            (ctx.failingDetail?.error as string) || (ctx.failingDetail?.description as string) || "see admin hub"
          }.`,
          `Active mode: ${ctx.mode ?? "n/a"}.`,
          `Checked at ${new Date(nowMs).toISOString()} UTC.`,
        ],
      );
    }
    if (decision.sendRecoveryAlert) {
      const downSpan = prev.last_alert_at
        ? `${Math.round((nowMs - new Date(prev.last_alert_at).getTime()) / 60000)} min`
        : "unknown duration";
      await trySend(
        "recovered",
        `✅ [API HEALTH] ${ctx.displayName} recovered`,
        [`${ctx.displayName} is healthy again after ${downSpan} of alerting.`],
      );
    }
    if (balDecision.sendLowBalanceAlert) {
      await trySend(
        "balance_low",
        `💳 [API HEALTH] ${ctx.displayName} balance low`,
        [`${ctx.displayName} balance is low: ${ctx.balanceText ?? "below threshold"}.`],
      );
    }
  }

  return alertsSent;
}

// ════════════════════════════════════════════════════════════════════════
// DAILY DIGEST (hour == 13 UTC)
// ════════════════════════════════════════════════════════════════════════
// deno-lint-ignore no-explicit-any
async function maybeSendDigest(serviceClient: any, contexts: ServiceTickContext[], nowMs: number): Promise<boolean> {
  // Gate on api_health_meta.last_digest_at (skip if sent within 20h).
  const { data: metaRow } = await serviceClient
    .from("api_health_meta")
    .select("value")
    .eq("key", "last_digest_at")
    .maybeSingle();
  const lastRaw = metaRow?.value;
  const lastMs = typeof lastRaw === "string" ? new Date(lastRaw).getTime() : (lastRaw == null ? NaN : NaN);
  if (Number.isFinite(lastMs) && nowMs - lastMs < 20 * 60 * 60 * 1000) {
    return false; // already sent within 20h
  }

  const lines: string[] = [];
  const incidents: string[] = [];
  for (const ctx of contexts) {
    const balanceLine = ctx.balanceText ? ` · ${ctx.balanceText}` : "";
    lines.push(`${ctx.displayName}: ${ctx.effectiveStatus}${balanceLine}`);
    if (ctx.effectiveStatus === "down" || ctx.effectiveStatus === "degraded") {
      incidents.push(`${ctx.displayName} (${ctx.effectiveStatus})`);
    }
  }
  const date = new Date(nowMs).toISOString().slice(0, 10);
  const paragraphs = [
    "Daily API health summary:",
    ...lines,
  ];
  if (incidents.length > 0) {
    paragraphs.push(`Recent incidents (24h): ${incidents.join(", ")}.`);
  } else {
    paragraphs.push("No incidents in the last 24h.");
  }

  await sendOpsAlertEmail({
    subject: `📊 [API HEALTH] Daily digest — ${date}`,
    paragraphs,
    recipients: alertRecipients(),
    cta: { label: "Open API Health hub", url: `${adminUrl()}/#/api-health` },
  });

  await serviceClient
    .from("api_health_meta")
    .update({ value: JSON.stringify(new Date(nowMs).toISOString()), updated_at: new Date(nowMs).toISOString() })
    .eq("key", "last_digest_at");
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const nowMs = Date.now();
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(SUPABASE_URL, SERVICE_KEY);

    const checkRows: CheckRow[] = [];

    // ── LAYER A ──
    const statusEntries = Object.entries(STATUS_PAGE_URLS);
    const aResults = await Promise.allSettled(
      statusEntries.map(([k, u]) => probeStatusPage(k, u)),
    );
    for (const r of aResults) {
      if (r.status === "fulfilled") checkRows.push(r.value);
    }

    // ── LAYER B ──
    const bProbes: Array<[string, () => Promise<ProbeResult>, "test" | "live" | null]> = [
      ["gemini", probeGemini, null],
      ["openai", probeOpenAI, null],
      ["stripe", probeStripe, null],
      ["paystack", probePaystack, null],
      ["mapbox", probeMapbox, null],
      ["google_places", probeGooglePlaces, null],
      ["ticketmaster", probeTicketmaster, null],
      ["serper", probeSerper, null],
      ["pexels", probePexels, null],
      ["onesignal_consumer", () => probeOneSignal("ONESIGNAL_APP_ID", "ONESIGNAL_REST_API_KEY"), null],
      ["onesignal_business", () => probeOneSignal("ONESIGNAL_BUSINESS_APP_ID", "ONESIGNAL_BUSINESS_REST_API_KEY"), null],
      ["resend", probeResend, null],
      ["twilio", probeTwilio, null],
      ["cloudinary", probeCloudinary, null],
    ];
    const bResults = await Promise.allSettled(
      bProbes.map(async ([key, fn]) => {
        const p = await fn();
        const mode = (p.detail?.mode as "test" | "live" | undefined) ?? null;
        return synthRow(key, p, mode);
      }),
    );
    for (const r of bResults) {
      if (r.status === "fulfilled") checkRows.push(r.value);
    }
    // supabase self-probe (cheap select 1 equivalent)
    {
      const t0 = Date.now();
      try {
        const { error } = await serviceClient.from("api_health_services").select("service_key").limit(1);
        checkRows.push({
          service_key: "supabase", layer: "synthetic",
          status: error ? "down" : "healthy", latency_ms: Date.now() - t0,
          mode: null, http_status: null, detail: error ? { error: error.message } : {},
        });
      } catch (e) {
        checkRows.push({
          service_key: "supabase", layer: "synthetic", status: "down",
          latency_ms: Date.now() - t0, mode: null, http_status: null, detail: { error: String(e) },
        });
      }
    }

    // ── LAYER C: notification_deliveries (email/sms/push) ──
    try {
      const { data: deliv } = await serviceClient
        .from("notification_deliveries")
        .select("provider,status")
        .gt("attempt_at", new Date(nowMs - 24 * 60 * 60 * 1000).toISOString());
      // provider → tile mapping
      const tally = new Map<string, { total: number; failure: number }>();
      const FAIL_STATUSES = new Set(["failed", "undelivered"]);
      for (const row of (deliv ?? []) as Array<{ provider: string | null; status: string }>) {
        const provider = row.provider;
        if (!provider) continue;
        const tiles = provider === "onesignal"
          ? ["onesignal_consumer"] // no per-app split in deliveries → attribute to consumer (limitation)
          : provider === "resend"
            ? ["resend"]
            : provider === "twilio"
              ? ["twilio"]
              : [];
        for (const tile of tiles) {
          const t = tally.get(tile) ?? { total: 0, failure: 0 };
          t.total += 1;
          if (FAIL_STATUSES.has(row.status)) t.failure += 1;
          tally.set(tile, t);
        }
      }
      for (const [tile, t] of tally) {
        const failRate = t.total > 0 ? t.failure / t.total : 0;
        let status: HealthStatus;
        if (t.total < 5) status = "unknown";
        else if (failRate > 0.5) status = "down";
        else if (failRate >= 0.25) status = "degraded";
        else status = "healthy";
        const detail: Record<string, unknown> = { success: t.total - t.failure, failure: t.failure, total: t.total };
        if (tile === "onesignal_consumer") detail.note = "deliveries has no per-app split; attributed to consumer";
        checkRows.push({
          service_key: tile, layer: "passive", status,
          latency_ms: null, mode: null, http_status: null, detail,
        });
      }
    } catch (e) {
      structuredLog("warn", "api_health layer-c deliveries read failed", { fn: "api-health-probe", err: String(e) });
    }

    // ── LAYER C: api_health_observations (real-traffic from recordApiCall) ──
    try {
      const { data: obs } = await serviceClient
        .from("api_health_observations")
        .select("service_key,ok")
        .gt("observed_at", new Date(nowMs - 24 * 60 * 60 * 1000).toISOString());
      const tally = new Map<string, { total: number; failure: number }>();
      for (const row of (obs ?? []) as Array<{ service_key: string; ok: boolean }>) {
        const t = tally.get(row.service_key) ?? { total: 0, failure: 0 };
        t.total += 1;
        if (!row.ok) t.failure += 1;
        tally.set(row.service_key, t);
      }
      for (const [key, t] of tally) {
        const failRate = t.total > 0 ? t.failure / t.total : 0;
        let status: HealthStatus;
        if (t.total < 5) status = "unknown";
        else if (failRate > 0.5) status = "down";
        else if (failRate >= 0.25) status = "degraded";
        else status = "healthy";
        checkRows.push({
          service_key: key, layer: "passive", status,
          latency_ms: null, mode: null, http_status: null,
          detail: { success: t.total - t.failure, failure: t.failure, total: t.total, source: "recordApiCall" },
        });
      }
    } catch (e) {
      structuredLog("warn", "api_health layer-c observations read failed", { fn: "api-health-probe", err: String(e) });
    }

    // ── LAYER C: webhook freshness ──
    const webhookFreshness = async (
      serviceKey: string,
      table: string,
      tsCol: string,
      alertOnSilence: boolean,
    ) => {
      try {
        const { data } = await serviceClient
          .from(table)
          .select(tsCol)
          .order(tsCol, { ascending: false })
          .limit(1)
          .maybeSingle();
        const row = (data ?? null) as Record<string, string> | null;
        const latest = row?.[tsCol] ? new Date(row[tsCol]).getTime() : null;
        let status: HealthStatus;
        if (latest == null) status = "unknown";
        else if (alertOnSilence && nowMs - latest > SIX_HOURS_MS) status = "degraded";
        else status = "healthy";
        checkRows.push({
          service_key: serviceKey, layer: "webhook", status,
          latency_ms: null, mode: null, http_status: null,
          detail: { last_received: latest ? new Date(latest).toISOString() : null, alert_on_silence: alertOnSilence },
        });
      } catch (e) {
        structuredLog("warn", "api_health webhook freshness failed", { fn: "api-health-probe", table, err: String(e) });
      }
    };
    // stripe + paystack share payment_webhook_events; silence > 6h is degraded (alertable).
    await webhookFreshness("stripe", "payment_webhook_events", "created_at", true);
    await webhookFreshness("paystack", "payment_webhook_events", "created_at", true);
    // cloudinary + twilio webhooks are informational (low volume) — never alert.
    await webhookFreshness("cloudinary", "event_cover_video_jobs", "created_at", false);
    await webhookFreshness("twilio", "twilio_message_status_events", "received_at", false);

    // ── BULK INSERT ──
    if (checkRows.length > 0) {
      const { error: insErr } = await serviceClient.from("api_health_checks").insert(checkRows);
      if (insErr) {
        logError("api_health_checks insert failed", insErr, { fn: "api-health-probe" });
      }
    }

    // ── Build per-service tick contexts for the state machine ──
    const { data: services } = await serviceClient
      .from("api_health_services")
      .select("service_key,display_name");
    const displayByKey = new Map<string, string>();
    for (const s of (services ?? []) as Array<{ service_key: string; display_name: string }>) {
      displayByKey.set(s.service_key, s.display_name);
    }

    // group checkRows by service
    const byService = new Map<string, CheckRow[]>();
    for (const row of checkRows) {
      const arr = byService.get(row.service_key) ?? [];
      arr.push(row);
      byService.set(row.service_key, arr);
    }

    const contexts: ServiceTickContext[] = [];
    for (const [serviceKey, displayName] of displayByKey) {
      const rows = byService.get(serviceKey) ?? [];
      const { effectiveStatus, failedTick, failingLayer, failingDetail, mode } =
        computeEffectiveStatus(rows);
      // balance evaluation (from synthetic detail)
      const { balanceLow, balanceText } = evaluateBalance(serviceKey, rows);
      contexts.push({
        serviceKey, displayName, effectiveStatus, failedTick,
        failingLayer, failingDetail, mode, balanceLow, balanceText,
      });
    }

    const alertsSent = await runAlertStateMachine(contexts, serviceClient, nowMs);

    let digestSent = false;
    if (new Date(nowMs).getUTCHours() === 13) {
      digestSent = await maybeSendDigest(serviceClient, contexts, nowMs);
    }

    structuredLog("info", "api_health_probe tick", {
      fn: "api-health-probe",
      ticks: checkRows.length,
      alertsSent,
      digestSent,
    });

    return jsonResponse({
      ok: true,
      ticks: checkRows.length,
      alerts_sent: alertsSent,
      digest_sent: digestSent,
      timestamp: new Date(nowMs).toISOString(),
    });
  } catch (err) {
    logError("api_health_probe failed", err, { fn: "api-health-probe" });
    // Return 200 so pg_cron does not retry-storm.
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── balance threshold evaluation (uses synthetic-layer detail) ──
function evaluateBalance(
  serviceKey: string,
  rows: CheckRow[],
): { balanceLow: boolean | null; balanceText: string | null } {
  const synth = rows.find((r) => r.layer === "synthetic");
  if (!synth) return { balanceLow: null, balanceText: null };
  const d = synth.detail;

  if (serviceKey === "twilio") {
    const bal = typeof d.balance === "number" ? d.balance : null;
    if (bal == null) return { balanceLow: null, balanceText: null };
    const threshold = num("API_HEALTH_TWILIO_MIN_BALANCE", 20);
    return { balanceLow: bal < threshold, balanceText: `${bal} ${d.currency ?? "USD"} (min ${threshold})` };
  }
  if (serviceKey === "paystack") {
    const bal = typeof d.balance === "number" ? d.balance : null;
    if (bal == null) return { balanceLow: null, balanceText: null };
    const threshold = num("API_HEALTH_PAYSTACK_MIN_BALANCE", 100000);
    return { balanceLow: bal < threshold, balanceText: `${bal} ${d.currency ?? "NGN"} subunits (min ${threshold})` };
  }
  if (serviceKey === "cloudinary") {
    const used = typeof d.credits_used === "number" ? d.credits_used : null;
    const limit = typeof d.credits_limit === "number" ? d.credits_limit : null;
    if (used == null || limit == null || limit <= 0) return { balanceLow: null, balanceText: null };
    const remainingPct = ((limit - used) / limit) * 100;
    const threshold = num("API_HEALTH_CLOUDINARY_MIN_CREDIT_PCT", 10);
    return { balanceLow: remainingPct < threshold, balanceText: `${remainingPct.toFixed(1)}% credit remaining (min ${threshold}%)` };
  }
  if (serviceKey === "pexels") {
    const rem = d.rate_remaining != null ? Number(d.rate_remaining) : null;
    if (rem == null || !Number.isFinite(rem)) return { balanceLow: null, balanceText: null };
    const threshold = num("API_HEALTH_PEXELS_MIN_RATE", 100);
    return { balanceLow: rem < threshold, balanceText: `${rem} requests remaining (min ${threshold})` };
  }
  return { balanceLow: null, balanceText: null };
}

// re-export buildCheckRows so it's not tree-shaken out of the test surface
export { buildCheckRows };
