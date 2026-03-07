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

// ── Generate initials from display name ──────────────────────────────────────
function generateInitials(displayName: string): string {
  if (!displayName) return "??";
  const words = displayName.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

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

    // Service-role client for all DB operations (cross-user inserts into saved_people)
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

    // Fetch requester profile
    const { data: requesterProfile, error: reqProfileError } = await supabaseAdmin
      .from("profiles")
      .select("display_name, username, birthday, gender, avatar_url, expo_push_token")
      .eq("id", requesterId)
      .single();

    if (reqProfileError || !requesterProfile) {
      console.error("Requester profile fetch error:", reqProfileError);
      return new Response(
        JSON.stringify({ error: "Failed to process link response" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch target profile
    const { data: targetProfile, error: tgtProfileError } = await supabaseAdmin
      .from("profiles")
      .select("display_name, username, birthday, gender, avatar_url")
      .eq("id", targetId)
      .single();

    if (tgtProfileError || !targetProfile) {
      console.error("Target profile fetch error:", tgtProfileError);
      return new Response(
        JSON.stringify({ error: "Failed to process link response" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Generate initials
    const requesterInitials = generateInitials(requesterProfile.display_name || requesterProfile.username || "");
    const targetInitials = generateInitials(targetProfile.display_name || targetProfile.username || "");

    // ── Create/update saved_people entry for requester on TARGET's side ──
    // Check if target already has a saved_people entry for this linked_user
    const { data: existingTargetPerson } = await supabaseAdmin
      .from("saved_people")
      .select("id")
      .eq("user_id", targetId)
      .eq("linked_user_id", requesterId)
      .maybeSingle();

    let targetPersonId: string;
    if (existingTargetPerson) {
      // Update existing entry to mark as linked
      await supabaseAdmin
        .from("saved_people")
        .update({
          is_linked: true,
          link_id: linkId,
          name: requesterProfile.display_name || requesterProfile.username || "Linked Friend",
          initials: requesterInitials,
          birthday: requesterProfile.birthday || null,
          gender: requesterProfile.gender || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingTargetPerson.id);
      targetPersonId = existingTargetPerson.id;
    } else {
      const { data: targetPersonEntry, error: targetPersonError } = await supabaseAdmin
        .from("saved_people")
        .insert({
          user_id: targetId,
          name: requesterProfile.display_name || requesterProfile.username || "Linked Friend",
          initials: requesterInitials,
          birthday: requesterProfile.birthday || null,
          gender: requesterProfile.gender || null,
          is_linked: true,
          linked_user_id: requesterId,
          link_id: linkId,
        })
        .select("id")
        .single();

      if (targetPersonError || !targetPersonEntry) {
        console.error("Target saved_people insert error:", targetPersonError);
        return new Response(
          JSON.stringify({ error: "Failed to process link response" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      targetPersonId = targetPersonEntry.id;
    }

    // ── Create/update saved_people entry for target on REQUESTER's side ──
    const { data: existingRequesterPerson } = await supabaseAdmin
      .from("saved_people")
      .select("id")
      .eq("user_id", requesterId)
      .eq("linked_user_id", targetId)
      .maybeSingle();

    let requesterPersonId: string;
    if (existingRequesterPerson) {
      // Update existing entry to mark as linked
      await supabaseAdmin
        .from("saved_people")
        .update({
          is_linked: true,
          link_id: linkId,
          name: targetProfile.display_name || targetProfile.username || "Linked Friend",
          initials: targetInitials,
          birthday: targetProfile.birthday || null,
          gender: targetProfile.gender || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingRequesterPerson.id);
      requesterPersonId = existingRequesterPerson.id;
    } else {
      const { data: requesterPersonEntry, error: requesterPersonError } = await supabaseAdmin
        .from("saved_people")
        .insert({
          user_id: requesterId,
          name: targetProfile.display_name || targetProfile.username || "Linked Friend",
          initials: targetInitials,
          birthday: targetProfile.birthday || null,
          gender: targetProfile.gender || null,
          is_linked: true,
          linked_user_id: targetId,
          link_id: linkId,
        })
        .select("id")
        .single();

      if (requesterPersonError || !requesterPersonEntry) {
        console.error("Requester saved_people insert error:", requesterPersonError);
        return new Response(
          JSON.stringify({ error: "Failed to process link response" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      requesterPersonId = requesterPersonEntry.id;
    }

    // Update friend_links with accepted status and person IDs
    const { error: acceptError } = await supabaseAdmin
      .from("friend_links")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        requester_person_id: requesterPersonId,
        target_person_id: targetPersonId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", linkId);

    if (acceptError) {
      console.error("Accept update error:", acceptError);
      return new Response(
        JSON.stringify({ error: "Failed to process link response" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Mirror accept to legacy friend_requests for referral credit triggers ──
    try {
      await supabaseAdmin
        .from("friend_requests")
        .update({ status: "accepted" })
        .eq("sender_id", requesterId)
        .eq("receiver_id", targetId)
        .eq("status", "pending");
    } catch (e) {
      console.warn("Failed to mirror accept to friend_requests:", e);
    }

    // Send push notification to requester (fire-and-forget)
    try {
      if (requesterProfile.expo_push_token) {
        const targetDisplayName = targetProfile.display_name || targetProfile.username || "Your friend";
        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: requesterProfile.expo_push_token,
            sound: "default",
            title: `You're connected with ${targetDisplayName}!`,
            body: "Check out their picks in For You.",
            data: {
              type: "friend_link_accepted",
              linkId,
            },
          }),
        });
        console.log("Push notification sent to requester:", requesterId);
      } else {
        console.log("No push token for requester:", requesterId);
      }
    } catch (pushError) {
      console.error("Push notification error:", pushError);
      // Don't fail the request
    }

    return new Response(
      JSON.stringify({
        status: "accepted",
        personId: targetPersonId,
        linkedPersonId: requesterPersonId,
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
