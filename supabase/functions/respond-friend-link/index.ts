import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { linkId, action } = await req.json();

    // Validate linkId
    if (!linkId || typeof linkId !== "string" || !UUID_REGEX.test(linkId)) {
      return new Response(
        JSON.stringify({ error: "Invalid link ID" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate action
    if (action !== "accept" && action !== "decline") {
      return new Response(
        JSON.stringify({ error: "Action must be 'accept' or 'decline'" }),
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

    const currentUserId = user.id;

    // Service-role client for all DB operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch the link — must be pending
    const { data: link, error: linkError } = await supabaseAdmin
      .from("friend_links")
      .select("id, requester_id, target_id, status")
      .eq("id", linkId)
      .maybeSingle();

    if (linkError || !link || link.status !== "pending") {
      return new Response(
        JSON.stringify({ error: "Link request not found or already responded" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Current user must be the target
    if (link.target_id !== currentUserId) {
      return new Response(
        JSON.stringify({ error: "Not authorized to respond to this link" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── DECLINE ──────────────────────────────────────────────────────────────
    if (action === "decline") {
      const { error: declineError } = await supabaseAdmin
        .from("friend_links")
        .update({
          status: "declined",
          updated_at: new Date().toISOString(),
        })
        .eq("id", linkId);

      if (declineError) {
        console.error("Decline update error:", declineError);
        return new Response(
          JSON.stringify({ error: "Failed to process link response" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Fire-and-forget: notify requester that the link was declined
      try {
        const { data: targetProf } = await supabaseAdmin
          .from("profiles")
          .select("display_name, username")
          .eq("id", currentUserId)
          .single();

        const targetName = targetProf?.display_name || targetProf?.username || "Someone";

        const { data: requesterTokenRow } = await supabaseAdmin
          .from("user_push_tokens")
          .select("push_token")
          .eq("user_id", link.requester_id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (requesterTokenRow?.push_token) {
          fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: requesterTokenRow.push_token,
              sound: "default",
              title: "Connection update",
              body: `${targetName} isn't available to connect right now.`,
              data: {
                type: "friend_link_declined",
                linkId,
                declinedByName: targetName,
                declinedByUserId: currentUserId,
              },
            }),
          }).catch(() => {});
          console.log("Decline push sent to requester:", link.requester_id);
        }
      } catch (pushErr) {
        console.error("Decline push notification error:", pushErr);
        // Never fail the decline
      }

      return new Response(
        JSON.stringify({ status: "declined" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── ACCEPT ───────────────────────────────────────────────────────────────

    const requesterId = link.requester_id;
    const targetId = link.target_id;

    // Fetch both profiles (needed for consent notifications)
    const { data: requesterProfile, error: reqProfileError } = await supabaseAdmin
      .from("profiles")
      .select("display_name, username, avatar_url")
      .eq("id", requesterId)
      .single();

    if (reqProfileError || !requesterProfile) {
      console.error("Requester profile fetch error:", reqProfileError);
      return new Response(
        JSON.stringify({ error: "Accept failed: requester profile not found", detail: reqProfileError?.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: targetProfile, error: tgtProfileError } = await supabaseAdmin
      .from("profiles")
      .select("display_name, username, avatar_url")
      .eq("id", targetId)
      .single();

    if (tgtProfileError || !targetProfile) {
      console.error("Target profile fetch error:", tgtProfileError);
      return new Response(
        JSON.stringify({ error: "Accept failed: target profile not found", detail: tgtProfileError?.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const requesterDisplayName = requesterProfile.display_name || requesterProfile.username || "Your friend";
    const targetDisplayName = targetProfile.display_name || targetProfile.username || "Your friend";

    // Update friend_links: accepted status + pending consent
    const { error: acceptError } = await supabaseAdmin
      .from("friend_links")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        link_status: "pending_consent",
        requester_link_consent: false,
        target_link_consent: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", linkId);

    if (acceptError) {
      console.error("Accept update error:", acceptError);
      return new Response(
        JSON.stringify({ error: "Accept failed: friend_links status update", detail: acceptError?.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Create friends table rows (so accepted user appears in chat section) ──
    // Guard: skip if either user has blocked the other
    const { count: blockCount } = await supabaseAdmin
      .from("blocked_users")
      .select("id", { count: "exact", head: true })
      .or(
        `and(blocker_id.eq.${requesterId},blocked_id.eq.${targetId}),and(blocker_id.eq.${targetId},blocked_id.eq.${requesterId})`
      );

    if (!blockCount || blockCount === 0) {
      // Insert row: requester → target
      const { error: friend1Error } = await supabaseAdmin
        .from("friends")
        .upsert(
          {
            user_id: requesterId,
            friend_user_id: targetId,
            status: "accepted",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,friend_user_id" }
        );

      if (friend1Error) {
        console.warn("Failed to create friends row (requester→target):", friend1Error.message);
      }

      // Insert row: target → requester
      const { error: friend2Error } = await supabaseAdmin
        .from("friends")
        .upsert(
          {
            user_id: targetId,
            friend_user_id: requesterId,
            status: "accepted",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,friend_user_id" }
        );

      if (friend2Error) {
        console.warn("Failed to create friends row (target→requester):", friend2Error.message);
      }
    } else {
      console.warn("Skipping friends creation — block exists between", requesterId, "and", targetId);
    }

    // ── Mirror accept to legacy friend_requests for referral credit triggers ──
    try {
      const { error: mirrorError } = await supabaseAdmin
        .from("friend_requests")
        .update({ status: "accepted" })
        .eq("sender_id", requesterId)
        .eq("receiver_id", targetId)
        .eq("status", "pending");
      if (mirrorError) {
        console.warn("Mirror friend_requests accept failed:", mirrorError.message);
      }
    } catch (e) {
      console.warn("Failed to mirror accept to friend_requests:", e);
    }

    // ── Send consent notification to BOTH users (replaces old acceptance notification) ──
    try {
      // Notification to requester
      const { data: requesterTokenData } = await supabaseAdmin
        .from("user_push_tokens")
        .select("push_token")
        .eq("user_id", requesterId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (requesterTokenData?.push_token) {
        fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: requesterTokenData.push_token,
            sound: "default",
            title: `You and ${targetDisplayName} are now friends!`,
            body: "Want to link profiles and share your details with each other?",
            data: {
              type: "link_consent_request",
              linkId: linkId,
              friendName: targetDisplayName,
              friendUserId: targetId,
              friendAvatarUrl: targetProfile?.avatar_url || null,
            },
          }),
        }).catch(() => {});
        console.log("Consent push sent to requester:", requesterId);
      }

      // Notification to target (the one who just accepted)
      const { data: targetTokenData } = await supabaseAdmin
        .from("user_push_tokens")
        .select("push_token")
        .eq("user_id", targetId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (targetTokenData?.push_token) {
        fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: targetTokenData.push_token,
            sound: "default",
            title: `You and ${requesterDisplayName} are now friends!`,
            body: "Want to link profiles and share your details with each other?",
            data: {
              type: "link_consent_request",
              linkId: linkId,
              friendName: requesterDisplayName,
              friendUserId: requesterId,
              friendAvatarUrl: requesterProfile?.avatar_url || null,
            },
          }),
        }).catch(() => {});
        console.log("Consent push sent to target:", targetId);
      }
    } catch (pushError) {
      console.error("Push notification error:", pushError);
      // Don't fail the request
    }

    return new Response(
      JSON.stringify({
        status: "accepted",
        linkId: linkId,
        linkStatus: "pending_consent",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("respond-friend-link error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
