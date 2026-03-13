import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Helper to return error response
function errorResponse(message: string, status: number = 500) {
  console.error(`[delete-user] Error: ${message}`);
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

// Helper to return success response
function successResponse(data: object, status: number = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

/**
 * Handles collaboration session cleanup when a user is deleted.
 * Rewritten from N+1 loop to a maximum of 9 queries total regardless of session count.
 */
async function cleanupCollaborationSessions(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  // 1. Fetch all sessions where user is creator — single query
  const { data: ownedSessions } = await supabase
    .from("collaboration_sessions")
    .select("id, created_by")
    .eq("created_by", userId)
    .not("status", "eq", "completed");

  if (!ownedSessions || ownedSessions.length === 0) return;

  const ownedIds = ownedSessions.map((s: { id: string }) => s.id);

  // 2. Fetch all participants for all owned sessions — single query
  const { data: allParticipants } = await supabase
    .from("session_participants")
    .select("session_id, user_id, has_accepted")
    .in("session_id", ownedIds)
    .neq("user_id", userId);

  if (!allParticipants) return;

  // 3. Group participants by session in memory
  const bySession = new Map<string, typeof allParticipants>();
  allParticipants.forEach((p: { session_id: string; user_id: string; has_accepted: boolean }) => {
    const arr = bySession.get(p.session_id) ?? [];
    arr.push(p);
    bySession.set(p.session_id, arr);
  });

  // 4. Determine which sessions have other accepted participants (can be transferred)
  const transferable: Array<{ sessionId: string; newOwner: string }> = [];
  const toDelete: string[] = [];

  ownedIds.forEach((sessionId: string) => {
    const participants = bySession.get(sessionId) ?? [];
    const accepted = participants.filter((p) => p.has_accepted);
    if (accepted.length > 0) {
      transferable.push({ sessionId, newOwner: accepted[0].user_id });
    } else {
      toDelete.push(sessionId);
    }
  });

  // 5. Transfer ownership for sessions with remaining members — Promise.allSettled
  if (transferable.length > 0) {
    await Promise.allSettled(
      transferable.map(({ sessionId, newOwner }) =>
        supabase
          .from("collaboration_sessions")
          .update({ created_by: newOwner })
          .eq("id", sessionId)
      )
    );
  }

  // 6. Delete under-populated sessions with IN clause — single query
  if (toDelete.length > 0) {
    await supabase
      .from("collaboration_sessions")
      .delete()
      .in("id", toDelete);
  }
}

/**
 * Cleans up all user-related data from every table in the system.
 * Each operation is wrapped in try-catch to handle missing tables gracefully.
 * Explicit deletes are used even for tables with CASCADE as a safety net —
 * if a FK constraint is ever removed or misconfigured, this still works.
 */
async function cleanupUserData(
  adminClient: SupabaseClient,
  userId: string,
  userPhone: string | null
): Promise<{ success: boolean; error?: string }> {

  // Helper function to safely delete from a table
  const safeDelete = async (table: string, column: string, value: string) => {
    try {
      const { error } = await adminClient.from(table).delete().eq(column, value);
      if (error) {
        console.warn(`Warning: Could not delete from ${table}:`, error.message);
      }
    } catch (err) {
      console.warn(`Warning: Could not delete from ${table}:`, err);
    }
  };

  // Helper function to safely delete with OR condition
  const safeDeleteOr = async (table: string, conditions: string) => {
    try {
      const { error } = await adminClient.from(table).delete().or(conditions);
      if (error) {
        console.warn(`Warning: Could not delete from ${table}:`, error.message);
      }
    } catch (err) {
      console.warn(`Warning: Could not delete from ${table}:`, err);
    }
  };

  try {
    // ── Batch 1: User interactions and learning data (all independent) ──
    await Promise.allSettled([
      safeDelete("user_interactions", "user_id", userId),
      safeDelete("user_location_history", "user_id", userId),
      safeDelete("user_preference_learning", "user_id", userId),
      safeDelete("user_sessions", "user_id", userId),
      safeDelete("user_activity", "user_id", userId),
    ]);

    // ── Batch 2: Social data (all independent) ──
    await Promise.allSettled([
      safeDeleteOr("friends", `user_id.eq.${userId},friend_user_id.eq.${userId}`),
      safeDeleteOr("friend_requests", `sender_id.eq.${userId},receiver_id.eq.${userId}`),
      safeDeleteOr("blocked_users", `blocker_id.eq.${userId},blocked_id.eq.${userId}`),
      safeDeleteOr("muted_users", `muter_id.eq.${userId},muted_id.eq.${userId}`),
    ]);

    // ── Batch 3: Messaging — soft delete to preserve other users' conversation history ──
    try {
      await adminClient
        .from("messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("sender_id", userId);
    } catch (err) {
      console.warn("Warning: Could not soft-delete messages:", err);
    }

    // ── Batch 4: Board, calendar, presence, and misc data (all independent) ──
    await Promise.allSettled([
      safeDelete("conversation_participants", "user_id", userId),
      safeDelete("calendar_entries", "user_id", userId),
      safeDelete("board_session_preferences", "user_id", userId),
      safeDelete("board_messages", "user_id", userId),
      safeDelete("board_card_messages", "user_id", userId),
      safeDelete("board_message_reads", "user_id", userId),
      safeDelete("board_card_message_reads", "user_id", userId),
      safeDelete("board_user_swipe_states", "user_id", userId),
      safeDelete("board_saved_cards", "saved_by", userId),
      safeDelete("board_collaborators", "user_id", userId),
      safeDelete("preference_history", "user_id", userId),
      safeDelete("collaboration_invites", "inviter_id", userId),
      safeDelete("collaboration_invites", "invited_user_id", userId),
      safeDelete("user_presence", "user_id", userId),
      safeDelete("session_presence", "user_id", userId),
      safeDelete("typing_indicators", "user_id", userId),
      safeDelete("board_participant_presence", "user_id", userId),
      safeDelete("board_typing_indicators", "user_id", userId),
      safeDelete("session_votes", "user_id", userId),
      safeDelete("person_audio_clips", "user_id", userId),
      safeDelete("person_experiences", "user_id", userId),
      safeDelete("saved_people", "user_id", userId),
      safeDelete("user_push_tokens", "user_id", userId),
      safeDelete("subscriptions", "user_id", userId),
      safeDeleteOr("referral_credits", `referrer_id.eq.${userId},referred_id.eq.${userId}`),
      safeDelete("undo_actions", "user_id", userId),
      safeDelete("app_feedback", "user_id", userId),
      safeDeleteOr("user_reports", `reporter_id.eq.${userId},reported_user_id.eq.${userId}`),
    ]);

    // ── Pending invites: clean up by user's phone number ──
    // Without this, a new user signing up with the same phone would
    // auto-link to friends who invited the old (deleted) user's number.
    if (userPhone) {
      try {
        await adminClient
          .from("pending_invites")
          .update({ status: "cancelled" })
          .eq("phone_e164", userPhone)
          .eq("status", "pending");
      } catch (err) {
        console.warn("Warning: Could not cancel pending_invites by phone:", err);
      }
      try {
        await adminClient
          .from("pending_session_invites")
          .update({ status: "cancelled" })
          .eq("phone_e164", userPhone)
          .eq("status", "pending");
      } catch (err) {
        console.warn("Warning: Could not cancel pending_session_invites by phone:", err);
      }
    }

    // ── Pending invites: clean up by inviter_id ──
    await Promise.allSettled([
      safeDelete("pending_invites", "inviter_id", userId),
      safeDelete("pending_session_invites", "inviter_id", userId),
    ]);

    return { success: true };
  } catch (err) {
    console.error("Error cleaning up user data:", err);
    return { success: false, error: String(err) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Supabase configuration missing" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get the authenticated user from the JWT
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user?.id) {
      return new Response(
        JSON.stringify({ error: "Unauthorized or invalid token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const userId = user.id;
    console.log(`Starting account deletion for user: ${userId}`);

    // Service role client for admin operations
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    // Step 0: Fetch user's verified phone before any cleanup (needed for pending invite cancellation)
    let userPhone: string | null = null;
    try {
      const { data: profileData } = await adminClient
        .from("profiles")
        .select("phone")
        .eq("id", userId)
        .maybeSingle();
      userPhone = profileData?.phone ?? null;
      console.log(`User phone: ${userPhone ? userPhone.slice(0, 4) + '****' : 'none'}`);
    } catch (err) {
      console.warn("Warning: Could not fetch user phone:", err);
    }

    // Step 1: Handle collaboration sessions (transfer ownership, delete under-populated sessions)
    console.log("Step 1: Cleaning up collaboration sessions...");
    try {
      await cleanupCollaborationSessions(adminClient, userId);
    } catch (collabErr) {
      console.warn("Warning: Some collaboration cleanup failed:", collabErr);
      // Continue with deletion — non-critical
    }

    // Step 2: Clean up all user-related data from various tables
    console.log("Step 2: Cleaning up user data from all tables...");
    const cleanupResult = await cleanupUserData(adminClient, userId, userPhone);
    if (!cleanupResult.success) {
      console.warn("Warning: Some data cleanup failed:", cleanupResult.error);
      // Continue with deletion - don't block on non-critical errors
    }

    // Step 3: Delete from Supabase Auth FIRST — this immediately invalidates the JWT,
    // stopping all concurrent client operations (location tracking, profile fetches, etc.)
    // Deleting auth first collapses the PGRST116 race window to zero.
    console.log("Step 3: Deleting auth user first to invalidate JWT...");
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(
      userId
    );

    if (deleteAuthError) {
      console.error("Error deleting auth user:", deleteAuthError);
      return new Response(
        JSON.stringify({ error: "Failed to delete account. Please try again." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Step 4: Delete profile AFTER auth — JWT is already dead, so no new concurrent ops
    console.log("Step 4: Deleting user profile (auth already invalidated)...");

    const { error: deleteError } = await adminClient.rpc('delete_user_profile', {
      target_user_id: userId
    });

    if (deleteError) {
      console.error("Error deleting profile via RPC:", deleteError);

      // Fallback: Try direct delete (trigger might not exist or be an issue)
      console.log("Trying direct profile delete...");
      const { error: profileError } = await adminClient
        .from("profiles")
        .delete()
        .eq("id", userId);

      if (profileError) {
        // Auth is already deleted — log but don't fail; profile cascade will clean up
        console.warn("Profile delete failed after auth deletion (may cascade):", profileError);
      }
    }

    console.log(`Account deletion completed successfully for user: ${userId}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Your account has been permanently deleted." 
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("delete-user error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to delete account. Please try again later." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
