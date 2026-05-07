import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  dispatchNotification,
  jsonResponse,
  serviceRoleClient,
} from "../_shared/stripeEdgeAuth.ts";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!cronSecret || auth !== cronSecret) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const supabase = serviceRoleClient();
  const { data, error } = await supabase
    .from("payment_webhook_events")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[stripe-webhook-health-check] latest webhook query failed:", error);
    return jsonResponse({ error: "query_failed" }, 500);
  }

  const latest = data?.created_at ? new Date(data.created_at).getTime() : 0;
  const silentForMs = latest > 0 ? Date.now() - latest : Number.POSITIVE_INFINITY;
  const silent = silentForMs > SIX_HOURS_MS;

  if (silent) {
    await dispatchNotification({
      emailTo: "ops@mingla.app",
      type: "ops.webhook_silence_alert",
      title: "Stripe webhook silence alert",
      body: "No Stripe webhook events have been recorded for more than 6 hours.",
      data: { latest_created_at: data?.created_at ?? null, silent_for_ms: silentForMs },
      idempotencyKey: `ops.webhook_silence_alert:${new Date().toISOString().slice(0, 13)}`,
      skipPush: true,
    });
    await writeAudit(supabase, {
      user_id: null,
      brand_id: null,
      action: "ops.webhook_silence_check_fired",
      target_type: "stripe_webhook_health",
      target_id: "stripe-webhook",
      after: { latest_created_at: data?.created_at ?? null, silent_for_ms: silentForMs },
    });
  }

  return jsonResponse({
    ok: true,
    silent,
    latest_created_at: data?.created_at ?? null,
    silent_for_ms: Number.isFinite(silentForMs) ? silentForMs : null,
  });
});
