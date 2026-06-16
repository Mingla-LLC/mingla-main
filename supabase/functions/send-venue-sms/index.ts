/**
 * META-ORCH-1148 sub-ORCH 2.1b — send-venue-sms
 *
 * The operator-triggered "table's ready" Twilio SMS for the venue waitlist.
 * verify_jwt=true (config.toml): the gateway verifies the caller's Supabase JWT;
 * this fn ADDITIONALLY gates on brand membership (manager+) before sending.
 *
 * Request: POST { waitlistId: string }
 *   Resolves the waitlist row → brand → guest phone, gates the caller on
 *   manager-plus rank for that brand, validates E.164, honors the SMS opt-out
 *   ledger (STOP), then sends EXACTLY the locked copy via the APPROVED toll-free
 *   Messaging Service, logs the attempt to venue_sms_log, and (on success) marks
 *   the waitlist row notified via biz_waitlist_mark_notified.
 *
 * Locked SMS copy (NO link, do NOT paraphrase):
 *   "Your table's ready at {VenueName}. Reply STOP to opt out."
 *
 * Twilio creds from Deno env (Supabase secrets — NEVER hardcoded; the
 * orchestrator sets them at deploy):
 *   TWILIO_ACCOUNT_SID · TWILIO_AUTH_TOKEN · TWILIO_MESSAGING_SERVICE_SID
 * (the Messaging Service is bound to the approved toll-free +1 888-250-5351).
 *
 * Twilio send clones the proven pattern from ticket-confirmation-dispatch /
 * rsvp-notify (the Messaging Service path), with the StatusCallback wired so
 * inbound STOP keywords land an opt-out (handled by twilio-message-status).
 *
 * I-PROPOSED invariants this fn upholds:
 *   - SMS-FROM-APPROVED-TOLLFREE-ONLY: send ONLY via TWILIO_MESSAGING_SERVICE_SID
 *     (the approved toll-free), never a raw From number.
 *   - SMS-OPT-OUT-HONORED: never send to a phone with a matching opt-out row.
 */

// @ts-ignore — Deno ESM import
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirror the server-side validator (utils/phone.ts + _shared/ticketCheckout.ts).
const E164_RE = /^\+[1-9][0-9]{1,14}$/;

const isValidE164 = (v: string): boolean => E164_RE.test(v.trim());

/** The LOCKED copy — exact, no link. */
function tableReadyCopy(venueName: string): string {
  return `Your table's ready at ${venueName}. Reply STOP to opt out.`;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Twilio send via the Messaging Service (the approved toll-free) — cloned from
// rsvp-notify/ticket-confirmation-dispatch. NEVER uses a raw From number.
async function sendTwilioSms(
  to: string,
  body: string,
): Promise<{ ok: boolean; sid?: string; error?: string; blacklisted?: boolean }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  if (!accountSid || !authToken || !messagingServiceSid) {
    return { ok: false, error: "twilio_env_missing" };
  }
  const statusSecret = Deno.env.get("TWILIO_STATUS_CALLBACK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const statusCallback =
    statusSecret && supabaseUrl
      ? `${supabaseUrl}/functions/v1/twilio-message-status?secret=${encodeURIComponent(statusSecret)}`
      : undefined;
  const params = new URLSearchParams({
    To: to,
    MessagingServiceSid: messagingServiceSid,
    Body: body,
  });
  if (statusCallback) params.set("StatusCallback", statusCallback);
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      // Twilio 21610 = recipient has opted out (blacklisted).
      const blacklisted = text.includes("21610");
      return { ok: false, error: `Twilio ${res.status}: ${text}`, blacklisted };
    }
    const data = (await res.json()) as { sid?: string };
    return { ok: true, sid: data.sid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    console.error("[send-venue-sms] missing supabase env");
    return json(500, { error: "server_misconfigured" });
  }

  // 1. Authenticate the caller (user JWT).
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "missing_authorization" });
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !authData?.user) {
    return json(401, { error: "not_authenticated" });
  }
  const userId = authData.user.id;

  // 2. Parse body.
  let reqBody: { waitlistId?: string };
  try {
    reqBody = (await req.json()) as { waitlistId?: string };
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const waitlistId =
    typeof reqBody.waitlistId === "string" ? reqBody.waitlistId : "";
  if (!UUID_RE.test(waitlistId)) {
    return json(400, { error: "waitlist_id_required" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // 3. Resolve the waitlist row + brand.
  const { data: wait, error: waitErr } = await admin
    .from("venue_waitlist")
    .select("id, brand_id, guest_name, guest_phone_e164, status")
    .eq("id", waitlistId)
    .maybeSingle();
  if (waitErr || !wait) {
    return json(404, { error: "waitlist_not_found" });
  }
  const brandId: string = wait.brand_id;
  const toPhone: string | null = wait.guest_phone_e164 ?? null;

  // 4. Brand-member gate (manager+). Use the caller's auth context against the
  // SECURITY DEFINER rank helper (the same gate the lifecycle RPCs use).
  const { data: rankData, error: rankErr } = await userClient.rpc(
    "biz_brand_effective_rank_for_caller",
    { p_brand_id: brandId },
  );
  if (rankErr) {
    console.error("[send-venue-sms] rank check failed", rankErr.message);
    return json(500, { error: "rank_check_failed" });
  }
  const rank = typeof rankData === "number" ? rankData : 0;
  const EVENT_MANAGER_RANK = 40;
  if (rank < EVENT_MANAGER_RANK) {
    return json(403, { error: "not_authorized" });
  }

  // Resolve the venue name for the copy.
  let venueName = "the venue";
  const { data: brandRow } = await admin
    .from("brands")
    .select("name")
    .eq("id", brandId)
    .maybeSingle();
  if (brandRow?.name && typeof brandRow.name === "string") {
    venueName = brandRow.name;
  }

  // Helper to append to the send log (service-role; append-only).
  const logSend = async (
    status: string,
    extra: { sid?: string | null; error?: string | null },
  ): Promise<void> => {
    await admin.from("venue_sms_log").insert({
      brand_id: brandId,
      waitlist_id: waitlistId,
      to_phone_e164: toPhone ?? "",
      template: "table_ready",
      status,
      twilio_message_sid: extra.sid ?? null,
      error: extra.error ?? null,
      triggered_by: userId,
    });
  };

  // 5. Validate E.164.
  if (toPhone === null || !isValidE164(toPhone)) {
    await logSend("skipped_invalid_phone", { error: "invalid_or_missing_e164" });
    return json(422, { error: "invalid_phone", reason: "not_e164" });
  }

  // 6. Opt-out gate (SMS-OPT-OUT-HONORED) — a global (brand_id IS NULL) OR a
  // per-brand opt-out row for this phone blocks the send.
  const { data: optRows } = await admin
    .from("venue_sms_opt_out")
    .select("id, brand_id")
    .eq("phone_e164", toPhone);
  const optedOut =
    Array.isArray(optRows) &&
    optRows.some(
      (r: { brand_id: string | null }) =>
        r.brand_id === null || r.brand_id === brandId,
    );
  if (optedOut) {
    await logSend("skipped_opt_out", { error: "recipient_opted_out" });
    return json(409, { error: "opted_out" });
  }

  // 7. Send the locked copy via the approved toll-free Messaging Service.
  const copy = tableReadyCopy(venueName);
  const result = await sendTwilioSms(toPhone, copy);

  if (!result.ok) {
    // A 21610 (blacklisted) means Twilio knows the recipient opted out — persist
    // a global opt-out so we never try again (defensive; the inbound STOP webhook
    // is the primary path).
    //
    // D-2: venue_sms_opt_out has ONLY PARTIAL unique indexes (global brand_id IS
    // NULL / per-brand brand_id IS NOT NULL) — never a plain UNIQUE(phone_e164) —
    // so a plain `.upsert({ onConflict: "phone_e164" })` errors at runtime
    // ("no unique or exclusion constraint matching the ON CONFLICT specification")
    // and never persists. Route through the SECURITY DEFINER RPC, whose
    // ON CONFLICT (phone_e164) WHERE brand_id IS NULL DO NOTHING matches the GLOBAL
    // partial index exactly and is idempotent. Guard with try/catch so a failure
    // here NEVER masks the subsequent logSend("failed") / response.
    if (result.blacklisted) {
      try {
        const { error: optErr } = await admin.rpc(
          "biz_sms_record_global_opt_out",
          { p_phone_e164: toPhone, p_reason: "twilio_blacklist" },
        );
        if (optErr) {
          console.warn(
            "[send-venue-sms] defensive opt-out persist failed (non-fatal)",
            optErr.message,
          );
        }
      } catch (optThrow) {
        console.warn(
          "[send-venue-sms] defensive opt-out persist threw (non-fatal)",
          String(optThrow),
        );
      }
    }
    await logSend("failed", { error: result.error ?? "twilio_error" });
    console.error("[send-venue-sms] twilio send failed", result.error);
    return json(502, { error: "sms_send_failed", detail: result.error });
  }

  await logSend("sent", { sid: result.sid });

  // 8. Mark the waitlist row notified (atomic + audited via the RPC, in the
  // caller's auth context so the RPC's own brand gate applies).
  try {
    await userClient.rpc("biz_waitlist_mark_notified", {
      p_waitlist_id: waitlistId,
      p_expire_minutes: 15,
      p_notify_via: "sms",
    });
  } catch (markErr) {
    // Non-fatal: the SMS already went out + is logged. Surface a soft warning.
    console.warn("[send-venue-sms] mark-notified failed (non-fatal)", String(markErr));
  }

  return json(200, { ok: true, sid: result.sid });
});
