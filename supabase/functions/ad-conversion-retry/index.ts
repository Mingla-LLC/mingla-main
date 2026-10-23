// toward #3697: scheduled retry for server conversions and checkout-start
// signals. It re-evaluates the latest touch consent and browser opt-out latch on
// every attempt, and never retries anything older than 24 hours.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  AD_CONVERSION_RETRY_BATCH,
  type AdConversionRetryRow,
  conversionRetryInput,
  failedStatusesToPending,
  retryGraceCutoff,
  retryWindowCutoff,
} from "../_shared/adConversionRetry.ts";
import {
  fireAdCheckoutStart,
  fireAdConversion,
} from "../_shared/adConversionFire.ts";

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
  const graceCutoff = retryGraceCutoff(nowMs);

  const { data: conversions, error: conversionQueryError } = await db
    .from("ad_conversions")
    .select(
      "event_id,order_id,stay_group_id,event_type,surface,lane,updated_at,meta_capi_status,tiktok_events_status,snap_capi_status,reddit_capi_status,google_ads_status",
    )
    .gte("created_at", windowStart)
    .lte("updated_at", graceCutoff)
    .in("event_type", ["purchase", "reservation"])
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
    const failedPatch = failedStatusesToPending(row);
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
    const result = await fireAdConversion(db, conversionRetryInput(row));
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

  return json({
    window_start: windowStart,
    conversion_rows: conversionResults.length,
    checkout_start_rows: checkoutResults.length,
    conversions: conversionResults,
    checkout_starts: checkoutResults,
  });
});
