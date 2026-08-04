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
 * #1541 — THE SEND GOES THROUGH `smsAdapter`, THE SOLE SANCTIONED EGRESS.
 * This function used to own a private Twilio client (`sendTwilioSms`) reading
 * TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_MESSAGING_SERVICE_SID itself,
 * which meant NO market kill switch existed on this path at all — not NG, not
 * US, nothing anyone could switch off without a code change and a deploy. The
 * adapter now owns the provider credentials, the approved-sender discipline, the
 * StatusCallback, country routing and the SMS_LIVE_ENABLED_* switches.
 *
 * I-PROPOSED invariants this fn upholds:
 *   - SMS-FROM-APPROVED-TOLLFREE-ONLY: the adapter sends ONLY via
 *     TWILIO_MESSAGING_SERVICE_SID (the approved toll-free), never a raw From.
 *   - SMS-OPT-OUT-HONORED: never send to a phone with a matching opt-out row.
 *     The opt-out gate still runs BEFORE the send — that ordering is asserted by
 *     send_venue_sms.test.ts T-SMS-3 and must not be reordered.
 *   - I-PROPOSED-1541-SMS-PROVIDER-EGRESS-ALLOWLIST: no direct provider HTTP.
 */

// @ts-ignore — Deno ESM import
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { smsAdapter } from "../_shared/adapters/smsAdapter.ts";

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

// #1541 — `sendTwilioSms()` lived here: a private Twilio client with its own
// TWILIO_* env reads and its own fetch to api.twilio.com/.../Messages.json.
// Deleted, not wrapped (subtract before adding). Its entire job — the approved
// Messaging Service, the 21610 blacklist classifier, the StatusCallback, and now
// country routing and the market kill switches it never had — belongs to
// smsAdapter. See the `smsAdapter.send` call in step 7 below.

// #1541 §4.7 — EXPORTED so the runtime companion test can drive a real Request
// through the real handler and assert on CAPTURED provider HTTP rather than on
// source text. Behaviour is unchanged: `serve(handler)` is the same call the
// module has always made, and Supabase invokes it identically.
export const handler = async (req: Request): Promise<Response> => {
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

  // 7. Send the locked copy through the sole sanctioned send path.
  //
  // The LOCKED COPY IS UNCHANGED, byte for byte. It already ends "Reply STOP to
  // opt out.", so composeSmsBody's /reply stop/i guard suppresses a second
  // footer, and the copy is pure ASCII so the GSM-7 sanitizer is a no-op.
  //
  // #1541 §4.0 — the ONE call shape. countryCode is OMITTED: this function has
  // no authoritative country label, and per #1529 the destination handset is the
  // routing authority. messagingServiceSid is OMITTED: omission selects the
  // approved transactional toll-free, which is exactly what this path used
  // before and must keep using.
  const copy = tableReadyCopy(venueName);
  const result = await smsAdapter.send({
    to: toPhone,
    brandName: venueName,
    message: copy,
  });

  // #1541 — BRANCH ON `status`, NEVER ON `ok`. `ok` is false for BOTH a
  // market-gated skip and a real provider failure, and conflating them is what
  // turns "this capability is switched off" into "something broke".
  if (result.status === "skipped") {
    // The market is dark. SMS is the SOLE channel for "your table's ready" —
    // there is no email or push leg — so a silent skip would mean the guest is
    // simply never told. This function is synchronous and operator-facing, so
    // the correct move is to hand the operator a distinct, actionable failure
    // and let them walk over and tell the guest in person.
    await logSend("skipped_market_dark", { error: result.error ?? "provider_kill_switch_off" });
    console.warn(
      "[send-venue-sms] market dark — send skipped with zero provider HTTP",
      result.error,
    );
    // DELIBERATELY NOT marked notified: the guest was not notified. The row
    // stays actionable so the operator can retry once the market goes live.
    //
    // 503, chosen against the alternatives already in use here: 409 already
    // means opted-out, 422 means a bad phone, 502 means the provider failed. A
    // dark market is none of those — it is "this capability is switched off
    // right now", which is precisely what 503 says.
    return json(503, {
      error: "sms_market_unavailable",
      detail: result.error ?? "provider_kill_switch_off",
    });
  }

  if (result.status === "failed") {
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
    console.error("[send-venue-sms] provider send failed", result.error);
    return json(502, { error: "sms_send_failed", detail: result.error });
  }

  await logSend("sent", { sid: result.providerMessageId });

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

  return json(200, { ok: true, sid: result.providerMessageId });
};

serve(handler);
