// ORCH-0785: This function does NOT send email despite its name.
// The customer email path is `_shared/email/` + `ticket-confirmation-dispatch`
// (transactional) or `notify-dispatch` with `emailVariant: "generic_notification"`
// (system/relational). Rename deferred to a separate ORCH.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// #1541 — THE SOLE SANCTIONED SMS EGRESS. This function used to POST to Twilio
// itself, and it is one of the two paths that text people who are NOT YET
// MINGLA USERS. It did so from a RAW `From` number when
// TWILIO_MESSAGING_SERVICE_SID was absent (violating
// I-PROPOSED-1161-SMS-FROM-APPROVED-SENDER-ONLY), with NO "Reply STOP" line and
// NO StatusCallback — so an inbound STOP was never even recorded. That is a
// CTIA opt-out exposure, not merely a routing one. The adapter fixes all three:
// approved sender only, STOP footer appended, StatusCallback wired.
import { smsAdapter } from "../_shared/adapters/smsAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const MAX_INVITES_PER_DAY = 10;

// #1541 §4.7 — EXPORTED so the runtime companion test can drive a real Request
// through the real handler and assert on CAPTURED provider HTTP rather than on
// source text. `serve(handler)` below is the same call this module always made.
export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { phone_e164 } = await req.json();

    if (!phone_e164 || !E164_REGEX.test(phone_e164)) {
      return new Response(
        JSON.stringify({
          error:
            "Invalid phone number format. Use E.164 (e.g., +14155551234).",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const inviterId = user.id;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if phone belongs to inviter themselves
    const { data: selfProfile } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", inviterId)
      .single();

    if (selfProfile?.phone === phone_e164) {
      return new Response(
        JSON.stringify({ error: "You cannot invite your own phone number." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if phone belongs to an existing Mingla user
    const { data: existingUser } = await supabaseAdmin
      .from("profiles")
      .select("id, username, display_name")
      .eq("phone", phone_e164)
      .maybeSingle();

    if (existingUser) {
      return new Response(
        JSON.stringify({
          error:
            "This phone number belongs to an existing Mingla user. Use 'Search Mingla' to link with them instead.",
          existingUserId: existingUser.id,
          existingUsername: existingUser.username,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Rate limit: max 10 invites per 24h (count ALL invites, not just pending,
    // to prevent spam via cancel/re-invite cycling)
    const twentyFourHoursAgo = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    ).toISOString();
    const { count, error: countError } = await supabaseAdmin
      .from("pending_invites")
      .select("id", { count: "exact", head: true })
      .eq("inviter_id", inviterId)
      .gte("created_at", twentyFourHoursAgo);

    if (countError) {
      console.error("Rate limit check error:", countError);
      return new Response(
        JSON.stringify({ error: "Failed to process invite" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if ((count ?? 0) >= MAX_INVITES_PER_DAY) {
      return new Response(
        JSON.stringify({
          error: "You've sent too many invites today. Try again tomorrow.",
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check for existing pending invite for this pair
    const { data: existingInvite } = await supabaseAdmin
      .from("pending_invites")
      .select("id, status")
      .eq("inviter_id", inviterId)
      .eq("phone_e164", phone_e164)
      .maybeSingle();

    if (existingInvite) {
      if (existingInvite.status === "pending") {
        return new Response(
          JSON.stringify({
            success: true,
            inviteId: existingInvite.id,
            status: "already_invited",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      // If cancelled, reactivate
      if (existingInvite.status === "cancelled") {
        await supabaseAdmin
          .from("pending_invites")
          .update({
            status: "pending",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingInvite.id);
      }
    }

    // Insert pending_invites row (or use reactivated cancelled one)
    let inviteId: string;
    if (existingInvite && existingInvite.status === "cancelled") {
      inviteId = existingInvite.id;
    } else if (!existingInvite) {
      const { data: newInvite, error: insertError } = await supabaseAdmin
        .from("pending_invites")
        .insert({
          inviter_id: inviterId,
          phone_e164: phone_e164,
          status: "pending",
        })
        .select("id")
        .single();

      if (insertError || !newInvite) {
        console.error("Insert pending_invite error:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to create invite" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      inviteId = newInvite.id;
    } else {
      // existingInvite.status === 'converted' — already signed up and linked
      return new Response(
        JSON.stringify({
          success: true,
          inviteId: existingInvite.id,
          status: "already_invited",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get inviter display name
    const { data: inviterProfile } = await supabaseAdmin
      .from("profiles")
      .select("display_name, username")
      .eq("id", inviterId)
      .single();

    const inviterName =
      inviterProfile?.display_name ||
      inviterProfile?.username ||
      "A friend";

    // #1541 — the inline Twilio block that lived here is GONE, including the
    // TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN reads, the hand-built bodyParams,
    // and the raw-`From` fallback env var (TWILIO_FROM_*). NO RAW `From` SURVIVES
    // ANYWHERE IN THIS FILE (F-3).
    //
    // §4.0 — the ONE call shape. The body is today's verbatim, WITHOUT a STOP
    // footer: the adapter appends it. That appended footer is the intended,
    // named fix for this path's missing opt-out affordance, not drift.
    // countryCode is omitted (the destination handset is the routing authority,
    // #1529); messagingServiceSid is omitted, which is precisely what retires
    // the raw-`From` fallback — omission selects the approved transactional
    // toll-free and there is no longer any code path to anything else.
    const smsBody = `${inviterName} invited you to Mingla! Plan experiences together. Download now: https://mingla.app/invite`;

    const result = await smsAdapter.send({
      to: phone_e164,
      brandName: "Mingla",
      message: smsBody,
    });

    // These paths have never had a delivery record of any kind (F-4), so their
    // real send history is unrecoverable. Routing through the adapter gives
    // them the notification_deliveries ledger for the first time; this log is
    // the cheapest honest signal available in the meantime.
    console.info(
      JSON.stringify({
        event: "phone_invite_sms",
        status: result.status,
        error: result.error ?? null,
      }),
    );

    // THE INVITE ROW STAYS INDEPENDENT. `pending_invites` was written before
    // the send and remains so: the invite exists regardless of the SMS outcome,
    // and the endpoint keeps returning HTTP 200 { success: true } for every
    // adapter outcome. No client change is required, and none is permitted here.
    //
    // #1541 (F-4) — FIX THE SUCCESS LIE. This used to return status: "sent"
    // even when Twilio had errored, so the response asserted a delivery that
    // never happened and nothing recorded the truth. Report the real outcome.
    // The success/HTTP contract is unchanged, so no consumer breaks —
    // app-mobile/src/services/phoneInviteService.ts reads `inviteId`, not
    // `status`.
    // #2218 — `deferred` reports as itself. Collapsing it into `send_failed`
    // would repeat the #1541 defect in the opposite direction: claiming a fault
    // where the network simply is not carrying this class of traffic yet.
    const reportedStatus = result.status === "sent"
      ? "sent"
      : result.status === "skipped"
      ? "skipped"
      : result.status === "deferred"
      ? "deferred"
      : "send_failed";

    return new Response(
      JSON.stringify({ success: true, inviteId, status: reportedStatus }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("send-phone-invite error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

serve(handler);
