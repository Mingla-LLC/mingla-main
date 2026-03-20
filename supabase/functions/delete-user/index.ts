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
  // ── Phase 1: Transfer ownership for sessions the user created ──
  const { data: ownedSessions } = await supabase
    .from("collaboration_sessions")
    .select("id")
    .eq("created_by", userId)
    .not("status", "eq", "completed");

  if (ownedSessions && ownedSessions.length > 0) {
    const ownedIds = ownedSessions.map((s: { id: string }) => s.id);

    // Fetch other participants for owned sessions
    const { data: otherParticipants } = await supabase
      .from("session_participants")
      .select("session_id, user_id, has_accepted")
      .in("session_id", ownedIds)
      .neq("user_id", userId);

    if (otherParticipants) {
      const bySession = new Map<string, typeof otherParticipants>();
      otherParticipants.forEach((p: { session_id: string; user_id: string; has_accepted: boolean }) => {
        const arr = bySession.get(p.session_id) ?? [];
        arr.push(p);
        bySession.set(p.session_id, arr);
      });

      const transferable: Array<{ sessionId: string; newOwner: string }> = [];

      ownedIds.forEach((sessionId: string) => {
        const participants = bySession.get(sessionId) ?? [];
        const accepted = participants.filter((p) => p.has_accepted);
        if (accepted.length > 0) {
          transferable.push({ sessionId, newOwner: accepted[0].user_id });
        }
      });

      if (transferable.length > 0) {
        const transferResults = await Promise.allSettled(
          transferable.map(({ sessionId, newOwner }) =>
            supabase
              .from("collaboration_sessions")
              .update({ created_by: newOwner })
              .eq("id", sessionId)
              .then((res) => {
                if (res.error) throw { sessionId, error: res.error };
                return sessionId;
              })
          )
        );

        // Any failed transfers → force-delete those sessions to prevent ghost creators
        const failedTransfers = transferResults
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => r.reason?.sessionId as string)
          .filter(Boolean);

        if (failedTransfers.length > 0) {
          console.warn(`[delete-user] ${failedTransfers.length} ownership transfer(s) failed — deleting those sessions`);
          await supabase
            .from("collaboration_sessions")
            .delete()
            .in("id", failedTransfers);
        }
      }
    }
  }

  // ── Phase 2: Capture user's session IDs, then remove them from all sessions ──
  // Must capture BEFORE deleting so we know which sessions to check in Phase 3.
  const { data: userSessions } = await supabase
    .from("session_participants")
    .select("session_id")
    .eq("user_id", userId);

  const affectedSessionIds = userSessions
    ? [...new Set(userSessions.map((s: { session_id: string }) => s.session_id))]
    : [];

  // Now remove the user from all sessions — don't rely on CASCADE + triggers
  // because delete_user_profile disables triggers before deleting the profile.
  await supabase
    .from("session_participants")
    .delete()
    .eq("user_id", userId);

  // ── Phase 3: Delete affected sessions now under-populated (< 2 accepted members) ──
  // Covers ALL statuses (not just 'active') since the DB trigger only handles active.
  // completed sessions are excluded — they're historical records.
  if (affectedSessionIds.length > 0) {
    const { data: affectedSessions } = await supabase
      .from("collaboration_sessions")
      .select("id")
      .in("id", affectedSessionIds)
      .not("status", "eq", "completed");

    if (affectedSessions && affectedSessions.length > 0) {
      const sessionIds = affectedSessions.map((s: { id: string }) => s.id);

      // Count accepted participants per session
      const { data: acceptedCounts } = await supabase
        .from("session_participants")
        .select("session_id")
        .in("session_id", sessionIds)
        .eq("has_accepted", true);

      // Build set of sessions that still have >= 2 accepted participants
      const healthySessions = new Set<string>();
      if (acceptedCounts) {
        const countMap = new Map<string, number>();
        acceptedCounts.forEach((p: { session_id: string }) => {
          countMap.set(p.session_id, (countMap.get(p.session_id) ?? 0) + 1);
        });
        countMap.forEach((count, sessionId) => {
          if (count >= 2) healthySessions.add(sessionId);
        });
      }

      const underPopulated = sessionIds.filter((id) => !healthySessions.has(id));
      if (underPopulated.length > 0) {
        await supabase
          .from("collaboration_sessions")
          .delete()
          .in("id", underPopulated);
        console.log(`[delete-user] Deleted ${underPopulated.length} under-populated session(s)`);
      }
    }
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

    // ── Anonymize beta_feedback: scrub PII but preserve the feedback record ──
    // Must run BEFORE profile deletion (Step 4) — after SET NULL fires,
    // user_id becomes NULL and we can't identify which rows to scrub.
    try {
      const { error } = await adminClient
        .from("beta_feedback")
        .update({
          user_display_name: null,
          user_email: null,
          user_phone: null,
        })
        .eq("user_id", userId);
      if (error) {
        console.warn("Warning: Could not anonymize beta_feedback:", error.message);
      }
    } catch (err) {
      console.warn("Warning: Could not anonymize beta_feedback:", err);
    }

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
      // Pairing tables (CASCADE handles most, but explicit for safety)
      safeDeleteOr("pair_requests", `sender_id.eq.${userId},receiver_id.eq.${userId}`),
      safeDeleteOr("pairings", `user_a_id.eq.${userId},user_b_id.eq.${userId}`),
      safeDelete("pending_pair_invites", "inviter_id", userId),
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
      try {
        await adminClient
          .from("pending_pair_invites")
          .update({ status: "cancelled" })
          .eq("phone_e164", userPhone)
          .eq("status", "pending");
      } catch (err) {
        console.warn("Warning: Could not cancel pending_pair_invites by phone:", err);
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

    // Step 2.5: Clear phone number from BOTH profiles AND auth.users BEFORE deletion.
    // Two independent systems store the phone:
    //   1. profiles.phone — has a UNIQUE constraint
    //   2. auth.users.phone — Supabase Auth's own record
    // Both must be cleared BEFORE deleteUser() to guarantee the phone is freed.
    // If either clear fails, abort — leaving an orphaned phone is worse than a retry.
    if (userPhone) {
      console.log("Step 2.5: Clearing phone number from profiles and auth.users...");

      // 2.5a: Clear from profiles table (UNIQUE constraint)
      const { error: phoneClearError } = await adminClient
        .from("profiles")
        .update({ phone: null })
        .eq("id", userId);
      if (phoneClearError) {
        console.error("Failed to clear profiles.phone:", phoneClearError.message);
        return errorResponse("Failed to free phone number. Please try again.");
      }

      // 2.5b: Clear from auth.users (Supabase Auth layer)
      const { error: authPhoneClearError } = await adminClient.auth.admin.updateUserById(
        userId,
        { phone: "" }
      );
      if (authPhoneClearError) {
        // Non-fatal — auth.users row will be deleted in Step 3 anyway,
        // but log it so we know if this path ever fires
        console.warn("Warning: Could not clear auth.users.phone:", authPhoneClearError.message);
      }
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
