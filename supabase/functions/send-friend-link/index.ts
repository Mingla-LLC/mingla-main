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
    const { targetUserId, personId } = await req.json();

    // Validate targetUserId
    if (!targetUserId || typeof targetUserId !== "string" || !UUID_REGEX.test(targetUserId)) {
      return new Response(
        JSON.stringify({ error: "Invalid target user ID" }),
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

    // Service-role client for privileged operations (push notifications, cross-user reads)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
    const { data: existingLinks, error: linkCheckError } = await supabase
      .from("friend_links")
      .select("id, status")
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

    // Look up requester's display_name
    const { data: requesterProfile } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", requesterId)
      .single();

    const requesterDisplayName = requesterProfile?.display_name || "Someone";

    // Send push notification to target (fire-and-forget, never fail the request)
    try {
      // Read push token from user_push_tokens table (where the app stores it)
      const { data: tokenRow } = await supabaseAdmin
        .from("user_push_tokens")
        .select("push_token")
        .eq("user_id", targetUserId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (tokenRow?.push_token) {
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: tokenRow.push_token,
            sound: "default",
            title: `${requesterDisplayName} wants to connect`,
            body: "Tap to accept and start planning together.",
            data: {
              type: "friend_link_request",
              linkId,
              requesterId,
            },
          }),
        });
        console.log("Push notification sent to target:", targetUserId);
      } else {
        console.log("No push token for target:", targetUserId);
      }
    } catch (pushError) {
      console.error("Push notification error:", pushError);
      // Don't fail the request
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
