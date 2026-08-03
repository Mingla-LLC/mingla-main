/** Issue #1447 — authenticated RSVP admission scanner endpoint. */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const ipHits = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const current = ipHits.get(ip);
  if (!current || current.resetAt <= now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_MAX;
}

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") {
    return respond({ error: "method_not_allowed" }, 405);
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (isRateLimited(ip)) {
    console.warn(JSON.stringify({ event: "rsvp_scan_rate_limited" }));
    return respond({ error: "rate_limited" }, 429);
  }
  const startedAt = Date.now();
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("authorization");
  if (!url || !anon) return respond({ error: "server_misconfigured" }, 500);
  if (!authorization) return respond({ error: "auth_required" }, 401);
  const caller = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) {
    return respond({ error: "auth_required" }, 401);
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  const rawPayload = body.payload ?? body.qrPayload;
  const qrPayload = typeof rawPayload === "string" ? rawPayload.trim() : "";
  if (!UUID_RE.test(eventId) || !qrPayload || qrPayload.length > 512) {
    return respond({ error: "scan_payload_required" }, 400);
  }
  const { data, error } = await caller.rpc("biz_rsvp_scan", {
    p_event_id: eventId,
    p_qr_payload: qrPayload,
  });
  if (error) {
    const forbidden = error.message.includes("scanner_not_authorized");
    console.info(JSON.stringify({
      event: "rsvp_scan_result",
      eventId,
      outcome: forbidden ? "unauthorized" : "error",
      latencyMs: Date.now() - startedAt,
    }));
    return respond({
      error: forbidden ? "scanner_not_authorized" : "scan_failed",
    }, forbidden ? 403 : 400);
  }
  const result = (data ?? { result: "not_found" }) as Record<string, unknown>;
  console.info(JSON.stringify({
    event: "rsvp_scan_result",
    eventId,
    outcome: typeof result.result === "string" ? result.result : "error",
    latencyMs: Date.now() - startedAt,
  }));
  return respond(result);
});
