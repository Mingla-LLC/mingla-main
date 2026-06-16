/**
 * ORCH-1150 — public-submit-rsvp
 *
 * Anon-capable guest RSVP write for event_type='rsvp' events. verify_jwt=false
 * (config.toml). Runs under service-role; validates input; calls the
 * SECURITY DEFINER `submit_event_rsvp` RPC which does the two-dimension
 * resolve + real waitlist write (SPEC §5.3).
 *
 * ORCH-1150: do NOT merge back into the event/ticket checkout path — RSVP has
 * zero tickets + no money gate; this writes a Going/Not-going row, never an
 * order. Notify is TRANSACTIONAL (fired by the publish-edit / approve-deny /
 * auto-promote producers, NOT here).
 *
 * A4-NEW: a link guest (no JWT) MUST supply name + email + phone. A logged-in
 * app-user (JWT resolves a user_id) supplies none of those (profile-inherited).
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SubmitRsvpRequest {
  eventId?: string;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  rsvpStatus?: "going" | "not_going";
  plusCount?: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// E.164-ish: optional +, 7–15 digits.
const PHONE_RE = /^\+?[0-9]{7,15}$/;

// Naive in-memory per-IP rate limit (best-effort; resets on cold start). The DB
// unique indexes + the RPC are the real guard; this just blunts burst spam.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const ipHits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (entry === undefined || now > entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
}

function normalizePhone(raw: string): string | null {
  const trimmed = raw.replace(/[\s()-]/g, "");
  if (!PHONE_RE.test(trimmed)) return null;
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("[public-submit-rsvp] missing SUPABASE_URL / service key");
    return json(500, { error: "server_misconfigured" });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return json(429, { error: "rate_limited" });
  }

  let body: SubmitRsvpRequest;
  try {
    body = (await req.json()) as SubmitRsvpRequest;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  const rsvpStatus = body.rsvpStatus;
  if (eventId.length === 0) {
    return json(400, { error: "event_id_required" });
  }
  if (rsvpStatus !== "going" && rsvpStatus !== "not_going") {
    return json(400, { error: "rsvp_status_invalid" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Resolve a logged-in app user from the bearer token, if present.
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (token.length > 0) {
    try {
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data.user) {
        userId = data.user.id;
      }
    } catch (err) {
      // Non-fatal: fall through as an anon link guest.
      console.warn("[public-submit-rsvp] token resolve failed", String(err));
    }
  }

  const guestName =
    typeof body.guestName === "string" ? body.guestName.trim() : "";
  const guestEmail =
    typeof body.guestEmail === "string" ? body.guestEmail.trim() : "";
  const rawPhone =
    typeof body.guestPhone === "string" ? body.guestPhone.trim() : "";

  let normalizedPhone: string | null = null;

  // A4-NEW: link guest (anon) must carry name + email + phone, all valid.
  if (userId === null) {
    if (
      guestName.length === 0 ||
      guestEmail.length === 0 ||
      !EMAIL_RE.test(guestEmail) ||
      rawPhone.length === 0
    ) {
      return json(400, { error: "rsvp_contact_required" });
    }
    normalizedPhone = normalizePhone(rawPhone);
    if (normalizedPhone === null) {
      return json(400, { error: "rsvp_phone_invalid" });
    }
  } else if (rawPhone.length > 0) {
    normalizedPhone = normalizePhone(rawPhone);
    if (normalizedPhone === null) {
      return json(400, { error: "rsvp_phone_invalid" });
    }
  }

  const plusCount =
    typeof body.plusCount === "number" && Number.isFinite(body.plusCount)
      ? Math.max(0, Math.floor(body.plusCount))
      : 0;

  const { data, error } = await admin.rpc("submit_event_rsvp", {
    p_event_id: eventId,
    p_user_id: userId,
    p_guest_name: guestName.length > 0 ? guestName : null,
    p_guest_email: guestEmail.length > 0 ? guestEmail : null,
    p_guest_phone: normalizedPhone,
    p_rsvp_status: rsvpStatus,
    p_plus_count: plusCount,
  });

  if (error !== null) {
    const code = error.message ?? "";
    if (code.includes("rsvp_not_open")) return json(404, { error: "rsvp_not_open" });
    if (code.includes("rsvp_full")) return json(409, { error: "rsvp_full" });
    if (code.includes("rsvp_contact_required")) {
      return json(400, { error: "rsvp_contact_required" });
    }
    if (code.includes("rsvp_status_invalid")) {
      return json(400, { error: "rsvp_status_invalid" });
    }
    console.error("[public-submit-rsvp] rpc error", code);
    return json(500, { error: "rsvp_write_failed" });
  }

  const result = (data ?? {}) as {
    status?: string;
    approvalStatus?: string;
    capacityFull?: boolean;
  };

  return json(200, {
    status: result.status ?? rsvpStatus,
    approvalStatus: result.approvalStatus ?? "approved",
    capacityFull: result.capacityFull ?? false,
  });
});
