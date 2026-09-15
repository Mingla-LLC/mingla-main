// Issue #3429 — authenticated Ari logical-turn status, cooperative cancel, retry.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";

type TurnAction = "status" | "cancel" | "retry";
interface RequestBody {
  action?: TurnAction;
  client_turn_id?: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return response(405, { code: "METHOD_NOT_ALLOWED" });
  }
  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return response(400, { code: "BAD_REQUEST" });
  }
  if (
    !body.action || !body.client_turn_id ||
    !UUID_PATTERN.test(body.client_turn_id)
  ) {
    return response(400, { code: "BAD_REQUEST" });
  }
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return response(401, { code: "UNAUTHENTICATED" });
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anonKey || !serviceKey) {
    return response(500, { code: "INTERNAL" });
  }
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const jwt = authHeader.slice("Bearer ".length);
  const { data: userData, error: userError } = await userClient.auth.getUser(
    jwt,
  );
  if (userError || !userData.user) {
    return response(401, { code: "UNAUTHENTICATED" });
  }
  const userId = userData.user.id;
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let { data: attempt, error: attemptError } = await userClient
    .from("agent_turn_attempts")
    .select(
      "id,conversation_id,user_message_id,client_turn_id,attempt_number,status,error_code,accepted_at,started_at,terminal_at,updated_at",
    )
    .eq("client_turn_id", body.client_turn_id)
    .maybeSingle();
  if (attemptError) return response(500, { code: "STATUS_UNAVAILABLE" });

  if (!attempt && body.action === "cancel") {
    const now = new Date().toISOString();
    const { error: guardError } = await admin.from("agent_turn_claim_guards")
      .upsert({
        user_id: userId,
        client_turn_id: body.client_turn_id,
        state: "cancelled",
        expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        updated_at: now,
      }, {
        onConflict: "user_id,client_turn_id",
        ignoreDuplicates: true,
      });
    if (guardError) return response(500, { code: "STOP_FAILED" });
    const { data: claimedAfterGuard, error: claimedAfterGuardError } =
      await admin
        .from("agent_turn_attempts")
        .select(
          "id,conversation_id,user_message_id,client_turn_id,attempt_number,status,error_code,accepted_at,started_at,terminal_at,updated_at",
        )
        .eq("user_id", userId)
        .eq("client_turn_id", body.client_turn_id)
        .maybeSingle();
    if (claimedAfterGuardError) return response(500, { code: "STOP_FAILED" });
    attempt = claimedAfterGuard;
    if (!attempt) {
      return response(200, {
        accepted: false,
        changed: true,
        attempt: {
          id: body.client_turn_id,
          conversation_id: "",
          user_message_id: "",
          client_turn_id: body.client_turn_id,
          attempt_number: 0,
          status: "stopped",
          error_code: "STOP_BEFORE_ACCEPTANCE",
          accepted_at: now,
          started_at: null,
          terminal_at: now,
          updated_at: now,
        },
      });
    }
  }

  if (!attempt && body.action === "retry") {
    const { data: cleared, error: clearError } = await admin
      .from("agent_turn_claim_guards")
      .delete()
      .eq("user_id", userId)
      .eq("client_turn_id", body.client_turn_id)
      .eq("state", "cancelled")
      .select("client_turn_id");
    if (clearError) return response(500, { code: "RETRY_FAILED" });
    const now = new Date().toISOString();
    return response(200, {
      accepted: false,
      changed: (cleared?.length ?? 0) > 0,
      attempt: {
        id: body.client_turn_id,
        conversation_id: "",
        user_message_id: "",
        client_turn_id: body.client_turn_id,
        attempt_number: 0,
        status: "accepted",
        error_code: null,
        accepted_at: now,
        started_at: null,
        terminal_at: null,
        updated_at: now,
      },
    });
  }

  if (!attempt) return response(404, { code: "TURN_NOT_FOUND" });

  if (body.action === "status") {
    const { data: events, error: eventsError } = await userClient
      .from("agent_activity_events")
      .select("id,attempt_number,sequence,event_type,created_at")
      .eq("attempt_id", attempt.id)
      .eq("attempt_number", attempt.attempt_number)
      .order("sequence", { ascending: true });
    if (eventsError) return response(500, { code: "STATUS_UNAVAILABLE" });
    return response(200, { attempt, events: events ?? [] });
  }

  if (body.action === "cancel") {
    if (["stopped", "failed", "completed"].includes(attempt.status)) {
      return response(200, {
        attempt: { ...attempt, status: attempt.status },
        changed: false,
      });
    }
    const now = new Date().toISOString();
    const { data: stopped, error: stopError } = await admin
      .from("agent_turn_attempts")
      .update({
        status: "stopped",
        terminal_at: now,
        updated_at: now,
        error_code: null,
      })
      .eq("id", attempt.id)
      .eq("user_id", userId)
      .eq("attempt_number", attempt.attempt_number)
      .in("status", [
        "accepted",
        "running",
        "cancelling",
        "reconciliation_required",
      ])
      .select(
        "id,conversation_id,user_message_id,client_turn_id,attempt_number,status,error_code,accepted_at,started_at,terminal_at,updated_at",
      )
      .maybeSingle();
    if (stopError) return response(500, { code: "STOP_FAILED" });
    if (!stopped) return response(409, { code: "TURN_STATE_CHANGED" });
    const { error: eventError } = await admin.rpc(
      "append_agent_activity_event",
      {
        p_attempt_id: stopped.id,
        p_user_id: userId,
        p_attempt_number: stopped.attempt_number,
        p_event_type: "stopped",
        p_now: now,
      },
    );
    if (eventError) return response(500, { code: "STOP_EVENT_FAILED" });
    return response(200, { attempt: stopped, accepted: true, changed: true });
  }

  if (
    !["stopped", "failed", "reconciliation_required"].includes(attempt.status)
  ) {
    return response(409, { code: "RETRY_NOT_ALLOWED" });
  }
  const nextAttemptNumber = attempt.attempt_number + 1;
  const now = new Date().toISOString();
  const { data: retried, error: retryError } = await admin
    .from("agent_turn_attempts")
    .update({
      attempt_number: nextAttemptNumber,
      status: "accepted",
      error_code: null,
      accepted_at: now,
      started_at: null,
      terminal_at: null,
      updated_at: now,
    })
    .eq("id", attempt.id)
    .eq("user_id", userId)
    .eq("attempt_number", attempt.attempt_number)
    .in("status", ["stopped", "failed", "reconciliation_required"])
    .select(
      "id,conversation_id,user_message_id,client_turn_id,attempt_number,status,error_code,accepted_at,started_at,terminal_at,updated_at",
    )
    .maybeSingle();
  if (retryError) return response(500, { code: "RETRY_FAILED" });
  if (!retried) return response(409, { code: "TURN_STATE_CHANGED" });
  const { error: retryEventError } = await admin.rpc(
    "append_agent_activity_event",
    {
      p_attempt_id: retried.id,
      p_user_id: userId,
      p_attempt_number: retried.attempt_number,
      p_event_type: "automated_retry_started",
      p_now: now,
    },
  );
  if (retryEventError) return response(500, { code: "RETRY_EVENT_FAILED" });
  return response(200, { attempt: retried, accepted: true, changed: true });
});
