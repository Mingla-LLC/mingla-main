// META-ORCH-1161 Sub-A — twilio-inbound-sms (the STOP/HELP webhook gap).
//
// Twilio "A MESSAGE COMES IN" webhook. Twilio auto-handles STOP at the carrier
// level; this webhook is the APP-SIDE suppression sync (FCC requires honoring
// opt-out from any channel). On a STOP keyword:
//   - write channel_suppressions(channel='sms', scope='all', reason='stop_keyword')
//   - write the back-compat venue ledger via biz_sms_record_global_opt_out
// On HELP: reply with sender identity + support (TwiML).
//
// verify_jwt=false (config.toml): Twilio cannot present a Supabase JWT; we gate on
// a shared ?secret= query param (same posture as twilio-message-status).
// DO-NOT-TOUCH: this EXTENDS the venue opt-out semantics via the inbound webhook
// only — it does not change send-venue-sms or venue_sms_opt_out write logic.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// The 7 FCC keywords + the standard Twilio Advanced Opt-Out set.
const STOP_KEYWORDS = new Set([
  "stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout", "opt-out",
]);
const HELP_KEYWORDS = new Set(["help", "info"]);

function twiml(message: string | null): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/xml" } });
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const sharedSecret = Deno.env.get("TWILIO_STATUS_CALLBACK_SECRET");
  if (sharedSecret && url.searchParams.get("secret") !== sharedSecret) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return twiml(null);
  }

  const from = String(form.get("From") ?? "").trim(); // the user's E.164
  const bodyRaw = String(form.get("Body") ?? "").trim();
  const keyword = bodyRaw.toLowerCase().replace(/[^a-z-]/g, "");

  if (!from) return twiml(null);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[twilio-inbound-sms] missing supabase env");
    return twiml(null);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  if (STOP_KEYWORDS.has(keyword)) {
    // 1. App-side suppression (scope='all' — one opt-out kills all SMS scopes).
    try {
      await admin.from("channel_suppressions").insert({
        user_id: null,
        contact: from,
        channel: "sms",
        scope: "all",
        reason: "stop_keyword",
        brand_id: null,
      });
    } catch (err) {
      // Unique-index conflict is fine (already suppressed); anything else logs.
      console.warn("[twilio-inbound-sms] suppression insert note:", String(err));
    }

    // 2. Back-compat venue ledger (global opt-out via the existing RPC).
    try {
      const { error: optErr } = await admin.rpc("biz_sms_record_global_opt_out", {
        p_phone_e164: from,
        p_reason: "stop_keyword",
      });
      if (optErr) console.warn("[twilio-inbound-sms] venue opt-out note:", optErr.message);
    } catch (err) {
      console.warn("[twilio-inbound-sms] venue opt-out threw (non-fatal):", String(err));
    }

    // Twilio auto-sends the carrier STOP confirmation; return empty TwiML so we
    // don't double-message.
    return twiml(null);
  }

  if (HELP_KEYWORDS.has(keyword)) {
    return twiml(
      "Mingla: booking and event updates. Reply STOP to opt out. Help: support@usemingla.com",
    );
  }

  // Any other inbound message — no action (no auto-reply on arbitrary inbound).
  return twiml(null);
});
