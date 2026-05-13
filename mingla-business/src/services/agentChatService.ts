/**
 * ORCH-0821 — Ari edge function client.
 *
 * Wraps `agent-chat` and `agent-confirm-action` with typed responses and
 * graceful error extraction (mirrors the app-mobile edgeFunctionError pattern).
 */

import { supabase } from "./supabase";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type AgentChatResponse =
  | { kind: "text"; text: string; conversation_id: string; message_id: string }
  | {
      kind: "pending_action";
      pending_action_id: string;
      tool_name: string;
      tool_args: Record<string, unknown>;
      conversation_id: string;
      message_id: string;
    }
  | { kind: "error"; code: string; message: string };

export type AgentConfirmResponse =
  | {
      kind: "executed";
      pending_action_id: string;
      tool_name: string;
      result: unknown;
      followup_text?: string;
    }
  | { kind: "cancelled"; pending_action_id: string }
  | { kind: "error"; code: string; message: string };

export interface SendMessageArgs {
  conversation_id: string | null;
  message: string;
  brand_id?: string | null;
}

export interface ConfirmActionArgs {
  pending_action_id: string;
  edited_args?: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Error extraction (mirrors app-mobile/src/utils/edgeFunctionError.ts)
// ----------------------------------------------------------------------------

async function extractError(error: unknown, fallback: string): Promise<string> {
  try {
    const err = error as Record<string, unknown> | null | undefined;
    if (!err) return fallback;
    const ctx = err.context as Response | undefined;
    if (ctx && typeof ctx.text === "function") {
      try {
        const raw = await ctx.text();
        try {
          const body = JSON.parse(raw);
          if (body?.message && typeof body.message === "string") return body.message;
          if (body?.error && typeof body.error === "string") return body.error;
        } catch {
          if (raw && raw.length < 300 && !raw.startsWith("<!")) return raw;
        }
      } catch {
        // fall through
      }
      const status = (ctx as Response).status;
      if (status === 401) return "Session expired — please sign in again";
      if (status === 403) return "Not authorized for this action";
      if (status === 410) return "This proposal expired. Ask Ari to propose it again.";
      if (status === 429) return "You've reached today's chat limit — try again later";
    }
    const msg = err.message;
    if (typeof msg === "string" && !msg.startsWith("Edge Function returned")) {
      return msg;
    }
  } catch {
    // ignore
  }
  return fallback;
}

// ----------------------------------------------------------------------------
// Calls
// ----------------------------------------------------------------------------

export async function sendAgentMessage(args: SendMessageArgs): Promise<AgentChatResponse> {
  const { data, error } = await supabase.functions.invoke<AgentChatResponse>("agent-chat", {
    body: args,
  });
  if (error) {
    const message = await extractError(error, "Ari couldn't respond — try again");
    return { kind: "error", code: "EDGE_ERROR", message };
  }
  if (!data) {
    return { kind: "error", code: "EMPTY", message: "Ari returned an empty response" };
  }
  return data;
}

export async function confirmAgentAction(args: ConfirmActionArgs): Promise<AgentConfirmResponse> {
  const { data, error } = await supabase.functions.invoke<AgentConfirmResponse>(
    "agent-confirm-action",
    { body: { action: "confirm", ...args } },
  );
  if (error) {
    const message = await extractError(error, "Couldn't complete that action — try again");
    return { kind: "error", code: "EDGE_ERROR", message };
  }
  if (!data) {
    return { kind: "error", code: "EMPTY", message: "Empty response" };
  }
  return data;
}

export async function cancelAgentAction(
  pending_action_id: string,
): Promise<AgentConfirmResponse> {
  const { data, error } = await supabase.functions.invoke<AgentConfirmResponse>(
    "agent-confirm-action",
    { body: { action: "cancel", pending_action_id } },
  );
  if (error) {
    const message = await extractError(error, "Couldn't cancel — try again");
    return { kind: "error", code: "EDGE_ERROR", message };
  }
  if (!data) {
    return { kind: "error", code: "EMPTY", message: "Empty response" };
  }
  return data;
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
  content: { text?: string; structured?: unknown } | Record<string, unknown>;
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
    .select("id, conversation_id, role, content, tool_calls, tool_results, created_at")
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
