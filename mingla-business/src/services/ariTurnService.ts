/** Issue #3429 — durable Ari attempt status and activity transport. */

import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "./supabase";

export type AriAttemptStatus =
  | "accepted"
  | "running"
  | "cancelling"
  | "stopped"
  | "completed"
  | "failed"
  | "reconciliation_required";

export type AriActivityEventType =
  | "accepted"
  | "attachments_processing_started"
  | "model_started"
  | "workspace_read_started"
  | "approved_action_started"
  | "automated_retry_started"
  | "finalizing_started"
  | "response_ready"
  | "reconciliation_started"
  | "reconciliation_finished"
  | "stopped"
  | "failed";

export interface AriTurnAttempt {
  id: string;
  conversation_id: string;
  user_message_id: string;
  client_turn_id: string;
  attempt_number: number;
  status: AriAttemptStatus;
  error_code: string | null;
  accepted_at: string;
  started_at: string | null;
  terminal_at: string | null;
  updated_at: string;
}

export interface AriActivityEvent {
  id: string;
  attempt_number: number;
  sequence: number;
  event_type: AriActivityEventType;
  created_at: string;
}

export interface AriTurnStatusResult {
  attempt: AriTurnAttempt;
  events: AriActivityEvent[];
}

async function invokeTurnControl(
  action: "status" | "cancel" | "retry",
  clientTurnId: string,
): Promise<AriTurnStatusResult & { changed?: boolean }> {
  const { data, error } = await supabase.functions.invoke<
    AriTurnStatusResult & { changed?: boolean; code?: string }
  >("agent-turn-control", {
    body: { action, client_turn_id: clientTurnId },
  });
  if (error || !data?.attempt) {
    const code = data?.code ?? "TURN_STATUS_UNAVAILABLE";
    throw new Error(code);
  }
  return data;
}

export function fetchAriTurnStatus(clientTurnId: string): Promise<AriTurnStatusResult> {
  return invokeTurnControl("status", clientTurnId);
}

export function stopAriTurn(clientTurnId: string): Promise<AriTurnStatusResult & { accepted?: boolean; changed?: boolean }> {
  return invokeTurnControl("cancel", clientTurnId);
}

export function retryAriTurn(clientTurnId: string): Promise<AriTurnStatusResult & { accepted?: boolean; changed?: boolean }> {
  return invokeTurnControl("retry", clientTurnId);
}

export function subscribeAriTurnActivity(
  clientTurnId: string,
  onEvent: (event: AriActivityEvent) => void,
  onStatus?: (status: "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED") => void,
): () => void {
  let channel: RealtimeChannel | null = supabase
    .channel(`ari-turn-${clientTurnId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "agent_activity_events",
        filter: `client_turn_id=eq.${clientTurnId}`,
      },
      (payload) => {
        const row = payload.new as AriActivityEvent;
        if (row?.id && row.event_type) onEvent(row);
      },
    )
    .subscribe((status) => onStatus?.(status));

  return () => {
    if (!channel) return;
    const current = channel;
    channel = null;
    void supabase.removeChannel(current);
  };
}
