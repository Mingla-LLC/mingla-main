import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TRAVEL_MODE_RANK: Record<string, number> = {
  driving: 4,
  transit: 3,
  biking: 2,
  bicycling: 2,
  walking: 1,
};

function mostPermissiveTravelMode(a: string | null, b: string | null): string {
  const rankA = TRAVEL_MODE_RANK[a ?? "walking"] ?? 1;
  const rankB = TRAVEL_MODE_RANK[b ?? "walking"] ?? 1;
  if (rankA >= rankB) return a ?? "walking";
  return b ?? "walking";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Extract receiver_id from JWT
    const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: jwtUser }, error: authError } = await supabaseAuth.auth.getUser();

    if (authError || !jwtUser) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const receiverId = jwtUser.id;
    const { request_id: requestId } = await req.json();

    if (!requestId || typeof requestId !== "string") {
      return new Response(
        JSON.stringify({ error: "request_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Step 1: Read and validate the request ──
    const { data: tagRequest, error: reqError } = await supabase
      .from("tag_along_requests")
      .select("*")
      .eq("id", requestId)
      .single();

    if (reqError || !tagRequest) {
      return new Response(
        JSON.stringify({ error: "request_not_found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (tagRequest.receiver_id !== receiverId) {
      return new Response(
        JSON.stringify({ error: "not_receiver" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (tagRequest.status !== "pending") {
      return new Response(
        JSON.stringify({ error: "request_not_pending" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (new Date(tagRequest.expires_at) < new Date()) {
      // Auto-expire it
      await supabase
        .from("tag_along_requests")
        .update({ status: "expired" })
        .eq("id", requestId);
      return new Response(
        JSON.stringify({ error: "request_expired" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const senderId = tagRequest.sender_id;

    // ── Step 2: Verify receiver has seats ──
    const { data: receiverPresence } = await supabase
      .from("leaderboard_presence")
      .select("available_seats, active_collab_session_id")
      .eq("user_id", receiverId)
      .single();

    if (!receiverPresence || receiverPresence.available_seats <= 0) {
      return new Response(
        JSON.stringify({ error: "no_seats_available" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Step 3: Friendship — create if not already friends ──
    const { data: existingFriend } = await supabase
      .from("friends")
      .select("id")
      .eq("status", "accepted")
      .is("deleted_at", null)
      .or(`and(user_id.eq.${receiverId},friend_user_id.eq.${senderId}),and(user_id.eq.${senderId},friend_user_id.eq.${receiverId})`)
      .maybeSingle();

    let friendshipCreated = false;
    if (!existingFriend) {
      // Create friendship (single directional row — the service queries both directions)
      const { error: friendError } = await supabase
        .from("friends")
        .insert({
          user_id: receiverId,
          friend_user_id: senderId,
          status: "accepted",
        });

      if (friendError && friendError.code !== "23505") {
        console.error("[accept-tag-along] Friend insert failed:", friendError);
        return new Response(
          JSON.stringify({ error: "Failed to create friendship", details: friendError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      friendshipCreated = true;
    }

    // ── Step 4: Read both users' preferences ──
    const [receiverPrefsResult, senderPrefsResult] = await Promise.all([
      supabase.from("preferences").select("*").eq("profile_id", receiverId).maybeSingle(),
      supabase.from("preferences").select("*").eq("profile_id", senderId).maybeSingle(),
    ]);

    const receiverPrefs = receiverPrefsResult.data;
    const senderPrefs = senderPrefsResult.data;

    // Merge categories (union, deduplicated)
    const receiverCats: string[] = receiverPrefs?.categories ?? [];
    const senderCats: string[] = senderPrefs?.categories ?? [];
    const mergedCategories = [...new Set([...receiverCats, ...senderCats])];

    // Merge travel mode (most permissive)
    const mergedTravelMode = mostPermissiveTravelMode(
      receiverPrefs?.travel_mode,
      senderPrefs?.travel_mode
    );

    // Travel constraint = MAX of both
    const mergedTravelConstraint = Math.max(
      receiverPrefs?.travel_constraint_value ?? 30,
      senderPrefs?.travel_constraint_value ?? 30
    );

    // Get display names for session naming
    const [receiverProfileResult, senderProfileResult] = await Promise.all([
      supabase.from("profiles").select("display_name, first_name, avatar_url").eq("id", receiverId).single(),
      supabase.from("profiles").select("display_name, first_name, avatar_url").eq("id", senderId).single(),
    ]);

    const receiverName = receiverProfileResult.data?.display_name || receiverProfileResult.data?.first_name || "User";
    const senderName = senderProfileResult.data?.display_name || senderProfileResult.data?.first_name || "User";

    let collabSessionId: string;
    let sessionName: string;

    // ── Step 5: Create or join collab session ──
    if (receiverPresence.active_collab_session_id) {
      // JOIN EXISTING SESSION — add sender as participant, re-merge categories
      collabSessionId = receiverPresence.active_collab_session_id;

      // Get existing session info
      const { data: existingSession } = await supabase
        .from("collaboration_sessions")
        .select("name, board_id")
        .eq("id", collabSessionId)
        .single();

      sessionName = existingSession?.name
        ? `${existingSession.name} & ${senderName}`
        : `${receiverName} & ${senderName}`;

      // Add sender as participant
      await supabase
        .from("session_participants")
        .upsert({
          session_id: collabSessionId,
          user_id: senderId,
          has_accepted: true,
          joined_at: new Date().toISOString(),
          role: "member",
        }, { onConflict: "session_id,user_id" });

      // Re-merge categories into board_session_preferences
      const { data: existingBsp } = await supabase
        .from("board_session_preferences")
        .select("categories")
        .eq("session_id", collabSessionId)
        .maybeSingle();

      const existingCats: string[] = existingBsp?.categories ?? [];
      const reMerged = [...new Set([...existingCats, ...senderCats])];

      await supabase
        .from("board_session_preferences")
        .update({ categories: reMerged, updated_at: new Date().toISOString() })
        .eq("session_id", collabSessionId);

      // Update session name
      await supabase
        .from("collaboration_sessions")
        .update({ name: sessionName, updated_at: new Date().toISOString() })
        .eq("id", collabSessionId);

      // Add to board_collaborators if board exists
      if (existingSession?.board_id) {
        await supabase
          .from("board_collaborators")
          .upsert({
            board_id: existingSession.board_id,
            user_id: senderId,
            role: "collaborator",
          }, { onConflict: "board_id,user_id" });
      }
    } else {
      // CREATE NEW SESSION
      sessionName = `${receiverName} & ${senderName}`;

      // Insert collaboration_sessions (trigger auto-generates invite_code and invite_link)
      const { data: newSession, error: sessionError } = await supabase
        .from("collaboration_sessions")
        .insert({
          name: sessionName,
          created_by: receiverId,
          status: "active",
          session_type: "group_hangout",
        })
        .select("id")
        .single();

      if (sessionError || !newSession) {
        console.error("[accept-tag-along] Session creation failed:", sessionError);
        return new Response(
          JSON.stringify({ error: "Failed to create session", details: sessionError?.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      collabSessionId = newSession.id;

      // Add both as participants
      await supabase
        .from("session_participants")
        .insert([
          { session_id: collabSessionId, user_id: receiverId, has_accepted: true, joined_at: new Date().toISOString(), role: "member", is_admin: true },
          { session_id: collabSessionId, user_id: senderId, has_accepted: true, joined_at: new Date().toISOString(), role: "member" },
        ]);

      // Create board for the session
      const { data: newBoard, error: boardError } = await supabase
        .from("boards")
        .insert({
          name: sessionName,
          created_by: receiverId,
        })
        .select("id")
        .single();

      if (!boardError && newBoard) {
        // Link board to session
        await supabase
          .from("collaboration_sessions")
          .update({ board_id: newBoard.id, updated_at: new Date().toISOString() })
          .eq("id", collabSessionId);

        // Add both as board collaborators
        await supabase
          .from("board_collaborators")
          .insert([
            { board_id: newBoard.id, user_id: receiverId, role: "admin" },
            { board_id: newBoard.id, user_id: senderId, role: "collaborator" },
          ]);
      }

      // Create board_session_preferences with merged values
      await supabase
        .from("board_session_preferences")
        .insert({
          session_id: collabSessionId,
          user_id: receiverId,
          categories: mergedCategories,
          travel_mode: mergedTravelMode,
          travel_constraint_type: receiverPrefs?.travel_constraint_type ?? "time",
          travel_constraint_value: mergedTravelConstraint,
          location: receiverPrefs?.location ?? null,
          custom_lat: receiverPrefs?.custom_lat ?? null,
          custom_lng: receiverPrefs?.custom_lng ?? null,
          use_gps_location: receiverPrefs?.use_gps_location ?? true,
        });
    }

    // ── Step 6: Update leaderboard presence (decrement seats) ──
    const newSeats = receiverPresence.available_seats - 1;
    await supabase
      .from("leaderboard_presence")
      .update({
        available_seats: newSeats,
        active_collab_session_id: collabSessionId,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", receiverId);

    // ── Step 7: Update the tag-along request ──
    await supabase
      .from("tag_along_requests")
      .update({
        status: "accepted",
        responded_at: new Date().toISOString(),
        collab_session_id: collabSessionId,
      })
      .eq("id", requestId);

    // ── Step 8: Send push notifications to both ──
    const notifyUrl = `${SUPABASE_URL}/functions/v1/notify-dispatch`;
    const pushData = {
      sessionId: collabSessionId,
      sessionName: sessionName,
      type: "tag_along_accepted",
    };

    // Notify sender (their interest was accepted)
    try {
      await fetch(notifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          userId: senderId,
          type: "tag_along_accepted",
          title: `${receiverName} accepted your tag along!`,
          body: "Let's explore together. Tap to open your session.",
          data: {
            deepLink: `mingla://session?id=${collabSessionId}`,
            ...pushData,
            receiverName: receiverName,
            receiverAvatarUrl: receiverProfileResult.data?.avatar_url || null,
          },
          actorId: receiverId,
          relatedId: collabSessionId,
          relatedType: "tag_along_accept",
          idempotencyKey: `tag_along_accepted:${requestId}:${senderId}`,
        }),
      });
    } catch (pushErr: unknown) {
      console.warn("[accept-tag-along] Push to sender failed:", pushErr);
    }

    // Notify receiver (confirmation + match celebration trigger)
    try {
      await fetch(notifyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          userId: receiverId,
          type: "tag_along_match",
          title: "It's a match!",
          body: `You and ${senderName} are exploring together.`,
          data: {
            deepLink: `mingla://session?id=${collabSessionId}`,
            ...pushData,
            senderName: senderName,
            senderAvatarUrl: senderProfileResult.data?.avatar_url || null,
          },
          actorId: senderId,
          relatedId: collabSessionId,
          relatedType: "tag_along_match",
          idempotencyKey: `tag_along_match:${requestId}:${receiverId}`,
        }),
      });
    } catch (pushErr: unknown) {
      console.warn("[accept-tag-along] Push to receiver failed:", pushErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        collab_session_id: collabSessionId,
        session_name: sessionName,
        friendship_created: friendshipCreated,
        merged_categories: mergedCategories,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[accept-tag-along] Unhandled error:", message);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
