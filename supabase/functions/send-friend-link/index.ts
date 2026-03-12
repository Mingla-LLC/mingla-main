import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── UUID validation ──────────────────────────────────────────────────────────
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse body
    let { targetUserId, phone_e164, personId } = await req.json();

    // At least one of targetUserId or phone_e164 must be provided
    const hasTarget = targetUserId && typeof targetUserId === "string" && UUID_REGEX.test(targetUserId);
    const hasPhone = phone_e164 && typeof phone_e164 === "string";

    if (!hasTarget && !hasPhone) {
      return new Response(
        JSON.stringify({ error: "Either targetUserId or phone_e164 must be provided" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Auth — create user-scoped client
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

    const requesterId = user.id;

    // Service-role client for privileged operations (push notifications, cross-user reads)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Phone-based resolution: resolve phone to existing user or defer ──────
    if (hasPhone && !hasTarget) {
      // Validate E.164 format
      const E164_REGEX = /^\+[1-9]\d{6,14}$/;
      if (!E164_REGEX.test(phone_e164)) {
        return new Response(
          JSON.stringify({ error: "Invalid phone number format. Must be E.164 (e.g. +14155551234)" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Check if this phone belongs to an existing Mingla user
      const { data: existingUser, error: phoneCheckError } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("phone", phone_e164)
        .maybeSingle();

      if (phoneCheckError) {
        console.error("Phone lookup error:", phoneCheckError);
        return new Response(
          JSON.stringify({ error: "Failed to look up phone number" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (existingUser) {
        // Phone belongs to existing user — set targetUserId and fall through
        targetUserId = existingUser.id;
      } else {
        // Not on Mingla yet — create a deferred intent

        // Check for existing pending intent before inserting
        // (partial unique index WHERE status='pending' can't be targeted by upsert)
        const { data: existingIntent } = await supabaseAdmin
          .from("pending_friend_link_intents")
          .select("id")
          .eq("inviter_id", requesterId)
          .eq("phone_e164", phone_e164)
          .eq("status", "pending")
          .maybeSingle();

        let intentId: string;

        if (existingIntent) {
          // Already have a pending intent for this inviter+phone — reuse it
          intentId = existingIntent.id;

          // Update person_id if provided and different
          if (personId && UUID_REGEX.test(personId)) {
            await supabaseAdmin
              .from("pending_friend_link_intents")
              .update({
                person_id: personId,
                updated_at: new Date().toISOString(),
              })
              .eq("id", intentId);
          }
        } else {
          // No pending intent exists — insert a new one
          const { data: newIntent, error: intentError } = await supabaseAdmin
            .from("pending_friend_link_intents")
            .insert({
              inviter_id: requesterId,
              phone_e164,
              person_id: personId && UUID_REGEX.test(personId) ? personId : null,
              status: "pending",
            })
            .select("id")
            .single();

          if (intentError || !newIntent) {
            console.error("Pending friend link intent insert error:", intentError);
            return new Response(
              JSON.stringify({ error: "Failed to create deferred link intent" }),
              {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          intentId = newIntent.id;
        }

        // Ensure a pending_invites row exists for this phone
        const { error: pendingInviteError } = await supabaseAdmin
          .from("pending_invites")
          .upsert(
            {
              inviter_id: requesterId,
              phone_e164,
            },
            { onConflict: "inviter_id,phone_e164" }
          );

        if (pendingInviteError) {
          console.warn("pending_invites upsert warning:", pendingInviteError.message);
        }

        return new Response(
          JSON.stringify({
            status: "deferred",
            intentId,
            message: "This person isn't on Mingla yet. They'll receive the link request when they join.",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Cannot link with yourself
    if (targetUserId === requesterId) {
      return new Response(
        JSON.stringify({ error: "Cannot link with yourself" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check target user exists
    const { data: targetProfile, error: targetError } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name")
      .eq("id", targetUserId)
      .maybeSingle();

    if (targetError || !targetProfile) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check for existing active link between both users (check both directions)
    const { data: existingLinks, error: linkCheckError } = await supabaseAdmin
      .from("friend_links")
      .select("id, status, link_status")
      .or(
        `and(requester_id.eq.${requesterId},target_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},target_id.eq.${requesterId})`
      )
      .in("status", ["pending", "accepted"]);

    if (linkCheckError) {
      console.error("Link check error:", linkCheckError);
      return new Response(
        JSON.stringify({ error: "Failed to create link request" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (existingLinks && existingLinks.length > 0) {
      // Check if this is a re-initiation after link consent was declined
      const declinedLink = existingLinks.find(
        (l: any) => l.status === "accepted" && l.link_status === "declined"
      );

      if (declinedLink) {
        // Re-initiate: reset consent flow on the existing link
        const { error: resetError } = await supabaseAdmin
          .from("friend_links")
          .update({
            link_status: "pending_consent",
            requester_link_consent: false,
            target_link_consent: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", declinedLink.id);

        if (resetError) {
          console.error("Re-initiation reset error:", resetError);
          return new Response(
            JSON.stringify({ error: "Failed to re-initiate link consent" }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Send consent notifications to both users
        try {
          const requesterDisplayName = (await supabaseAdmin
            .from("profiles")
            .select("display_name, username")
            .eq("id", requesterId)
            .single()).data;

          const requesterName = requesterDisplayName?.display_name || requesterDisplayName?.username || "Your friend";
          const targetName = targetProfile.display_name || "Your friend";

          sendPush({
            targetUserId: requesterId,
            title: "Link profiles?",
            body: `Want to link profiles and share details with ${targetName}?`,
            data: {
              type: "link_consent_request",
              linkId: declinedLink.id,
              friendName: targetName,
              friendUserId: targetUserId,
            },
          }).catch((err) => console.warn('[send-friend-link] Push failed:', err));

          sendPush({
            targetUserId: targetUserId,
            title: "Link profiles?",
            body: `${requesterName} wants to link profiles and share details with you.`,
            data: {
              type: "link_consent_request",
              linkId: declinedLink.id,
              friendName: requesterName,
              friendUserId: requesterId,
            },
          }).catch((err) => console.warn('[send-friend-link] Push failed:', err));
        } catch (pushErr) {
          console.error("Re-initiation push error:", pushErr);
        }

        return new Response(
          JSON.stringify({
            linkId: declinedLink.id,
            status: "accepted",
            linkStatus: "pending_consent",
            reInitiated: true,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Not a re-initiation — link already exists
      return new Response(
        JSON.stringify({ error: "A link already exists between these users" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Insert friend_links row
    const { data: newLink, error: insertError } = await supabase
      .from("friend_links")
      .insert({
        requester_id: requesterId,
        target_id: targetUserId,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !newLink) {
      console.error("Insert friend_links error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create link request" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const linkId = newLink.id;

    // ── If personId provided, link it to this friend_link ─────────────────
    if (personId && UUID_REGEX.test(personId)) {
      await supabase
        .from("friend_links")
        .update({ requester_person_id: personId })
        .eq("id", linkId);
    }

    // ── Referral compatibility: also create a friend_requests mirror row ──
    // The referral credit triggers fire on friend_requests status changes.
    // Use upsert to handle re-sends (previous declined/cancelled request resets to pending).
    try {
      const { error: mirrorError } = await supabaseAdmin
        .from("friend_requests")
        .upsert(
          {
            sender_id: requesterId,
            receiver_id: targetUserId,
            status: "pending",
          },
          { onConflict: "sender_id,receiver_id" }
        );
      if (mirrorError) {
        console.warn("Mirror friend_request upsert failed:", mirrorError.message);
      }
    } catch (e) {
      // Non-fatal: referral tracking is nice-to-have, not critical
      console.warn("Failed to create mirror friend_request:", e);
    }

    // Look up requester's display_name and avatar
    const { data: requesterProfile } = await supabaseAdmin
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", requesterId)
      .single();

    const requesterDisplayName = requesterProfile?.display_name || "Someone";

    // Send push notification to target (fire-and-forget, never fail the request)
    try {
      sendPush({
        targetUserId: targetUserId,
        title: `${requesterDisplayName} wants to connect`,
        body: "Tap to accept and start planning together.",
        data: {
          type: "friend_link_request",
          linkId,
          requesterId,
          requesterName: requesterDisplayName,
          requesterAvatarUrl: requesterProfile?.avatar_url || null,
        },
      }).catch((err) => console.warn('[send-friend-link] Push failed:', err));
      console.log("Push notification sent to target:", targetUserId);
    } catch (pushError) {
      console.error("Push notification error:", pushError);
    }

    return new Response(
      JSON.stringify({ linkId, status: "pending" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("send-friend-link error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
