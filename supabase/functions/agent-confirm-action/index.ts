// ORCH-0821 — agent-confirm-action
//
// SECURITY MODEL (do not modify without re-reviewing SPEC §10):
//   1. This is the ONLY function that calls tool executors that WRITE.
//   2. Atomic UPDATE-WHERE clauses prevent replay and double-execute attacks.
//   3. Tool executor uses the user's JWT — RLS enforces ownership; we also
//      pre-check FK ownership defensively before the executor runs.
//   4. Status transitions: pending -> executing -> (executed | failed)
//      pending -> cancelled (terminal). pending -> expired (terminal).

// deno-lint-ignore-file no-explicit-any
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { TENANT_CONTEXT_VERSION } from "../_shared/agentSystemPrompt.ts";
import { ARI_MODEL_VERSION } from "../_shared/agentGemini.ts";
import { findTool, ToolError } from "../_shared/agentTools.ts";
import { authorizeAgentTool } from "../_shared/agentToolAuthorization.ts";
import {
  TaskStateError,
  TaskStateV1,
  parseTaskState,
  reconcilePendingAction,
} from "../_shared/agentConversationState.ts";
import {
  AgentChoicesV2,
  assertAgentChoicesV2,
} from "../_shared/agentChoices.ts";
import {
  requireAccessibleAgentBrand,
  resolveAccessibleAgentBrands,
} from "../_shared/agentTenantScope.ts";

interface RequestBody {
  action: "confirm" | "cancel";
  pending_action_id: string;
  edited_args?: Record<string, unknown>;
}

type Response_ =
  | { kind: "executed"; pending_action_id: string; tool_name: string; result: unknown; followup_text?: string; task_state_revision?: number }
  | { kind: "cancelled"; pending_action_id: string }
  // META-ORCH-1009 Sub-E (C2): expired Hub proposal -> in-Hub regenerate CTA
  // instead of the old 410 "Ask Ari" dead-end (this Hub flow never uses Ari).
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

function jsonResponse(status: number, body: Response_): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { kind: "error", code, message });
}

interface ConversationTaskRow {
  id: string;
  brand_id: string | null;
  task_state: unknown;
  task_state_revision: number;
  summary: string | null;
}

function safeSummary(previous: string | null, event: string): string {
  const safePrevious = (previous ?? "")
    .split("\n")
    .filter((line) => line.startsWith("[task-v1] "))
    .join("\n")
    .slice(-1700);
  const safeEvent = event.replace(/[^A-Za-z0-9 _.,:;()\-]/g, "").slice(0, 240);
  return [safePrevious, `[task-v1] ${safeEvent}`].filter(Boolean).join("\n").slice(-2000);
}

function createdResource(toolName: string, result: unknown): { kind: string; id: string; label: string } | undefined {
  if (toolName !== "create_event" || result === null || typeof result !== "object") return undefined;
  const event = (result as { event?: unknown }).event;
  if (event === null || typeof event !== "object") return undefined;
  const id = (event as { id?: unknown }).id;
  const title = (event as { title?: unknown }).title;
  return typeof id === "string" && typeof title === "string"
    ? { kind: "event", id, label: title.slice(0, 240) }
    : undefined;
}

function proactiveChoices(resource: { kind: string; id: string; label: string } | undefined): AgentChoicesV2 | undefined {
  if (!resource || resource.kind !== "event") return undefined;
  return assertAgentChoicesV2({
    schema_version: 2,
    question_id: crypto.randomUUID(),
    kind: "next_step",
    prompt: "What would you like to do next?",
    required_slot_keys: [],
    options: [
      {
        id: "open_event_workspace",
        label: "Open event workspace",
        payload: { type: "handoff", route: `/event/${resource.id}` },
      },
      {
        id: "plan_another_event",
        label: "Plan another event",
        payload: { type: "task_command", command: "start_new" },
      },
    ],
  });
}

async function loadConversationTask(
  client: SupabaseClient,
  conversationId: string | null,
  userId: string,
): Promise<{ row: ConversationTaskRow; state: TaskStateV1 } | null> {
  if (!conversationId) return null;
  const { data, error } = await client.from("agent_conversations")
    .select("id, brand_id, task_state, task_state_revision, summary")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new TaskStateError("TASK_RECOVERY_REQUIRED", "Conversation task state is unavailable");
  const row = data as ConversationTaskRow;
  return { row, state: parseTaskState(row.task_state) };
}

async function persistTaskOutcome(args: {
  client: SupabaseClient;
  conversation: { row: ConversationTaskRow; state: TaskStateV1 } | null;
  pendingActionId: string;
  outcome: "executed" | "failed" | "cancelled" | "expired";
  toolName: string;
  result?: unknown;
  errorCode?: string;
  assistantMessageId?: string;
  choices?: AgentChoicesV2;
}): Promise<number | undefined> {
  if (!args.conversation || args.conversation.state.active_task?.pending_action_id !== args.pendingActionId) return undefined;
  const resource = createdResource(args.toolName, args.result);
  let next = reconcilePendingAction({
    state: args.conversation.state,
    pendingActionId: args.pendingActionId,
    outcome: args.outcome,
    nowIso: new Date().toISOString(),
    errorCode: args.errorCode,
    resource,
  });
  if (args.choices && args.assistantMessageId) {
    next = {
      ...next,
      pending_question: {
        question_id: args.choices.question_id,
        required_slot_keys: [],
        response_message_id: args.assistantMessageId,
        mode: "single",
        option_ids: args.choices.options.map((option) => option.id),
      },
    };
    parseTaskState(next);
  }
  const nextRevision = args.conversation.row.task_state_revision + 1;
  const { data, error } = await args.client.from("agent_conversations")
    .update({
      task_state: next,
      task_state_revision: nextRevision,
      task_state_updated_at: new Date().toISOString(),
      summary: safeSummary(args.conversation.row.summary, `Confirmation ${args.outcome} for ${args.toolName}.`),
      summary_updated_at: new Date().toISOString(),
      ...(args.assistantMessageId ? { summary_through_message_id: args.assistantMessageId } : {}),
    })
    .eq("id", args.conversation.row.id)
    .eq("task_state_revision", args.conversation.row.task_state_revision)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new TaskStateError("TASK_STATE_CONFLICT", "Task state changed during confirmation");
  return nextRevision;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "POST required");
  }

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (typeof body.pending_action_id !== "string") {
    return errorResponse(400, "BAD_REQUEST", "pending_action_id required");
  }
  if (body.action !== "confirm" && body.action !== "cancel") {
    return errorResponse(400, "BAD_REQUEST", "action must be 'confirm' or 'cancel'");
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse(401, "UNAUTHORIZED", "Missing authorization");
  }
  const jwt = authHeader.slice("Bearer ".length);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !supabaseAnonKey) {
    return errorResponse(500, "INTERNAL", "Supabase config missing");
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return errorResponse(401, "UNAUTHORIZED", "Invalid or expired session");
  }
  const userId = userData.user.id;

  // Load the pending action
  const { data: pending, error: pendingErr } = await userClient
    .from("agent_pending_actions")
    .select("id, conversation_id, tool_name, tool_args, status, expires_at, source, related_brand_id")
    .eq("id", body.pending_action_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (pendingErr || !pending) {
    return errorResponse(404, "NOT_FOUND", "Pending action not found");
  }
  let conversationTask: { row: ConversationTaskRow; state: TaskStateV1 } | null;
  try {
    conversationTask = await loadConversationTask(userClient, pending.conversation_id, userId);
    if (conversationTask?.row.brand_id) {
      const accessibleBrands = await resolveAccessibleAgentBrands(userClient, userId);
      requireAccessibleAgentBrand(accessibleBrands, conversationTask.row.brand_id);
      if (
        conversationTask.state.active_task &&
        conversationTask.state.active_task.brand_id !== conversationTask.row.brand_id
      ) {
        return errorResponse(409, "TASK_STATE_INVALID", "Ari couldn't safely continue this plan. Start a new chat or try again.");
      }
    }
  } catch (err: unknown) {
    if (err instanceof TaskStateError) {
      const status = err.code === "TASK_STATE_INVALID" ? 500 : 409;
      return errorResponse(status, err.code, err.code === "TASK_STATE_VERSION_UNSUPPORTED"
        ? "This chat is read-only. Start a new chat to continue."
        : "Ari needs to reconcile this action. Refresh the chat and try again.");
    }
    return errorResponse(403, "BRAND_ACCESS_DENIED", "You no longer have access to this conversation's brand.");
  }

  // CANCEL path
  if (body.action === "cancel") {
    if (pending.status !== "pending") {
      return errorResponse(400, "WRONG_STATE", `Cannot cancel — current status: ${pending.status}`);
    }
    const { data: cancelled, error: cancelErr } = await userClient
      .from("agent_pending_actions")
      .update({ status: "cancelled" })
      .eq("id", pending.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (cancelErr || !cancelled) {
      return errorResponse(500, "INTERNAL", `Cancel failed: ${cancelErr?.message ?? "state changed"}`);
    }
    // Ari-only audit trail in agent_messages (Hub proposals have no conversation).
    const toolMessageId = crypto.randomUUID();
    if (pending.conversation_id) {
      await userClient.from("agent_messages").insert({
        id: toolMessageId,
        conversation_id: pending.conversation_id,
        user_id: userId,
        role: "tool",
        content: { text: "" },
        tool_results: {
          tool_name: pending.tool_name,
          pending_action_id: pending.id,
          outcome: "cancelled",
        },
        prompt_version: TENANT_CONTEXT_VERSION,
        model_version: ARI_MODEL_VERSION,
      });
    }
    try {
      await persistTaskOutcome({
        client: userClient,
        conversation: conversationTask,
        pendingActionId: pending.id,
        outcome: "cancelled",
        toolName: pending.tool_name,
        assistantMessageId: pending.conversation_id ? toolMessageId : undefined,
      });
    } catch (err: unknown) {
      if (err instanceof TaskStateError) {
        return errorResponse(409, err.code, "The action was cancelled, but Ari needs a refresh to reconcile the plan.");
      }
      return errorResponse(409, "TASK_RECOVERY_REQUIRED", "The action was cancelled, but Ari needs a refresh to reconcile the plan.");
    }
    return jsonResponse(200, { kind: "cancelled", pending_action_id: pending.id });
  }

  // CONFIRM path
  if (pending.status !== "pending") {
    return errorResponse(400, "WRONG_STATE", `Cannot confirm — current status: ${pending.status}`);
  }
  if (new Date(pending.expires_at).getTime() < Date.now()) {
    // META-ORCH-1009 Sub-E (C2, SPEC §11.4): an expired Hub proposal must NOT
    // dead-end with a 410 "Ask Ari" redirect — this Hub flow never uses Ari.
    // Lazy-expire (preserves the I-ARI-PENDING-STATE-MACHINE pending->expired
    // transition) then return an in-Hub regenerate contract the client renders
    // as a "regenerate / re-snap" CTA instead of an Accept button that 410s.
    await userClient
      .from("agent_pending_actions")
      .update({ status: "expired" })
      .eq("id", pending.id)
      .eq("status", "pending");
    if (pending.conversation_id) {
      try {
        await persistTaskOutcome({
          client: userClient,
          conversation: conversationTask,
          pendingActionId: pending.id,
          outcome: "expired",
          toolName: pending.tool_name,
        });
      } catch (err: unknown) {
        if (err instanceof TaskStateError) {
          return errorResponse(409, err.code, "This proposal expired. Refresh the chat to continue the plan.");
        }
      }
    }
    return jsonResponse(200, {
      kind: "expired_regenerate",
      pending_action_id: pending.id,
      status: "expired",
      // Inputs the Hub re-snap path needs to regenerate the same proposal.
      parser_source: ((pending.tool_args as Record<string, unknown> | null)?.parser_source as string | null) ?? null,
      tool_name: pending.tool_name,
      brand_id: (pending.related_brand_id as string | null) ?? null,
      regenerate: {
        cta: "regenerate",
        title: "This suggestion expired",
        body: "Re-snap your menu or photos and we'll generate a fresh suggestion.",
      },
    });
  }

  // #2019: resolve and authorize final edited scope while still pending.
  const finalArgs = body.edited_args && typeof body.edited_args === "object"
    ? body.edited_args
    : (pending.tool_args as Record<string, unknown>);

  // Find tool + validate
  const tool = findTool(pending.tool_name);
  if (!tool) {
    await userClient
      .from("agent_pending_actions")
      .update({ status: "failed", failure_reason: "Unknown tool" })
      .eq("id", pending.id);
    return errorResponse(500, "INTERNAL", "Unknown tool");
  }

  try {
    await authorizeAgentTool(tool, finalArgs, userClient, userId);
  } catch (err: unknown) {
    const code = err instanceof ToolError ? err.code : "ROLE_CHECK_UNAVAILABLE";
    const status = code === "ROLE_CHECK_UNAVAILABLE" ? 503 : code === "INVALID_ARGS" ? 400 : 403;
    await userClient.from("agent_pending_actions")
      .update({ status: "failed", failure_reason: code })
      .eq("id", pending.id).eq("status", "pending");
    if (pending.conversation_id) {
      try {
        await persistTaskOutcome({
          client: userClient,
          conversation: conversationTask,
          pendingActionId: pending.id,
          outcome: "failed",
          toolName: pending.tool_name,
          errorCode: code,
        });
      } catch {
        return errorResponse(409, "TASK_RECOVERY_REQUIRED", "Permissions changed and the action was stopped. Refresh the chat to continue safely.");
      }
    }
    return errorResponse(status, code, code === "ROLE_CHECK_UNAVAILABLE"
      ? "Ari could not verify permissions right now"
      : "Your current access does not allow this action");
  }

  // Atomic flip pending -> executing only after final-argument authorization.
  const { data: flipped, error: flipErr } = await userClient
    .from("agent_pending_actions")
    .update({ status: "executing" })
    .eq("id", pending.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (flipErr || !flipped) {
    return errorResponse(409, "WRONG_STATE", "Race detected — this action was already handled");
  }

  // Execute
  let result: unknown;
  try {
    result = await tool.executor(finalArgs, userClient, userId);
  } catch (err: any) {
    const reason = err instanceof ToolError ? `${err.code}: ${err.message}` : (err?.message ?? "unknown");
    await userClient
      .from("agent_pending_actions")
      .update({ status: "failed", failure_reason: reason })
      .eq("id", pending.id);
    const failedMessageId = crypto.randomUUID();
    if (pending.conversation_id) {
      await userClient.from("agent_messages").insert({
        id: failedMessageId,
        conversation_id: pending.conversation_id,
        user_id: userId,
        role: "tool",
        content: { text: "" },
        tool_results: {
          tool_name: tool.name,
          pending_action_id: pending.id,
          outcome: "failed",
          reason,
        },
        prompt_version: TENANT_CONTEXT_VERSION,
        model_version: ARI_MODEL_VERSION,
      });
      try {
        await persistTaskOutcome({
          client: userClient,
          conversation: conversationTask,
          pendingActionId: pending.id,
          outcome: "failed",
          toolName: tool.name,
          errorCode: err instanceof ToolError ? err.code : "EXECUTION_FAILED",
          assistantMessageId: failedMessageId,
        });
      } catch {
        return errorResponse(409, "TASK_RECOVERY_REQUIRED", "The action failed safely, but Ari needs a refresh to continue the plan.");
      }
    }
    if (err instanceof ToolError) {
      // 4xx = recoverable validation errors that the user can resolve by
      // adjusting their request (rename the brand, pick a different event,
      // etc.). 5xx is reserved for genuine server-side issues.
      let status: number;
      if (["OWNERSHIP_DENIED", "ROLE_DENIED", "BRAND_ACCESS_DENIED"].includes(err.code)) status = 403;
      else if (err.code === "ROLE_CHECK_UNAVAILABLE") status = 503;
      else if (err.code === "INVALID_ARGS" || err.code === "SLUG_TAKEN") status = 400;
      // ORCH-1103 — delete refused because the brand has upcoming/live events.
      // Recoverable, user-actionable conflict (cancel/transfer first) → 409.
      else if (err.code === "DELETE_BLOCKED_BY_EVENTS") status = 409;
      else status = 500;
      return errorResponse(status, err.code, err.message);
    }
    return errorResponse(500, "EXECUTION_FAILED", String(reason));
  }

  // Mark executed
  const { error: doneErr } = await userClient
    .from("agent_pending_actions")
    .update({
      status: "executed",
      executed_at: new Date().toISOString(),
      executed_result: result as any,
    })
    .eq("id", pending.id);
  if (doneErr) {
    // The domain write succeeded but action bookkeeping did not. Never invite
    // a retry that could duplicate it; the next chat turn must reconcile.
    console.error("[agent-confirm-action] Failed to mark executed:", doneErr.message);
  }

  const toolMessageId = crypto.randomUUID();
  if (pending.conversation_id) {
    await userClient.from("agent_messages").insert({
      id: toolMessageId,
      conversation_id: pending.conversation_id,
      user_id: userId,
      role: "tool",
      content: { text: "" },
      tool_results: {
        tool_name: tool.name,
        pending_action_id: pending.id,
        outcome: "executed",
        result,
      },
      prompt_version: TENANT_CONTEXT_VERSION,
      model_version: ARI_MODEL_VERSION,
    });
  }

  const followupText = buildFollowupText(tool.name, result);
  const resource = createdResource(tool.name, result);
  const choices = proactiveChoices(resource);
  const assistantMessageId = crypto.randomUUID();
  if (followupText && pending.conversation_id) {
    await userClient.from("agent_messages").insert({
      id: assistantMessageId,
      conversation_id: pending.conversation_id,
      user_id: userId,
      role: "assistant",
      content: {
        text: followupText,
        ...(choices ? { structured: { choices } } : {}),
      },
      prompt_version: TENANT_CONTEXT_VERSION,
      model_version: ARI_MODEL_VERSION,
    });
  }

  let nextTaskRevision: number | undefined;
  if (!doneErr) {
    try {
      nextTaskRevision = await persistTaskOutcome({
        client: userClient,
        conversation: conversationTask,
        pendingActionId: pending.id,
        outcome: "executed",
        toolName: tool.name,
        result,
        assistantMessageId: followupText && pending.conversation_id ? assistantMessageId : toolMessageId,
        choices,
      });
    } catch (err: unknown) {
      if (err instanceof TaskStateError) {
        return errorResponse(409, "TASK_RECOVERY_REQUIRED", "The action completed once, but Ari needs a refresh to reconcile the plan.");
      }
      return errorResponse(409, "TASK_RECOVERY_REQUIRED", "The action completed once, but Ari needs a refresh to reconcile the plan.");
    }
  } else {
    return errorResponse(409, "TASK_RECOVERY_REQUIRED", "The action completed once, but Ari needs a refresh to reconcile the plan.");
  }

  return jsonResponse(200, {
    kind: "executed",
    pending_action_id: pending.id,
    tool_name: tool.name,
    result,
    followup_text: followupText,
    ...(nextTaskRevision !== undefined ? { task_state_revision: nextTaskRevision } : {}),
  });
});

function buildFollowupText(toolName: string, result: unknown): string | undefined {
  try {
    if (toolName === "create_brand") {
      const name = (result as any)?.brand?.name;
      if (!name) return undefined;
      const base = `Created brand "${name}". Want to schedule an event under it?`;
      // ORCH-1103 — if this became the user's current brand, say so.
      return (result as any)?.set_as_default
        ? `${base} It's now your current brand.`
        : base;
    }
    if (toolName === "update_brand") {
      const name = (result as any)?.brand?.name;
      return name ? `Updated "${name}". Anything else?` : `Updated. Anything else?`;
    }
    if (toolName === "delete_brand") {
      return `Deleted that brand. It's recoverable for 30 days through support if you change your mind.`;
    }
    if (toolName === "create_event") {
      const title = (result as any)?.event?.title;
      return title
        ? `Created “${title}” as a draft. Open the event workspace to refine tickets, publishing, and promotion when you're ready.`
        : undefined;
    }
    if (toolName === "update_event") {
      return `Updated. Anything else to change?`;
    }
    if (toolName === "create_experience") {
      const title = (result as any)?.event?.title;
      return title ? `Published experience "${title}" to your venue.` : undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}
