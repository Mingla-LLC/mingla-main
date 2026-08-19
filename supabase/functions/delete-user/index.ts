import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AuthRetainReason,
  type DeletionSide,
  isRetainReasonJustifiedForSide,
  purgeBusinessSideData,
  purgeExplorerSideData,
  shouldDeleteAuthUser,
} from "../_shared/accountDeletionSides.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function errorResponse(message: string, status: number = 500) {
  console.error(`[delete-user] Error: ${message}`);
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function parseSide(body: unknown): DeletionSide {
  const side = (body as { side?: string } | null)?.side;
  if (side === "business") return "business";
  return "explorer";
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
  userId: string,
): Promise<void> {
  const { data: userSessions } = await adminClient
    .from("session_participants")
    .select("session_id")
    .eq("user_id", userId);

  if (!userSessions?.length) return;

  const sessionIds = [...new Set(userSessions.map((s: { session_id: string }) => s.session_id))];

  const { data: otherParticipants } = await adminClient
    .from("session_participants")
    .select("session_id, user_id, has_accepted")
    .in("session_id", sessionIds)
    .neq("user_id", userId)
    .order("created_at", { ascending: true });

  const sessionParticipants = new Map<string, Array<{ user_id: string; has_accepted: boolean }>>();
  (otherParticipants ?? []).forEach((p: { session_id: string; user_id: string; has_accepted: boolean }) => {
    const arr = sessionParticipants.get(p.session_id) ?? [];
    arr.push(p);
    sessionParticipants.set(p.session_id, arr);
  });

  const soloSessionIds = sessionIds.filter((id) => !sessionParticipants.has(id));
  if (soloSessionIds.length > 0) {
    await adminClient
      .from("collaboration_sessions")
      .delete()
      .in("id", soloSessionIds);
    console.log(`[delete-user] Deleted ${soloSessionIds.length} solo session(s)`);
  }

  const { data: ownedSessions } = await adminClient
    .from("collaboration_sessions")
    .select("id")
    .eq("created_by", userId)
    .in("id", sessionIds.filter((id) => sessionParticipants.has(id)))
    .neq("status", "completed");

  if (!ownedSessions?.length) return;

  const transfers = new Map<string, string>();
  ownedSessions.forEach((s: { id: string }) => {
    const others = sessionParticipants.get(s.id) ?? [];
    const accepted = others.filter((p) => p.has_accepted);
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
      ),
    );
    console.log(`[delete-user] Transferred ${transfers.size} session(s)`);
  }
}

async function runExplorerPreDeleteBatch(
  adminClient: SupabaseClient,
  userId: string,
  userPhone: string | null,
): Promise<void> {
  const preDeleteOps: Array<Promise<unknown>> = [
    handleSessionCleanup(adminClient, userId),
    adminClient
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("sender_id", userId)
      .then(({ error }) => {
        if (error) console.warn("[delete-user] messages soft-delete:", error.message);
      }),
    adminClient
      .from("beta_feedback")
      .update({ user_display_name: null, user_email: null, user_phone: null })
      .eq("user_id", userId)
      .then(({ error }) => {
        if (error) console.warn("[delete-user] beta_feedback anonymize:", error.message);
      }),
    adminClient
      .from("place_reviews")
      .update({
        audio_urls: [],
        audio_durations_seconds: [],
        transcription: null,
        ai_summary: null,
        feedback_text: null,
      })
      .eq("user_id", userId)
      .then(({ error }) => {
        if (error) console.warn("[delete-user] place_reviews anonymize:", error.message);
      }),
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
}

async function clearPhoneForReuse(
  adminClient: SupabaseClient,
  userId: string,
  userPhone: string | null,
): Promise<Response | null> {
  if (!userPhone) return null;

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
    { phone: "" },
  );
  if (authPhoneClearError) {
    console.warn("[delete-user] Could not clear auth.users.phone:", authPhoneClearError.message);
  }

  return null;
}

async function deleteAuthUserIfReady(
  adminClient: SupabaseClient,
  userId: string,
): Promise<{
  authDeleted: boolean;
  authRetained: boolean;
  retainedReason: AuthRetainReason | null;
}> {
  const { remove: removeAuth, reason } = await shouldDeleteAuthUser(adminClient, userId);
  if (!removeAuth) {
    console.log(
      `[delete-user] Auth retained for ${userId} — reason=${reason ?? "unattributed"}`,
    );
    return { authDeleted: false, authRetained: true, retainedReason: reason };
  }

  console.log("[delete-user] Deleting auth user (CASCADE handles remaining tables)...");
  const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteAuthError) {
    console.error("[delete-user] Auth deletion failed:", deleteAuthError);
    throw new Error("Failed to delete account. Please try again.");
  }

  const { data: survivingProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (survivingProfile) {
    const { error: profileError } = await adminClient
      .from("profiles")
      .delete()
      .eq("id", userId);
    if (profileError) {
      throw new Error(
        "Account partially deleted. Please contact support to complete removal.",
      );
    }
  }

  return { authDeleted: true, authRetained: false, retainedReason: null };
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

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const side = parseSide(body);

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
    console.log(`[delete-user] Starting side=${side} deletion for: ${userId}`);

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: profileData } = await adminClient
      .from("profiles")
      .select("phone")
      .eq("id", userId)
      .maybeSingle();
    const userPhone = profileData?.phone ?? null;

    if (userPhone) {
      const { error: trialHashError } = await adminClient.rpc("record_trial_phone", {
        p_phone: userPhone,
      });
      if (trialHashError) {
        console.warn("[delete-user] Failed to record trial phone hash:", trialHashError.message);
      }
    }

    if (side === "explorer") {
      await runExplorerPreDeleteBatch(adminClient, userId, userPhone);
      await purgeExplorerSideData(adminClient, userId);

      const phoneError = await clearPhoneForReuse(adminClient, userId, userPhone);
      if (phoneError) return phoneError;

      const { authDeleted, authRetained, retainedReason } = await deleteAuthUserIfReady(
        adminClient,
        userId,
      );

      // #2321 SC-5 — fail closed. Never return a success payload whose message the
      // server cannot justify. Before the repair, EVERY explorer deletion retained
      // auth and told the user "your business login is unchanged" — including brand
      // new accounts that had no business side at all.
      if (authRetained && !isRetainReasonJustifiedForSide(side, retainedReason)) {
        console.error(
          `[delete-user] side=${side} retained auth with unjustifiable reason=${
            retainedReason ?? "null"
          } for ${userId}`,
        );
        return errorResponse(
          "Account deletion could not be completed. Please contact support.",
          500,
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          side,
          authDeleted,
          authRetained,
          ...(authRetained ? { retainedReason } : {}),
          message: authRetained
            ? "Your explorer account has been removed. Your business login is unchanged."
            : "Your account has been permanently deleted.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Business-side deletion (#668): Stripe offboard + soft-delete brands/creator row.
    await purgeBusinessSideData(adminClient, userId);

    const { authDeleted, authRetained, retainedReason } = await deleteAuthUserIfReady(
      adminClient,
      userId,
    );

    // #2321 SC-5 — the mirror of the explorer fail-closed rule.
    if (authRetained && !isRetainReasonJustifiedForSide(side, retainedReason)) {
      console.error(
        `[delete-user] side=${side} retained auth with unjustifiable reason=${
          retainedReason ?? "null"
        } for ${userId}`,
      );
      return errorResponse(
        "Account deletion could not be completed. Please contact support.",
        500,
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        side,
        authDeleted,
        authRetained,
        ...(authRetained ? { retainedReason } : {}),
        message: authRetained
          ? "Your business account has been removed. Your explorer login is unchanged."
          : "Your account has been permanently deleted.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete account. Please try again later.";
    console.error("[delete-user] Unhandled error:", err);
    return errorResponse(message);
  }
});
