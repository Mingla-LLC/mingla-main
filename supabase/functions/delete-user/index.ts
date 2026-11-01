import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  deleteAuthUserIfReady,
  type DeletionSide,
  isRetainReasonJustifiedForSide,
  purgeBusinessSideData,
  purgeExplorerSideData,
  runBusinessSideDeletion,
  shouldDeleteAuthUser,
} from "../_shared/accountDeletionSides.ts";
import {
  clearExplorerPhoneForReuse,
  ExplorerPhoneReleaseError,
} from "../_shared/explorerPhoneRelease.ts";

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

/** #3660 — a structured body the Host app decides on by `code`, never by text. */
function codedResponse(
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify(body),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
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
    const authIdentityPhone = user.identities?.find((identity) =>
      identity.provider === "phone"
    )?.identity_data?.phone;
    const userPhone = profileData?.phone ?? user.phone ??
      (typeof authIdentityPhone === "string" ? authIdentityPhone : null);

    const recordTrialPhone = async (): Promise<void> => {
      if (!userPhone) return;
      const { error: trialHashError } = await adminClient.rpc("record_trial_phone", {
        p_phone: userPhone,
      });
      if (trialHashError) {
        console.warn("[delete-user] Failed to record trial phone hash:", trialHashError.message);
      }
    };

    // The login step's two outside dependencies, wired here so the gate that
    // decides and the call that removes are both visible at the request path.
    const authStepDeps = {
      decide: () => shouldDeleteAuthUser(adminClient, userId),
      deleteUser: () => adminClient.auth.admin.deleteUser(userId),
    };

    if (side === "explorer") {
      // Explorer order is unchanged: the trial-phone record runs first.
      await recordTrialPhone();
      await runExplorerPreDeleteBatch(adminClient, userId, userPhone);
      await purgeExplorerSideData(adminClient, userId);

      try {
        await clearExplorerPhoneForReuse(adminClient, userId, userPhone);
      } catch (error) {
        const stage = error instanceof ExplorerPhoneReleaseError
          ? error.stage
          : "unknown";
        console.error(
          `[delete-user] Failed to free Explorer phone at stage=${stage}`,
        );
        return errorResponse("Failed to free phone number. Please try again.");
      }

      const { authDeleted, authRetained, retainedReason } = await deleteAuthUserIfReady(
        adminClient,
        userId,
        side,
        authStepDeps,
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

    // Business-side deletion (#668, rebuilt by #3660).
    //
    // ONE database call decides and writes everything, or refuses and writes
    // nothing. Only after it has committed do the trial-phone record, Stripe,
    // Paystack and the login step run, and none of them can turn a finished
    // deletion into a failure response.
    const outcome = await runBusinessSideDeletion(adminClient, userId, {
      purge: () => purgeBusinessSideData(adminClient, userId),
      recordTrialPhone,
      ...authStepDeps,
    });

    if (outcome.kind === "blocked") {
      // Deliberately non-2xx: app versions already installed treat any 2xx
      // without an `error` field as success and would sign the host out.
      console.log(
        `[delete-user] side=business deletion blocked for ${userId}: ${
          outcome.blockers.map((b) => b.code).join(",")
        }`,
      );
      return codedResponse(409, {
        success: false,
        error: "account_deletion_blocked",
        code: "account_deletion_blocked",
        blockers: outcome.blockers,
      });
    }

    if (outcome.kind === "failed") {
      return codedResponse(500, {
        success: false,
        error: "account_deletion_failed",
        code: "account_deletion_failed",
      });
    }

    const { authDeleted, authRetained, retainedReason } = outcome;

    // #2321 SC-5 mirror, changed by #3660: the Host side is already deleted, so
    // an unattributable retain reason is logged for support and never answered
    // with a failure. The response stays 200 with the truth in `authRetained`.
    if (authRetained && !isRetainReasonJustifiedForSide(side, retainedReason)) {
      console.error(
        `[delete-user] side=${side} retained auth with unjustifiable reason=${
          retainedReason ?? "null"
        } for ${userId} (Host side already deleted; responding 200)`,
      );
    }

    return codedResponse(200, {
      success: true,
      side,
      authDeleted,
      authRetained,
      ...(authRetained ? { retainedReason } : {}),
      message: authRetained
        ? "Your business account has been removed. Your explorer login is unchanged."
        : "Your account has been permanently deleted.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete account. Please try again later.";
    console.error("[delete-user] Unhandled error:", err);
    return errorResponse(message);
  }
});
