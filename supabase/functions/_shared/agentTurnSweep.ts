/**
 * Issue #3429 REWORK-1 section 3.4 — orphaned Ari turn attempts end.
 *
 * If an `agent-chat` worker is killed mid-answer (CPU or wall limit), its
 * attempt row stays `accepted`/`running` and the client would show "working"
 * forever. `agent-turn-control` `status` calls `loadAriTurnStatus`, which first
 * sets such an attempt to `failed`/`EXECUTION_INTERRUPTED` once it has been
 * silent for 420 seconds (the paid-plan 400-second worker wall limit plus 20
 * seconds, so a live worker is never swept) and appends exactly one `failed`
 * activity event. The update is conditional on the observed status, attempt
 * number, and staleness, so a concurrent commit or retry wins cleanly; a later
 * `commit_agent_chat_assistant_turn` for the swept attempt returns false.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const ARI_TURN_ORPHAN_SWEEP_SECONDS = 420;

export const ARI_TURN_ATTEMPT_COLUMNS =
  "id,conversation_id,user_message_id,client_turn_id,attempt_number,status,error_code,accepted_at,started_at,terminal_at,updated_at";

export interface AriTurnAttemptRow {
  id: string;
  conversation_id: string;
  user_message_id: string;
  client_turn_id: string;
  attempt_number: number;
  status: string;
  error_code: string | null;
  accepted_at: string;
  started_at: string | null;
  terminal_at: string | null;
  updated_at: string;
}

/**
 * Returns the swept attempt when this call terminalized it, otherwise null.
 * Throws only when the sweep's own writes fail.
 */
export async function sweepInterruptedAriTurnAttempt(args: {
  admin: SupabaseClient;
  userId: string;
  attempt: AriTurnAttemptRow;
  nowMs: number;
}): Promise<AriTurnAttemptRow | null> {
  const { attempt } = args;
  if (!["accepted", "running"].includes(attempt.status)) return null;
  const cutoffMs = args.nowMs - ARI_TURN_ORPHAN_SWEEP_SECONDS * 1_000;
  if (!(Date.parse(attempt.updated_at) < cutoffMs)) return null;
  const now = new Date(args.nowMs).toISOString();
  const { data: swept, error } = await args.admin
    .from("agent_turn_attempts")
    .update({
      status: "failed",
      error_code: "EXECUTION_INTERRUPTED",
      terminal_at: now,
      updated_at: now,
    })
    .eq("id", attempt.id)
    .eq("user_id", args.userId)
    .eq("attempt_number", attempt.attempt_number)
    .eq("status", attempt.status)
    .lt("updated_at", new Date(cutoffMs).toISOString())
    .select(ARI_TURN_ATTEMPT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error("turn_sweep_failed");
  if (!swept) return null;
  const { error: eventError } = await args.admin.rpc(
    "append_agent_activity_event",
    {
      p_attempt_id: attempt.id,
      p_user_id: args.userId,
      p_attempt_number: attempt.attempt_number,
      p_event_type: "failed",
      p_now: now,
    },
  );
  if (eventError) throw new Error("turn_sweep_event_failed");
  return swept as AriTurnAttemptRow;
}

/** The body of `agent-turn-control` `status`: sweep, then canonical events. */
export async function loadAriTurnStatus(args: {
  userClient: SupabaseClient;
  admin: SupabaseClient;
  userId: string;
  attempt: AriTurnAttemptRow;
  nowMs?: number;
}): Promise<
  | { ok: true; attempt: AriTurnAttemptRow; events: unknown[] }
  | { ok: false; code: "STATUS_UNAVAILABLE" }
> {
  let attempt = args.attempt;
  try {
    attempt = await sweepInterruptedAriTurnAttempt({
      admin: args.admin,
      userId: args.userId,
      attempt,
      nowMs: args.nowMs ?? Date.now(),
    }) ?? attempt;
  } catch {
    return { ok: false, code: "STATUS_UNAVAILABLE" };
  }
  const { data: events, error: eventsError } = await args.userClient
    .from("agent_activity_events")
    .select("id,attempt_number,sequence,event_type,created_at")
    .eq("attempt_id", attempt.id)
    .eq("attempt_number", attempt.attempt_number)
    .order("sequence", { ascending: true });
  if (eventsError) return { ok: false, code: "STATUS_UNAVAILABLE" };
  return { ok: true, attempt, events: events ?? [] };
}
