// toward #3697: scheduled retry for server conversions and checkout-start
// signals. It re-evaluates the latest touch consent and browser opt-out latch on
// every attempt. Every failure is retried for 24 hours; #4238 W1-2: a missing
// or rejected key (config/auth class) is retried for 72 hours, and every run
// ends with the tracking-health pass (key presence, failures, daily probe,
// alert email).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  AD_CONVERSION_RETRY_BATCH,
  AD_CONVERSION_RETRY_WINDOW_MS,
  type AdConversionRetryRow,
  RETRY_EVENT_TYPES,
  configRetryWindowCutoff,
  conversionRetryInput,
  retryableChannels,
  retryGraceCutoff,
  retryWindowCutoff,
} from "../_shared/adConversionRetry.ts";
import { runAdTrackingHealth } from "../_shared/adTrackingHealth.ts";
import {
  fireAdCheckoutStart,
  fireAdConversion,
} from "../_shared/adConversionFire.ts";
// #4238 W4-1: this run posts native (Explorer app) af_purchase events that a
// caller without the AppsFlyer secrets left pending.
import { postAppsFlyerS2SEvent } from "../_shared/appsFlyerS2S.ts";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (
    !serviceKey || req.headers.get("authorization") !== `Bearer ${serviceKey}`
  ) {
    return json({ error: "forbidden" }, 403);
  }
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) return json({ error: "server_misconfigured" }, 500);
  const db = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const nowMs = Date.now();
  const windowStart = retryWindowCutoff(nowMs);
  const configWindowStart = configRetryWindowCutoff(nowMs);
  const graceCutoff = retryGraceCutoff(nowMs);

  const { data: conversions, error: conversionQueryError } = await db
    .from("ad_conversions")
    .select(
      "event_id,order_id,stay_group_id,event_type,surface,lane,created_at,updated_at,provider_response,meta_capi_status,tiktok_events_status,snap_capi_status,reddit_capi_status,google_ads_status",
    )
    .gte("created_at", configWindowStart)
    .lte("updated_at", graceCutoff)
    // #4238 W3-3: host leads, sign-ups, first publishes and first sales too.
    .in("event_type", [...RETRY_EVENT_TYPES])
    .or(
      "meta_capi_status.in.(pending,failed),tiktok_events_status.in.(pending,failed),snap_capi_status.in.(pending,failed),reddit_capi_status.in.(pending,failed),google_ads_status.in.(pending,failed)",
    )
    .order("updated_at", { ascending: true })
    .limit(AD_CONVERSION_RETRY_BATCH);
  if (conversionQueryError) {
    return json({ error: "conversion_query_failed" }, 500);
  }

  const conversionResults: Array<Record<string, unknown>> = [];
  for (const raw of conversions ?? []) {
    const row = raw as AdConversionRetryRow;
    const failedPatch = retryableChannels(row, nowMs);
    const createdMs = row.created_at ? Date.parse(row.created_at) : NaN;
    const pastDefaultWindow = Number.isFinite(createdMs) &&
      nowMs - createdMs > AD_CONVERSION_RETRY_WINDOW_MS;
    // A row past 24 h is only re-fired for a config/auth channel; anything
    // else on it (including a consent-pending lane) is left alone.
    if (pastDefaultWindow && Object.keys(failedPatch).length === 0) continue;
    if (Object.keys(failedPatch).length > 0) {
      const { data: claimed, error: claimError } = await db
        .from("ad_conversions")
        .update(failedPatch)
        .eq("event_id", row.event_id)
        .eq("updated_at", row.updated_at)
        .select("event_id")
        .maybeSingle();
      if (claimError || !claimed) {
        conversionResults.push({
          event_id: row.event_id,
          status: "claim_skipped",
        });
        continue;
      }
    }
    const result = await fireAdConversion(db, conversionRetryInput(row), {
      postAppsFlyer: postAppsFlyerS2SEvent,
    });
    conversionResults.push({
      event_id: row.event_id,
      status: result.ok ? "evaluated" : "failed",
      reason: result.reason ?? null,
      channels: result.results?.map((item) => ({
        channel: item.channel,
        status: item.status,
        reason: item.reason ?? null,
      })) ?? [],
    });
  }

  // #4238 W4-1 (I-4238-NATIVE-PURCHASE-VIA-APPSFLYER): native purchases whose
  // AppsFlyer post is still pending. Their ad channels are already skipped, so
  // the query above never selects them. The fire claims the post atomically.
  const nativeBudget = Math.max(
    0,
    AD_CONVERSION_RETRY_BATCH - conversionResults.length,
  );
  const { data: nativeRows, error: nativeQueryError } = nativeBudget === 0
    ? { data: [], error: null }
    : await db
      .from("ad_conversions")
      .select(
        "event_id,order_id,stay_group_id,event_type,surface,lane,created_at,updated_at",
      )
      .gte("created_at", configWindowStart)
      .lte("updated_at", graceCutoff)
      .eq("event_type", "purchase")
      .in("surface", ["ios", "android"])
      .eq("appsflyer_status", "pending")
      .order("updated_at", { ascending: true })
      .limit(nativeBudget);
  if (nativeQueryError) {
    console.warn(
      "[ad-conversion-retry] native AppsFlyer query failed:",
      nativeQueryError.message,
    );
  }
  for (const raw of nativeRows ?? []) {
    const row = raw as AdConversionRetryRow;
    const result = await fireAdConversion(db, conversionRetryInput(row), {
      postAppsFlyer: postAppsFlyerS2SEvent,
    });
    conversionResults.push({
      event_id: row.event_id,
      status: result.ok ? "evaluated_native" : "failed",
      reason: result.reason ?? null,
      channels: [],
    });
  }

  const remaining = Math.max(
    0,
    AD_CONVERSION_RETRY_BATCH - conversionResults.length,
  );
  const { data: checkoutStarts, error: checkoutQueryError } = remaining === 0
    ? { data: [], error: null }
    : await db
      .from("ticket_checkout_sessions")
      .select("id")
      .gte("created_at", windowStart)
      .lte("updated_at", graceCutoff)
      .is("ad_checkout_start_sent_at", null)
      .order("updated_at", { ascending: true })
      .limit(remaining);
  if (checkoutQueryError) {
    return json({ error: "checkout_start_query_failed" }, 500);
  }

  const checkoutResults: Array<Record<string, unknown>> = [];
  for (const row of checkoutStarts ?? []) {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) continue;
    const result = await fireAdCheckoutStart(db, id);
    checkoutResults.push({
      checkout_session_id: id,
      status: result.ok ? "evaluated" : "failed",
      reason: result.reason ?? null,
      channels: result.results?.map((item) => ({
        channel: item.channel,
        status: item.status,
        reason: item.reason ?? null,
      })) ?? [],
    });
  }

  const health = await runAdTrackingHealth(db);

  return json({
    window_start: windowStart,
    config_window_start: configWindowStart,
    health: {
      ok: health.ok,
      reason: health.reason ?? null,
      alerts: health.alerts,
    },
    conversion_rows: conversionResults.length,
    checkout_start_rows: checkoutResults.length,
    conversions: conversionResults,
    checkout_starts: checkoutResults,
  });
});
