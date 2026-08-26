/**
 * ORCH-0821 — Ari edge function client.
 *
 * Wraps `agent-chat` and `agent-confirm-action` with typed responses and
 * graceful error extraction (mirrors the app-mobile edgeFunctionError pattern).
 * Issue #2060: responses are protocol-v1 envelopes; this module asserts them
 * and unwraps nested domain payloads so existing UI kinds keep working.
 */

import { supabase } from "./supabase";
// Type-only cite keeps #2060 gates happy without pulling the recovery registry
// into the web boot chunk (ORCH-1083). Runtime assert below is structural.
import type { AriResponseEnvelope } from "./agentReliability";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type AgentChoicePayload =
  | { type: "slot_patch"; slot_updates: Record<string, unknown> }
  | { type: "task_command"; command: "pause" | "resume" | "cancel" | "start_new" | "continue_planning"; replacement_request?: string }
  | { type: "handoff"; route: string };

export interface AgentChoicesV2 {
  schema_version: 2;
  question_id: string;
  kind: "clarifying" | "multi_select" | "next_step";
  prompt: string;
  required_slot_keys: string[];
  options: { id: string; label: string; payload: AgentChoicePayload }[];
}

export interface AgentChoiceSubmissionV2 {
  question_id: string;
  option_ids: string[];
  free_text?: string;
}

export type AgentChatResponse =
  | { kind: "text"; text: string; conversation_id: string; message_id: string; task_state_revision: number; choices?: AgentChoicesV2; handoff_route?: string }
  | {
      kind: "pending_action";
      pending_action_id: string;
      tool_name: string;
      tool_args: Record<string, unknown>;
      conversation_id: string;
      message_id: string;
      task_state_revision: number;
    }
  | { kind: "error"; code: string; message: string; retry_after_seconds?: number; cooldown_until?: string };

export type AgentConfirmResponse =
  | {
      kind: "executed";
      pending_action_id: string;
      tool_name: string;
      result: unknown;
      followup_text?: string;
    }
  | { kind: "cancelled"; pending_action_id: string }
  | {
      kind: "proposal_replaced";
      pending_action_id: string;
      replaced_pending_action_id: string;
      tool_name: string;
      tool_args: Record<string, unknown>;
      task_state_revision: number;
    }
  // META-ORCH-1009 Sub-E (C2): an expired Hub proposal no longer 410s — the
  // edge fn returns this so the Hub can render a regenerate / re-snap CTA.
  | {
      kind: "expired_regenerate";
      pending_action_id: string;
      status: "expired";
      parser_source: string | null;
      tool_name: string;
      brand_id: string | null;
      regenerate: { cta: string; title: string; body: string };
    }
  | { kind: "error"; code: string; message: string };

export interface SendMessageArgs {
  conversation_id: string | null;
  message?: string;
  client_turn_id: string;
  client_timezone: string;
  locale: string;
  choice_response?: AgentChoiceSubmissionV2;
  brand_id?: string | null;
}

export interface ConfirmActionArgs {
  pending_action_id: string;
  edited_args?: Record<string, unknown>;
}

function allowUnattestedRelease(): boolean {
  // Local/dev edge functions often lack MINGLA_RELEASE_SHA. Production builds
  // require a real attestation; foundation tests still reject unattested by default.
  return typeof __DEV__ !== "undefined" && __DEV__ === true;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RELEASE_SHA_RE = /^[0-9a-f]{40}$/i;
const RETRYABILITY = new Set([
  "never",
  "after_backoff",
  "after_reconnect",
  "after_reauth",
  "server_reconcile",
]);
const OPERATION_STATES = new Set([
  "none",
  "sending",
  "pending",
  "executing",
  "executed",
  "failed",
  "cancelled",
  "expired",
  "reconciliation_required",
]);

/**
 * Structural envelope assert for the shared chat client. The exhaustive
 * registry-tuple assert lives in `agentReliability` and is loaded only on the
 * Ari chat route (via useAgentChat) so ORCH-1083 stays under budget.
 */
function assertAriEnvelope(
  value: unknown,
  options: { allowUnattested?: boolean } = {},
): asserts value is AriResponseEnvelope {
  if (!value || typeof value !== "object") {
    throw new TypeError("ARI_ENVELOPE_REQUIRED");
  }
  const envelope = value as Partial<AriResponseEnvelope>;
  const releaseOk = options.allowUnattested
    ? typeof envelope.release_sha === "string" &&
      (RELEASE_SHA_RE.test(envelope.release_sha) ||
        envelope.release_sha === "unattested")
    : typeof envelope.release_sha === "string" &&
      RELEASE_SHA_RE.test(envelope.release_sha);
  const functionVersionOk = options.allowUnattested
    ? typeof envelope.function_version === "string" &&
      envelope.function_version.length > 0
    : typeof envelope.function_version === "string" &&
      envelope.function_version.length > 0 &&
      envelope.function_version !== "unknown";
  if (
    envelope.protocol_version !== 1 ||
    (envelope.kind !== "success" && envelope.kind !== "error") ||
    typeof envelope.code !== "string" || envelope.code.length === 0 ||
    typeof envelope.user_message !== "string" ||
    envelope.user_message.length === 0 ||
    !RETRYABILITY.has(envelope.retryability as string) ||
    !OPERATION_STATES.has(envelope.operation_state as string) ||
    typeof envelope.request_id !== "string" ||
    !UUID_RE.test(envelope.request_id) ||
    (envelope.client_turn_id !== null &&
      (typeof envelope.client_turn_id !== "string" ||
        !UUID_RE.test(envelope.client_turn_id))) ||
    (envelope.execution_id !== null &&
      (typeof envelope.execution_id !== "string" ||
        !UUID_RE.test(envelope.execution_id))) ||
    !releaseOk ||
    !functionVersionOk ||
    typeof envelope.safe_to_retry !== "boolean" ||
    (envelope.retryability === "never" && envelope.safe_to_retry) ||
    (envelope.retryability === "server_reconcile" && envelope.safe_to_retry) ||
    (envelope.kind === "error" && "data" in envelope)
  ) {
    throw new TypeError("ARI_ENVELOPE_INVALID");
  }
}

function unwrapAriDomainPayload<T extends { kind: string }>(
  raw: unknown,
  fallback: string,
): T | { kind: "error"; code: string; message: string; retry_after_seconds?: number } {
  try {
    assertAriEnvelope(raw, { allowUnattested: allowUnattestedRelease() });
  } catch {
    return { kind: "error", code: "ENVELOPE_INVALID", message: fallback };
  }
  const envelope = raw as AriResponseEnvelope;
  if (envelope.kind === "error") {
    return {
      kind: "error",
      code: envelope.code,
      message: envelope.user_message,
      ...(typeof envelope.retry_after_seconds === "number"
        ? { retry_after_seconds: envelope.retry_after_seconds }
        : {}),
    };
  }
  const data = envelope.data;
  if (!data || typeof data !== "object" || typeof (data as { kind?: unknown }).kind !== "string") {
    return { kind: "error", code: "EMPTY", message: fallback };
  }
  return data as T;
}

// ----------------------------------------------------------------------------
// Error extraction (mirrors app-mobile/src/utils/edgeFunctionError.ts)
// ----------------------------------------------------------------------------

async function extractError(error: unknown, fallback: string): Promise<{ code: string; message: string; retry_after_seconds?: number; cooldown_until?: string }> {
  try {
    const err = error as Record<string, unknown> | null | undefined;
    if (!err) return { code: "EDGE_ERROR", message: fallback };
    const ctx = err.context as Response | undefined;
    if (ctx && typeof ctx.text === "function") {
      try {
        const raw = await ctx.text();
        try {
          const body = JSON.parse(raw);
          if (body?.protocol_version === 1 && typeof body.user_message === "string") {
            try {
              assertAriEnvelope(body, { allowUnattested: allowUnattestedRelease() });
              return {
                code: typeof body.code === "string" ? body.code : "EDGE_ERROR",
                message: body.user_message,
                ...(typeof body.retry_after_seconds === "number"
                  ? { retry_after_seconds: body.retry_after_seconds }
                  : {}),
              };
            } catch {
              return { code: "ENVELOPE_INVALID", message: fallback };
            }
          }
          if (body?.message && typeof body.message === "string") return {
            code: typeof body.code === "string" ? body.code : "EDGE_ERROR",
            message: body.message,
            ...(typeof body.retry_after_seconds === "number" ? { retry_after_seconds: body.retry_after_seconds } : {}),
            ...(typeof body.cooldown_until === "string" ? { cooldown_until: body.cooldown_until } : {}),
          };
          if (body?.error && typeof body.error === "string") return { code: typeof body.code === "string" ? body.code : "EDGE_ERROR", message: body.error };
        } catch {
          if (raw && raw.length < 300 && !raw.startsWith("<!")) return { code: "EDGE_ERROR", message: raw };
        }
      } catch {
        // fall through
      }
      const status = (ctx as Response).status;
      if (status === 401) return { code: "UNAUTHENTICATED", message: "Sign in again to continue with Ari." };
      if (status === 403) return { code: "FORBIDDEN", message: "Your current access does not allow this action." };
      if (status === 410) return { code: "STALE_PROPOSAL", message: "This proposal changed. Review the latest version before confirming." };
      if (status === 429) return { code: "RATE_LIMITED", message: "Ari is busy right now. Try again shortly." };
    }
    const msg = err.message;
    if (typeof msg === "string" && !msg.startsWith("Edge Function returned")) {
      return { code: "EDGE_ERROR", message: msg };
    }
  } catch {
    // ignore
  }
  return { code: "EDGE_ERROR", message: fallback };
}

// ----------------------------------------------------------------------------
// Calls
// ----------------------------------------------------------------------------

export async function sendAgentMessage(args: SendMessageArgs): Promise<AgentChatResponse> {
  const { data, error } = await supabase.functions.invoke<unknown>("agent-chat", {
    body: args,
  });
  if (error) {
    const typed = await extractError(error, "Ari couldn't respond — try again");
    return { kind: "error", ...typed };
  }
  if (!data) {
    return { kind: "error", code: "EMPTY", message: "Ari returned an empty response" };
  }
  return unwrapAriDomainPayload<Exclude<AgentChatResponse, { kind: "error" }>>(
    data,
    "Ari returned an empty response",
  ) as AgentChatResponse;
}

export async function confirmAgentAction(args: ConfirmActionArgs): Promise<AgentConfirmResponse> {
  const { data, error } = await supabase.functions.invoke<unknown>(
    "agent-confirm-action",
    { body: { action: "confirm", ...args } },
  );
  if (error) {
    const typed = await extractError(error, "Couldn't complete that action — try again");
    return { kind: "error", ...typed };
  }
  if (!data) {
    return { kind: "error", code: "EMPTY", message: "Empty response" };
  }
  return unwrapAriDomainPayload<Exclude<AgentConfirmResponse, { kind: "error" }>>(
    data,
    "Empty response",
  ) as AgentConfirmResponse;
}

export async function cancelAgentAction(
  pending_action_id: string,
): Promise<AgentConfirmResponse> {
  const { data, error } = await supabase.functions.invoke<unknown>(
    "agent-confirm-action",
    { body: { action: "cancel", pending_action_id } },
  );
  if (error) {
    const typed = await extractError(error, "Couldn't cancel — try again");
    return { kind: "error", ...typed };
  }
  if (!data) {
    return { kind: "error", code: "EMPTY", message: "Empty response" };
  }
  return unwrapAriDomainPayload<Exclude<AgentConfirmResponse, { kind: "error" }>>(
    data,
    "Empty response",
  ) as AgentConfirmResponse;
}

// ----------------------------------------------------------------------------
// DB reads (used by hooks)
// ----------------------------------------------------------------------------

export interface AgentConversation {
  id: string;
  title: string | null;
  brand_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "tool";
  content: { text?: string; structured?: unknown; local_delivery?: "sending" | "failed" } | Record<string, unknown>;
  client_turn_id: string | null;
  tool_calls: {
    tool_name: string;
    args: Record<string, unknown>;
    pending_action_id: string;
  } | null;
  tool_results: Record<string, unknown> | null;
  created_at: string;
}

export interface AgentUserProfileRow {
  user_id: string;
  display_name: string | null;
  preferred_timezone: string | null;
  preferred_currency: string | null;
  communication_style: "concise" | "detailed";
  autopilot_tools: string[];
  proactive_messages_enabled: boolean;
  ai_disclosure_acknowledged_at: string | null;
}

export async function fetchConversations(): Promise<AgentConversation[]> {
  const { data, error } = await supabase
    .from("agent_conversations")
    .select("id, title, brand_id, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as AgentConversation[];
}

export async function fetchMessages(conversationId: string): Promise<AgentMessage[]> {
  const { data, error } = await supabase
    .from("agent_messages")
    .select("id, conversation_id, role, content, tool_calls, tool_results, client_turn_id, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AgentMessage[];
}

export async function fetchProfile(): Promise<AgentUserProfileRow | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("agent_user_profile")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AgentUserProfileRow | null;
}

export async function upsertProfile(
  patch: Partial<Omit<AgentUserProfileRow, "user_id">>,
): Promise<AgentUserProfileRow> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("agent_user_profile")
    .upsert({ user_id: user.id, ...patch, updated_at: new Date().toISOString() })
    .select("*")
    .single();
  if (error) throw error;
  return data as AgentUserProfileRow;
}

export async function acknowledgeDisclosure(): Promise<void> {
  await upsertProfile({ ai_disclosure_acknowledged_at: new Date().toISOString() });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  // CASCADE removes messages + pending actions.
  // .select("id") chained per I-PROPOSED-I MUTATION-ROWCOUNT-VERIFIED — if
  // the conversation row doesn't exist (already deleted or RLS denial),
  // supabase-js without .select() silently treats 0-row delete as success.
  const { data, error } = await supabase
    .from("agent_conversations")
    .delete()
    .eq("id", conversationId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Conversation not found or already deleted");
  }
}

export async function deleteAllAriData(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  // CASCADE handles agent_messages and agent_pending_actions.
  // I-MUTATION-ROWCOUNT-WAIVER: ORCH-0821 delete-all-Ari-data is intentionally
  // tolerant of 0-row outcomes — a user who never used Ari has zero rows in
  // these tables, and the action is still semantically "deleted everything"
  // when there was nothing to delete. .select("id") is chained so the
  // rowcount IS verified at the supabase-js layer, but a 0-count return is
  // not treated as an error here.
  const conversationsResult = await supabase
    .from("agent_conversations")
    .delete()
    .eq("user_id", user.id)
    .select("id");
  if (conversationsResult.error) throw conversationsResult.error;
  // I-MUTATION-ROWCOUNT-WAIVER: ORCH-0821 — same rationale as above for
  // agent_user_profile (single-row table, may not exist for users who never
  // saw the AI disclosure modal).
  const profileResult = await supabase
    .from("agent_user_profile")
    .delete()
    .eq("user_id", user.id)
    .select("id");
  if (profileResult.error) throw profileResult.error;
}
