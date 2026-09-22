/**
 * ORCH-0821 — Ari edge function client.
 *
 * Wraps `agent-chat` and `agent-confirm-action` with typed responses and
 * graceful error extraction (mirrors the app-mobile edgeFunctionError pattern).
 * Issue #2060: responses are protocol-v1 envelopes; this module asserts them
 * and unwraps nested domain payloads so existing UI kinds keep working.
 */

import { supabase } from "./supabase";
import type { AriSentAttachment } from "./ariAttachmentService";
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
  | { kind: "text"; text: string; conversation_id: string; message_id: string; task_state_revision: number; client_turn_id: string; attempt_status: "completed"; conversation_title: string; choices?: AgentChoicesV2; handoff_route?: string }
  | {
      kind: "pending_action";
      pending_action_id: string;
      tool_name: string;
      tool_args: Record<string, unknown>;
      conversation_id: string;
      message_id: string;
      task_state_revision: number;
      client_turn_id: string;
      attempt_status: "completed";
      conversation_title: string;
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
  attachment_ids?: string[];
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
    if (err.name === "FunctionsFetchError") return { code: "TRANSPORT_UNAVAILABLE", message: fallback };
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
  title_source?: "legacy" | "provisional" | "generated" | "manual" | "legacy_fallback";
  title_generation_version?: string | null;
  title_generated_at?: string | null;
}

export interface AgentMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "tool";
  content: {
    text?: string;
    structured?: unknown;
    local_delivery?: "sending" | "sent" | "failed" | "stopped";
    local_error?: string;
    attachments?: AriSentAttachment[];
    local_reveal?: boolean;
  } | Record<string, unknown>;
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
    .select("id, title, brand_id, created_at, updated_at, title_source, title_generation_version, title_generated_at")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as AgentConversation[];
}

export async function fetchMessages(conversationId: string): Promise<AgentMessage[]> {
  const [messagesResult, attachmentsResult] = await Promise.all([
    supabase
    .from("agent_messages")
    .select("id, conversation_id, role, content, tool_calls, tool_results, client_turn_id, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true }),
    supabase
      .from("agent_attachments")
      .select("id,message_id,original_filename,verified_mime,file_type,verified_size_bytes,display_order,state")
      .eq("conversation_id", conversationId)
      .eq("state", "ready")
      .order("display_order", { ascending: true }),
  ]);
  if (messagesResult.error) throw messagesResult.error;
  if (attachmentsResult.error) throw attachmentsResult.error;
  const attachmentsByMessage = new Map<string, AriSentAttachment[]>();
  for (const row of attachmentsResult.data ?? []) {
    if (!row.message_id) continue;
    const current = attachmentsByMessage.get(row.message_id) ?? [];
    current.push({
      id: row.id,
      original_filename: row.original_filename,
      verified_mime: row.verified_mime,
      file_type: row.file_type as AriSentAttachment["file_type"],
      verified_size_bytes: row.verified_size_bytes,
      display_order: row.display_order,
      state: "ready",
    });
    attachmentsByMessage.set(row.message_id, current);
  }
  return (messagesResult.data ?? []).map((raw) => {
    const message = raw as AgentMessage;
    const attachments = attachmentsByMessage.get(message.id);
    if (!attachments?.length) return message;
    return { ...message, content: { ...message.content, attachments } };
  });
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
  const { data, error } = await supabase.functions.invoke<{ deleted?: boolean }>(
    "agent-conversation",
    { body: { action: "delete", conversation_id: conversationId } },
  );
  if (error || !data?.deleted) throw new Error("Conversation not found or already deleted");
}

export async function deleteAllAriData(): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ deleted?: boolean }>(
    "agent-conversation",
    { body: { action: "delete_all" } },
  );
  if (error || !data?.deleted) throw new Error("Couldn't delete Ari data");
}

export async function renameAgentConversation(
  conversationId: string,
  title: string,
): Promise<AgentConversation> {
  const { data, error } = await supabase.functions.invoke<{ conversation?: AgentConversation }>(
    "agent-conversation",
    { body: { action: "rename", conversation_id: conversationId, title } },
  );
  if (error || !data?.conversation) throw new Error("Couldn't rename this conversation.");
  return data.conversation;
}

export async function regenerateAgentConversationTitle(
  conversationId: string,
  confirmReplaceManual = false,
): Promise<AgentConversation> {
  const { data, error } = await supabase.functions.invoke<{
    conversation?: AgentConversation;
    code?: string;
    message?: string;
  }>("agent-conversation", {
    body: {
      action: "regenerate",
      conversation_id: conversationId,
      confirm_replace_manual: confirmReplaceManual,
    },
  });
  if (error || !data?.conversation) {
    throw new Error(data?.message ?? "Couldn’t update the title. Your previous title is unchanged.");
  }
  return data.conversation;
}
