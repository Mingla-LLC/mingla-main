import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function errorResponse(message: string, status: number = 500) {
  console.error(`[delete-user] Error: ${message}`);
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * Transfers ownership of collaboration sessions the user created
 * to the oldest accepted participant. Deletes solo sessions (where
 * the user is the only participant) to prevent orphans.
 * Must run BEFORE deleteUser() because after auth deletion, the FK
 * SET NULL fires and created_by becomes NULL.
 */
async function handleSessionCleanup(
  adminClient: SupabaseClient,
  userId: string
): Promise<void> {
  // Find all sessions where this user participates
  const { data: userSessions } = await adminClient
    .from("session_participants")
    .select("session_id")
    .eq("user_id", userId);

  if (!userSessions?.length) return;

  const sessionIds = [...new Set(userSessions.map((s: { session_id: string }) => s.session_id))];

  // Find OTHER participants in those sessions (one query)
  const { data: otherParticipants } = await adminClient
    .from("session_participants")
    .select("session_id, user_id, has_accepted")
    .in("session_id", sessionIds)
    .neq("user_id", userId)
    .order("created_at", { ascending: true });

  // Group other participants by session
  const sessionParticipants = new Map<string, Array<{ user_id: string; has_accepted: boolean }>>();
  (otherParticipants ?? []).forEach((p: { session_id: string; user_id: string; has_accepted: boolean }) => {
    const arr = sessionParticipants.get(p.session_id) ?? [];
    arr.push(p);
    sessionParticipants.set(p.session_id, arr);
  });

  // Solo sessions (no other participants) → delete
  const soloSessionIds = sessionIds.filter(id => !sessionParticipants.has(id));
  if (soloSessionIds.length > 0) {
    await adminClient
      .from("collaboration_sessions")
      .delete()
      .in("id", soloSessionIds);
    console.log(`[delete-user] Deleted ${soloSessionIds.length} solo session(s)`);
  }

  // Sessions the user created with other participants → transfer ownership
  const { data: ownedSessions } = await adminClient
    .from("collaboration_sessions")
    .select("id")
    .eq("created_by", userId)
    .in("id", sessionIds.filter(id => sessionParticipants.has(id)))
    .neq("status", "completed");

  if (!ownedSessions?.length) return;

  const transfers = new Map<string, string>();
  ownedSessions.forEach((s: { id: string }) => {
    const others = sessionParticipants.get(s.id) ?? [];
    const accepted = others.filter(p => p.has_accepted);
    if (accepted.length > 0) {
      transfers.set(s.id, accepted[0].user_id);
    }
  });

  if (transfers.size > 0) {
    await Promise.allSettled(
      [...transfers.entries()].map(([sessionId, newOwner]) =>
        adminClient
          .from("collaboration_sessions")
          .update({ created_by: newOwner })
          .eq("id", sessionId)
          .then(({ error }) => {
            if (error) console.warn(`[delete-user] Session ${sessionId} transfer failed:`, error.message);
          })
      )
    );
    console.log(`[delete-user] Transferred ${transfers.size} session(s)`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Missing or invalid Authorization header", 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return errorResponse("Supabase configuration missing");
    }

    // Authenticate the user
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user?.id) {
      return errorResponse("Unauthorized or invalid token", 401);
    }

    const userId = user.id;
    console.log(`[delete-user] Starting deletion for: ${userId}`);

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // ── Step 1: Fetch phone ──
    const { data: profileData } = await adminClient
      .from("profiles")
      .select("phone")
      .eq("id", userId)
      .maybeSingle();
    const userPhone = profileData?.phone ?? null;
    console.log(`[delete-user] Phone: ${userPhone ? userPhone.slice(0, 4) + "****" : "none"}`);

    // ── Step 2: All pre-deletion work in ONE parallel batch ──
    // These must complete BEFORE deleteUser() because CASCADE would
    // destroy or NULL-ify the rows we need to update.
    const preDeleteOps: Array<Promise<unknown>> = [
      // Transfer session ownership + delete solo sessions (prevents orphans)
      handleSessionCleanup(adminClient, userId),

      // Soft-delete messages so other users keep conversation history.
      // CASCADE from auth.users would hard-delete them.
      adminClient
        .from("messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("sender_id", userId)
        .then(({ error }) => {
          if (error) console.warn("[delete-user] messages soft-delete:", error.message);
        }),

      // Anonymize beta_feedback PII (rows preserved via SET NULL on user_id)
      adminClient
        .from("beta_feedback")
        .update({ user_display_name: null, user_email: null, user_phone: null })
        .eq("user_id", userId)
        .then(({ error }) => {
          if (error) console.warn("[delete-user] beta_feedback anonymize:", error.message);
        }),

      // place_reviews: audio columns dropped. Only rating + place data remain.
      // Rows preserved via SET NULL on user_id — star ratings survive deletion.

      // Cancel pending invites by inviter_id
      adminClient
        .from("pending_invites")
        .update({ status: "cancelled" })
        .eq("inviter_id", userId)
        .eq("status", "pending")
        .then(({ error }) => {
          if (error) console.warn("[delete-user] pending_invites by inviter:", error.message);
        }),
      adminClient
        .from("pending_session_invites")
        .update({ status: "cancelled" })
        .eq("inviter_id", userId)
        .eq("status", "pending")
        .then(({ error }) => {
          if (error) console.warn("[delete-user] pending_session_invites by inviter:", error.message);
        }),
    ];

    // Cancel pending invites by phone (CASCADE can't do this — phone is not an FK)
    if (userPhone) {
      preDeleteOps.push(
        adminClient
          .from("pending_invites")
          .update({ status: "cancelled" })
          .eq("phone_e164", userPhone)
          .eq("status", "pending")
          .then(({ error }) => {
            if (error) console.warn("[delete-user] pending_invites by phone:", error.message);
          }),
        adminClient
          .from("pending_session_invites")
          .update({ status: "cancelled" })
          .eq("phone_e164", userPhone)
          .eq("status", "pending")
          .then(({ error }) => {
            if (error) console.warn("[delete-user] pending_session_invites by phone:", error.message);
          }),
        adminClient
          .from("pending_pair_invites")
          .update({ status: "cancelled" })
          .eq("phone_e164", userPhone)
          .eq("status", "pending")
          .then(({ error }) => {
            if (error) console.warn("[delete-user] pending_pair_invites by phone:", error.message);
          }),
      );
    }

    await Promise.allSettled(preDeleteOps);
    console.log("[delete-user] Pre-deletion work complete");

    // ── Step 3: Clear phone from profiles + auth.users ──
    // Frees the UNIQUE constraint so the phone can be reused.
    if (userPhone) {
      const { error: phoneClearError } = await adminClient
        .from("profiles")
        .update({ phone: null })
        .eq("id", userId);
      if (phoneClearError) {
        console.error("[delete-user] Failed to clear profiles.phone:", phoneClearError.message);
        return errorResponse("Failed to free phone number. Please try again.");
      }

      const { error: authPhoneClearError } = await adminClient.auth.admin.updateUserById(
        userId,
        { phone: "" }
      );
      if (authPhoneClearError) {
        console.warn("[delete-user] Could not clear auth.users.phone:", authPhoneClearError.message);
      }
    }

    // ── Step 4: Delete auth user → CASCADE handles ~80 tables ──
    // This immediately invalidates the JWT and cascade-deletes from all
    // tables with FK to auth.users (friends, board_*, notifications, etc.)
    // user_card_impressions and user_visits use SET NULL (engagement preserved).
    // collaboration_sessions.created_by uses SET NULL (sessions survive).
    console.log("[delete-user] Deleting auth user (CASCADE handles ~80 tables)...");
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      console.error("[delete-user] Auth deletion failed:", deleteAuthError);
      return errorResponse("Failed to delete account. Please try again.");
    }

    // ── Step 5: Delete profile ──
    // With the profiles.id → auth.users(id) ON DELETE CASCADE FK, the profile
    // should already be gone from Step 4. This is a safety net — if it still
    // exists (e.g. FK wasn't applied yet), delete it explicitly.
    // CRITICAL: Do NOT return success if the profile survives — an orphan profile
    // blocks re-registration (profiles_email_unique constraint).
    console.log("[delete-user] Verifying profile deletion...");
    const { data: survivingProfile } = await adminClient
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (survivingProfile) {
      console.log("[delete-user] Profile survived CASCADE — deleting explicitly...");
      const { error: profileError } = await adminClient
        .from("profiles")
        .delete()
        .eq("id", userId);

      if (profileError) {
        console.error("[delete-user] Profile delete FAILED:", profileError.message);
        return errorResponse(
          "Account partially deleted. Please contact support to complete removal."
        );
      }
    }

    console.log(`[delete-user] Deletion complete for: ${userId}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Your account has been permanently deleted.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[delete-user] Unhandled error:", err);
    return errorResponse("Failed to delete account. Please try again later.");
  }
});
