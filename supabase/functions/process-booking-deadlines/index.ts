/**
 * process-booking-deadlines — ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] hourly cron.
 *
 * CONTRACT:
 * - Invoked by pg_cron schedule 'orch-0875-process-booking-deadlines' every
 *   hour at minute 0 (see migration 20260612000000_tr4_refund_tiers_booking_deadline.sql §3.1.J).
 * - Service-role auth required (no anon access). pg_cron → pg_net → edge fn
 *   carries SUPABASE_SERVICE_ROLE_KEY in Authorization header; we additionally
 *   verify the header in case of misconfiguration.
 * - For each trip with booking_deadline <= now() AND bookings_closed=false,
 *   flip bookings_closed=true + bookings_closed_at=now() in a single batched
 *   UPDATE. Idempotent: WHERE bookings_closed=false ensures double-runs no-op.
 * - Optional notification: emit one info-only audit row per affected brand so
 *   operator dashboard can surface "bookings auto-closed by Mingla cron" history.
 *   No buyer-side notification (buyers don't have a booking to update if they
 *   haven't booked yet; they hit the ticket-checkout-create 403 instead).
 *
 * Idempotency: WHERE bookings_closed=false filter makes the UPDATE no-op on
 * second invocation; if invoked twice in the same hour, the second run touches
 * zero rows. Cron retry is safe.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { writeAudit } from "../_shared/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

interface ProcessResult {
  processed: number;
  errors: Array<{ event_id: string; reason: string }>;
  dryRun: boolean;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeServiceClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("missing_supabase_env");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isAuthorizedServiceRole(req: Request): boolean {
  // pg_cron → pg_net sets Authorization: Bearer <service_role_key>.
  // Verify before any DB write.
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return false;
  }
  const token = auth.slice(7).trim();
  return token === SUPABASE_SERVICE_ROLE_KEY;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  if (!isAuthorizedServiceRole(req)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body: { dryRun?: boolean } = {};
  try {
    if (req.headers.get("content-length") !== "0" && req.headers.get("content-type")?.includes("json")) {
      body = await req.json();
    }
  } catch {
    // Empty / non-JSON body is fine — pg_cron sends '{}'
  }
  const dryRun = body.dryRun === true;

  const supabase = makeServiceClient();
  const result: ProcessResult = { processed: 0, errors: [], dryRun };

  // Atomic flip: only trips, only past deadline, only currently-open.
  // RETURNING gives us the affected event ids for audit + future notification.
  if (dryRun) {
    const { data, error } = await supabase
      .from("events")
      .select("id, brand_id, booking_deadline")
      .eq("event_type", "trip")
      .eq("bookings_closed", false)
      .not("booking_deadline", "is", null)
      .lte("booking_deadline", new Date().toISOString());
    if (error) {
      console.error("[process-booking-deadlines] dryRun query failed", error);
      return jsonResponse({ error: "query_failed", detail: error.message }, 500);
    }
    result.processed = (data ?? []).length;
    return jsonResponse(result);
  }

  // Real flip — UPDATE ... RETURNING via Supabase JS .update().select() pattern.
  // .update() runs as service-role so RLS doesn't block.
  const { data: updated, error: updateErr } = await supabase
    .from("events")
    .update({ bookings_closed: true, bookings_closed_at: new Date().toISOString() })
    .eq("event_type", "trip")
    .eq("bookings_closed", false)
    .not("booking_deadline", "is", null)
    .lte("booking_deadline", new Date().toISOString())
    .select("id, brand_id, booking_deadline");

  if (updateErr) {
    console.error("[process-booking-deadlines] update failed", updateErr);
    return jsonResponse({ error: "update_failed", detail: updateErr.message }, 500);
  }

  const updatedRows = (updated ?? []) as Array<{
    id: string;
    brand_id: string;
    booking_deadline: string;
  }>;
  result.processed = updatedRows.length;

  // Audit row per affected event (info-only; operator dashboard can surface from audit_logs).
  for (const row of updatedRows) {
    try {
      await writeAudit(supabase, {
        user_id: null,
        brand_id: row.brand_id,
        event_id: row.id,
        action: "bookings_auto_closed_by_cron",
        target_type: "event",
        target_id: row.id,
        after: {
          booking_deadline: row.booking_deadline,
          closed_at: new Date().toISOString(),
          source: "orch-0875-process-booking-deadlines",
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[process-booking-deadlines] audit write failed (non-fatal)", { event_id: row.id, reason });
      result.errors.push({ event_id: row.id, reason });
    }
  }

  return jsonResponse(result);
});
