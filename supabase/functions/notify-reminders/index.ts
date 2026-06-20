// META-ORCH-1161 Sub-C "b" — notify-reminders.
//
// SPEC §7.3: a pg_cron schedule (~every 15 min) POSTs here. We call the
// pg_notify_reminders_enqueue() RPC once per lead bucket (24h + 2h). The RPC does
// the atomic windowed select → INSERT into notification_outbox (idempotent per
// {category}:{entityId}:{leadBucket}); the existing 1-min outbox drain then
// forwards each row to notify-dispatch v2 (simultaneous send + can_send gate +
// per-market SMS kill-switch). This fn NEVER sends directly.
//
// Lead times are ENV-configurable (defaults 24h + 2h per §7.3 / §12 Q1 RESOLVED):
//   REMINDER_LEAD_24H_HOURS  (default 24)
//   REMINDER_LEAD_2H_HOURS   (default 2)
//   REMINDER_WINDOW_MINUTES  (default 30 → ±15 min tolerance for a 15-min cron)
//
// verify_jwt=false (config.toml): invoked by pg_cron with the service-role bearer.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function envInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "missing_authorization" }, 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const lead24h = envInt("REMINDER_LEAD_24H_HOURS", 24);
  const lead2h = envInt("REMINDER_LEAD_2H_HOURS", 2);
  const windowMinutes = envInt("REMINDER_WINDOW_MINUTES", 30);

  // One enqueue pass per lead bucket. Each is independently idempotent (the outbox
  // UNIQUE on idempotency_key), so a failure of one bucket never blocks the other.
  const buckets: Array<{ bucket: "24h" | "2h"; hours: number }> = [
    { bucket: "24h", hours: lead24h },
    { bucket: "2h", hours: lead2h },
  ];

  const results: Record<string, number | string> = {};
  let hadError = false;

  for (const { bucket, hours } of buckets) {
    const { data, error } = await admin.rpc("pg_notify_reminders_enqueue", {
      p_lead_hours: hours,
      p_lead_bucket: bucket,
      p_window_minutes: windowMinutes,
    });
    if (error) {
      hadError = true;
      results[bucket] = `error: ${error.message}`;
      console.error(`[notify-reminders] enqueue ${bucket} failed:`, error.message);
    } else {
      results[bucket] = typeof data === "number" ? data : 0;
    }
  }

  // Surface partial failure (no silent failure) but never throw — the cron should
  // keep running and retry next tick; idempotency makes retries safe.
  return json({ ok: !hadError, enqueued: results, windowMinutes }, hadError ? 207 : 200);
});
