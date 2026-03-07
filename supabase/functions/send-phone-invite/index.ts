import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const MAX_INVITES_PER_DAY = 10;

serve(async (req: Request) => {
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

    // Send SMS via Twilio Programmable Messaging
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;

    const smsBody = `${inviterName} invited you to Mingla! Plan experiences together. Download now: https://mingla.app/invite`;

    const bodyParams: Record<string, string> = {
      To: phone_e164,
      Body: smsBody,
    };

    // Use MessagingServiceSid if available, otherwise use From number
    const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
    const fromPhone = Deno.env.get("TWILIO_FROM_PHONE");

    if (messagingServiceSid) {
      bodyParams.MessagingServiceSid = messagingServiceSid;
    } else if (fromPhone) {
      bodyParams.From = fromPhone;
    } else {
      console.error(
        "No TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_PHONE configured"
      );
      // Still return success — the invite is created in the DB even if SMS fails
    }

    if (accountSid && authToken && (messagingServiceSid || fromPhone)) {
      try {
        const twilioResponse = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams(bodyParams),
          }
        );

        const twilioData = await twilioResponse.json();

        if (!twilioResponse.ok) {
          console.error("Twilio SMS error:", twilioData);
          // Don't fail — invite is still stored
        } else {
          console.log("SMS sent successfully, SID:", twilioData.sid);
        }
      } catch (smsError) {
        console.error("SMS send error:", smsError);
        // Don't fail — invite is still stored
      }
    }

    return new Response(
      JSON.stringify({ success: true, inviteId, status: "sent" }),
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
});
