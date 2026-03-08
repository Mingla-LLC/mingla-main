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
 * Handles collaboration session cleanup when a user is deleted:
 * 1. For sessions where user is admin/creator: reassign admin to oldest member
 * 2. Remove user from all session_participants
 * 3. Delete sessions that fall below 2 members
 * All operations are wrapped in try-catch to handle missing tables gracefully
 */
async function cleanupCollaborationSessions(
  adminClient: SupabaseClient,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Step 1: Find all sessions where user is a participant
    let userParticipations: { session_id: string; is_admin: boolean }[] = [];
    try {
      const { data, error } = await adminClient
        .from("session_participants")
        .select("session_id, is_admin")
        .eq("user_id", userId);
      
      if (!error && data) {
        userParticipations = data;
      }
    } catch (err) {
      console.warn("Warning: Could not fetch session participations:", err);
      // Table might not exist, continue with deletion
      return { success: true };
    }

    const sessionIds = userParticipations.map((p) => p.session_id);

    if (sessionIds.length > 0) {
      // Step 2: For each session where user is admin, reassign admin to oldest NON-CREATOR member
      const adminSessionIds = userParticipations
        .filter((p) => p.is_admin)
        .map((p) => p.session_id);

      console.log(`User was admin in ${adminSessionIds.length} sessions:`, adminSessionIds);

      for (const sessionId of adminSessionIds) {
        try {
          // First, get the session's created_by (creator)
          const { data: sessionData, error: sessionError } = await adminClient
            .from("collaboration_sessions")
            .select("created_by")
            .eq("id", sessionId)
            .maybeSingle();

          console.log(`Session ${sessionId} created_by:`, sessionData?.created_by, "error:", sessionError);

          const creatorId = sessionData?.created_by;

          // Get ALL remaining participants (excluding deleted user)
          const { data: remainingMembers, error: membersError } = await adminClient
            .from("session_participants")
            .select("user_id, is_admin, created_at")
            .eq("session_id", sessionId)
            .neq("user_id", userId)
            .order("created_at", { ascending: true });

          console.log(`Session ${sessionId} remaining members:`, remainingMembers, "error:", membersError);

          if (!membersError && remainingMembers && remainingMembers.length > 0) {
            // Find oldest non-creator member who isn't already an admin
            const memberToPromote = remainingMembers.find(m => 
              m.user_id !== creatorId && !m.is_admin
            );

            if (memberToPromote) {
              console.log(`Promoting user ${memberToPromote.user_id} to admin for session ${sessionId}`);
              const { error: updateError } = await adminClient
                .from("session_participants")
                .update({ is_admin: true })
                .eq("session_id", sessionId)
                .eq("user_id", memberToPromote.user_id);
              
              if (updateError) {
                console.error(`Error promoting user to admin:`, updateError);
              } else {
                console.log(`Successfully promoted user ${memberToPromote.user_id} to admin`);
              }
            } else {
              console.log(`No non-creator, non-admin member to promote for session ${sessionId}`);
            }
          } else {
            console.log(`No remaining members found for session ${sessionId}`);
          }
        } catch (err) {
          console.warn(`Warning: Could not reassign admin for session ${sessionId}:`, err);
        }
      }

      // Step 3: Also check sessions where user is creator (from collaboration_sessions table)
      try {
        const { data: createdSessions, error: createdError } = await adminClient
          .from("collaboration_sessions")
          .select("id")
          .eq("created_by", userId);

        if (!createdError && createdSessions) {
          for (const session of createdSessions) {
            try {
              // Find oldest remaining participant to become new creator
              const { data: oldestMember, error: oldestError } = await adminClient
                .from("session_participants")
                .select("user_id, created_at")
                .eq("session_id", session.id)
                .neq("user_id", userId)
                .order("created_at", { ascending: true })
                .limit(1)
                .single();

              if (!oldestError && oldestMember) {
                // Transfer creator role
                await adminClient
                  .from("collaboration_sessions")
                  .update({ created_by: oldestMember.user_id })
                  .eq("id", session.id);
              }
            } catch (err) {
              console.warn(`Warning: Could not transfer creator for session ${session.id}:`, err);
            }
          }
        }
      } catch (err) {
        console.warn("Warning: Could not fetch created sessions:", err);
      }

      // Step 4: Remove user from all session_participants
      console.log(`Step 4: Removing user ${userId} from session_participants for sessions: ${sessionIds.join(", ")}`);
      const { data: deletedRows, error: removeParticipantError } = await adminClient
        .from("session_participants")
        .delete()
        .eq("user_id", userId)
        .select();
      
      if (removeParticipantError) {
        console.error("Error removing session participations:", removeParticipantError);
      } else {
        console.log(`Step 4: Successfully removed ${deletedRows?.length || 0} session participations:`, JSON.stringify(deletedRows));
      }

      // Step 5: Delete sessions that now have fewer than 2 members
      for (const sessionId of sessionIds) {
        try {
          // List actual participants to debug
          const { data: remainingParticipants, error: listError } = await adminClient
            .from("session_participants")
            .select("id, user_id, is_admin")
            .eq("session_id", sessionId);
          
          console.log(`Session ${sessionId} participants after Step 4:`, JSON.stringify(remainingParticipants));
          
          const count = remainingParticipants?.length || 0;

          console.log(`Session ${sessionId} has ${count} remaining members`);

          if (!listError && count < 2) {
            console.log(`Deleting under-populated session ${sessionId} (${count} members remaining)`);
            
            // Delete the session and ALL related data
            const deleteResults: Record<string, string> = {};
            
            const { error: e1 } = await adminClient.from("board_session_preferences").delete().eq("session_id", sessionId);
            deleteResults["board_session_preferences"] = e1 ? e1.message : "ok";
            
            const { error: e2 } = await adminClient.from("session_votes").delete().eq("session_id", sessionId);
            deleteResults["session_votes"] = e2 ? e2.message : "ok";
            
            const { error: e3 } = await adminClient.from("collaboration_invites").delete().eq("session_id", sessionId);
            deleteResults["collaboration_invites"] = e3 ? e3.message : "ok";
            
            const { error: e4 } = await adminClient.from("session_presence").delete().eq("session_id", sessionId);
            deleteResults["session_presence"] = e4 ? e4.message : "ok";
            
            const { error: e5 } = await adminClient.from("typing_indicators").delete().eq("session_id", sessionId);
            deleteResults["typing_indicators"] = e5 ? e5.message : "ok";
            
            // Delete remaining participants (the last one)
            const { error: e6 } = await adminClient.from("session_participants").delete().eq("session_id", sessionId);
            deleteResults["session_participants"] = e6 ? e6.message : "ok";
            
            // Finally delete the session itself
            const { error: e7 } = await adminClient.from("collaboration_sessions").delete().eq("id", sessionId);
            deleteResults["collaboration_sessions"] = e7 ? e7.message : "ok";
            
            console.log(`Session ${sessionId} deletion results:`, JSON.stringify(deleteResults));
          } else if (listError) {
            console.error(`Error listing members for session ${sessionId}:`, listError);
          } else {
            console.log(`Session ${sessionId} still has ${count} members, keeping it`);
          }
        } catch (err) {
          console.warn(`Warning: Could not check/delete session ${sessionId}:`, err);
        }
      }
    }

    return { success: true };
  } catch (err) {
    console.error("Error cleaning up collaboration sessions:", err);
    return { success: false, error: String(err) };
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
      await adminClient.from(table).delete().eq(column, value);
    } catch (err) {
      console.warn(`Warning: Could not delete from ${table}:`, err);
    }
  };

  // Helper function to safely delete with OR condition
  const safeDeleteOr = async (table: string, conditions: string) => {
    try {
      await adminClient.from(table).delete().or(conditions);
    } catch (err) {
      console.warn(`Warning: Could not delete from ${table}:`, err);
    }
  };

  try {
    // ── User interactions and learning data ──
    await safeDelete("user_interactions", "user_id", userId);
    await safeDelete("user_location_history", "user_id", userId);
    await safeDelete("user_preference_learning", "user_id", userId);
    await safeDelete("user_sessions", "user_id", userId);
    await safeDelete("user_activity", "user_id", userId);

    // ── Friends and social data ──
    await safeDeleteOr("friends", `user_id.eq.${userId},friend_user_id.eq.${userId}`);
    await safeDeleteOr("friend_requests", `sender_id.eq.${userId},receiver_id.eq.${userId}`);
    await safeDeleteOr("friend_links", `requester_id.eq.${userId},target_id.eq.${userId}`);

    // ── Blocked and muted users ──
    await safeDeleteOr("blocked_users", `blocker_id.eq.${userId},blocked_id.eq.${userId}`);
    await safeDeleteOr("muted_users", `muter_id.eq.${userId},muted_id.eq.${userId}`);

    // ── Messaging — soft delete to preserve other users' conversation history ──
    try {
      await adminClient
        .from("messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("sender_id", userId);
    } catch (err) {
      console.warn("Warning: Could not soft-delete messages:", err);
    }

    // ── Conversation participants ──
    await safeDelete("conversation_participants", "user_id", userId);

    // ── Calendar entries ──
    await safeDelete("calendar_entries", "user_id", userId);

    // ── Board-related data ──
    await safeDelete("board_session_preferences", "user_id", userId);
    await safeDelete("board_messages", "user_id", userId);
    await safeDelete("board_card_messages", "user_id", userId);
    await safeDelete("board_message_reads", "user_id", userId);
    await safeDelete("board_card_message_reads", "user_id", userId);
    await safeDelete("board_user_swipe_states", "user_id", userId);
    await safeDelete("board_saved_cards", "saved_by", userId);

    // ── Preference history (must be deleted before profiles due to trigger) ──
    await safeDelete("preference_history", "user_id", userId);

    // ── Collaboration invites ──
    await safeDelete("collaboration_invites", "inviter_id", userId);
    await safeDelete("collaboration_invites", "invitee_id", userId);

    // ── Presence data ──
    await safeDelete("user_presence", "user_id", userId);
    await safeDelete("session_presence", "user_id", userId);
    await safeDelete("typing_indicators", "user_id", userId);
    await safeDelete("board_participant_presence", "user_id", userId);
    await safeDelete("board_typing_indicators", "user_id", userId);

    // ── Session votes ──
    await safeDelete("session_votes", "user_id", userId);

    // ── Saved people and person data ──
    await safeDelete("person_audio_clips", "user_id", userId);
    await safeDelete("person_experiences", "user_id", userId);
    await safeDelete("saved_people", "user_id", userId);

    // ── Push tokens ──
    await safeDelete("user_push_tokens", "user_id", userId);

    // ── Subscriptions and credits ──
    await safeDelete("subscriptions", "user_id", userId);
    await safeDeleteOr("referral_credits", `referrer_id.eq.${userId},referred_id.eq.${userId}`);

    // ── Coach marks and undo actions ──
    await safeDelete("coach_mark_progress", "user_id", userId);
    await safeDelete("undo_actions", "user_id", userId);

    // ── App feedback ──
    await safeDelete("app_feedback", "user_id", userId);

    // ── User reports (both directions) ──
    await safeDeleteOr("user_reports", `reporter_id.eq.${userId},reported_user_id.eq.${userId}`);

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
    await safeDelete("pending_invites", "inviter_id", userId);
    await safeDelete("pending_session_invites", "inviter_id", userId);

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

    // Step 1: Handle collaboration sessions (reassign admins, remove memberships, delete under-populated boards)
    console.log("Step 1: Cleaning up collaboration sessions...");
    const collabResult = await cleanupCollaborationSessions(adminClient, userId);
    if (!collabResult.success) {
      console.warn("Warning: Some collaboration cleanup failed:", collabResult.error);
      // Continue with deletion - don't block on non-critical errors
    }

    // Step 2: Clean up all user-related data from various tables
    console.log("Step 2: Cleaning up user data from all tables...");
    const cleanupResult = await cleanupUserData(adminClient, userId, userPhone);
    if (!cleanupResult.success) {
      console.warn("Warning: Some data cleanup failed:", cleanupResult.error);
      // Continue with deletion - don't block on non-critical errors
    }

    // Step 3: Disable preference_history trigger and delete profile
    console.log("Step 3: Disabling triggers and deleting user profile...");
    
    // Use raw SQL to disable the trigger, delete, then re-enable
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
        console.error("Error deleting profile:", profileError);
        return new Response(
          JSON.stringify({ error: "Failed to delete profile data. Please try again." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Step 4: Delete the user from Supabase Auth
    console.log("Step 4: Deleting auth user...");
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(
      userId
    );

    if (deleteAuthError) {
      console.error("Error deleting auth user:", deleteAuthError);
      // Profile is already deleted, but auth deletion failed
      // This is a critical error - user is in an inconsistent state
      return new Response(
        JSON.stringify({ 
          error: "Account partially deleted. Please contact support.",
          partialDeletion: true 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
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
