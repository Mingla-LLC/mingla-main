// ORCH-0821 — agent-chat
//
// SECURITY MODEL (do not modify without re-reviewing SPEC §10):
//   1. Every request requires a valid user JWT.
//   2. Tool executors use the caller's JWT — NEVER service role. Service role
//      appears here ONLY for rate-limit reads via _shared/agentRateLimit.ts.
//   3. The model PROPOSES writes; agent-confirm-action EXECUTES them. This
//      function NEVER calls a write tool executor directly.
//   4. User-stored content is wrapped in <user_data> delimiters before being
//      sent to Gemini (I-ARI-USER-DATA-WRAP).

// deno-lint-ignore-file no-explicit-any
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import {
  AgentUserProfile,
  BrandSummary,
  buildSystemPrompt,
  BusinessContext,
  OfferingSummary,
  TENANT_CONTEXT_VERSION,
} from "../_shared/agentSystemPrompt.ts";
import { detectPromptInjection } from "../_shared/agentPromptInjection.ts";
import {
  ARI_MODEL_VERSION,
  callGemini,
  GeminiContentMessage,
  GeminiError,
} from "../_shared/agentGemini.ts";
import {
  AGENT_TOOLS,
  bindAgentProposalState,
  canonicalizeAgentProposalArgs,
  findTool,
  isReadOnlyAgentToolCall,
  ToolError,
} from "../_shared/agentTools.ts";
import { authorizeAgentTool } from "../_shared/agentToolAuthorization.ts";
import {
  buildServiceClient,
  enforceTurnRateLimit,
} from "../_shared/agentRateLimit.ts";
import {
  AgentChoiceSubmissionV2,
  AgentChoicesV2,
  assertAgentChoicesV2,
  validateAgentChoicesV2,
  validateChoiceSubmission,
} from "../_shared/agentChoices.ts";
import {
  preflightTicketPricingProposal,
  verifiedProposalArgs,
} from "../_shared/agentTicketPricing.ts";
import { logError } from "../_shared/structuredLog.ts";
import {
  AccessibleAgentBrand,
  requireAccessibleAgentBrand,
  resolveAccessibleAgentBrands,
} from "../_shared/agentTenantScope.ts";
import {
  beginInterruption,
  IDLE_TASK_STATE,
  markAwaitingConfirmation,
  parseTaskState,
  pendingQuestionPrompt,
  reconcilePendingAction,
  resumeInterruption,
  TaskStateError,
  TaskStateV1,
} from "../_shared/agentConversationState.ts";
import {
  applyStoredChoice,
  isCreateEventPlanningRequest,
  isReadInterruption,
  planEventTurn,
  PlannerClassification,
  PlannerContext,
} from "../_shared/agentConversationPlanner.ts";
import {
  chooseEffectiveTimezone,
  plannerClockContext,
} from "../_shared/agentRelativeTime.ts";
import {
  ariErrorResponse,
  ariJsonResponse,
  emitAriPhase,
  runWithAriRequest,
  updateAriRequest,
} from "../_shared/agentReliabilityHttp.ts";

const MAX_MESSAGE_LENGTH = 4096;
const HISTORY_WINDOW = 10;
const WALL_CLOCK_TIMEOUT_MS = 60_000;

interface RequestBody {
  conversation_id: string | null;
  message?: string;
  brand_id?: string | null;
  client_turn_id: string;
  client_timezone?: string | null;
  locale?: string | null;
  choice_response?: AgentChoiceSubmissionV2;
}

type Response_ =
  | {
    kind: "text";
    text: string;
    conversation_id: string;
    message_id: string;
    task_state_revision: number;
    choices?: AgentChoicesV2;
    handoff_route?: string;
  }
  | {
    kind: "pending_action";
    pending_action_id: string;
    tool_name: string;
    tool_args: Record<string, unknown>;
    conversation_id: string;
    message_id: string;
    task_state_revision: number;
  }
  | {
    kind: "error";
    code: string;
    message: string;
    retry_after_seconds?: number;
    cooldown_until?: string;
  };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ConversationRow {
  id: string;
  summary: string | null;
  brand_id: string | null;
  task_state: unknown;
  task_state_revision: number;
}

function taskStateResponse(err: TaskStateError): Response {
  const status = err.code === "TASK_STATE_INVALID" ? 500 : 409;
  const messages: Record<string, string> = {
    TASK_STATE_INVALID:
      "Ari couldn't safely continue this plan. Start a new chat or try again.",
    TASK_STATE_VERSION_UNSUPPORTED:
      "This chat is read-only because its planning format is newer. Start a new chat to continue.",
    TASK_STATE_CONFLICT:
      "This plan changed in another session. Review the latest message and try again.",
    CHOICE_STALE:
      "That choice is no longer active. Review the latest question and try again.",
    TIMEZONE_REQUIRED: err.message,
    TASK_RECOVERY_REQUIRED:
      "Ari needs to reconcile the latest action. Refresh this chat and try again.",
  };
  return errorResponse(status, err.code, messages[err.code] ?? err.message);
}

function appendSafeSummary(previous: string | null, event: string): string {
  const safePrevious = (previous ?? "")
    .split("\n")
    .filter((line) => line.startsWith("[task-v1] "))
    .join("\n")
    .slice(-1700);
  const safeEvent = event.replace(/[^A-Za-z0-9 _.,:;()\-]/g, "").slice(0, 240);
  return [safePrevious, `[task-v1] ${safeEvent}`].filter(Boolean).join("\n")
    .slice(-2000);
}

function taskResourceFromResult(
  toolName: string,
  result: unknown,
): { kind: string; id: string; label: string } | undefined {
  if (
    toolName !== "create_event" || result === null || typeof result !== "object"
  ) return undefined;
  const event = (result as { event?: unknown }).event;
  if (event === null || typeof event !== "object") return undefined;
  const id = (event as { id?: unknown }).id;
  const title = (event as { title?: unknown }).title;
  return typeof id === "string" && typeof title === "string"
    ? { kind: "event", id, label: title.slice(0, 240) }
    : undefined;
}

function stateSummaryEvent(classification: string, state: TaskStateV1): string {
  if (state.active_task?.intent === "create_event") {
    const resolved = Object.entries(state.active_task.slots)
      .filter(([, slot]) => slot.status === "resolved")
      .map(([key]) => key)
      .join(", ");
    return `Event planning ${classification}; status ${state.status}; resolved fields: ${
      resolved || "none"
    }.`;
  }
  return classification === "read_interruption"
    ? "A tenant-scoped read question was answered."
    : "A general Ari turn completed.";
}

function emitTaskEvent(args: {
  intent: string | null;
  from: string;
  to: string;
  revision: number;
  classification: string;
  choiceKind?: string;
  resumed: boolean;
  errorCode?: string;
  startedAt: number;
  success: boolean;
}): void {
  const latency = Date.now() - args.startedAt;
  console.log(
    "[agent-chat] task event",
    JSON.stringify({
      fn_revision: "1985-v1",
      task_intent: args.intent,
      from_status: args.from,
      to_status: args.to,
      state_schema_version: 1,
      state_revision: args.revision,
      turn_classification: args.classification,
      choice_kind: args.choiceKind ?? null,
      interruption_resumed: args.resumed,
      error_code: args.errorCode ?? null,
      latency_bucket: latency < 250
        ? "lt250ms"
        : latency < 1000
        ? "lt1s"
        : latency < 5000
        ? "lt5s"
        : "gte5s",
      outcome: args.success ? "success" : "failure",
    }),
  );
}

async function commitTaskAssistantTurn(args: {
  client: SupabaseClient;
  userId: string;
  conversationId: string;
  expectedRevision: number;
  nextState: TaskStateV1;
  summary: string;
  assistantMessageId: string;
  content: Record<string, unknown>;
  toolCalls?: Record<string, unknown>;
  clientTurnId?: string;
  nowIso: string;
}): Promise<{ won: boolean; error: string | null }> {
  const { data, error } = await args.client
    .rpc("commit_agent_task_assistant_turn", {
      p_user_id: args.userId,
      p_conversation_id: args.conversationId,
      p_expected_revision: args.expectedRevision,
      p_task_state: args.nextState,
      p_summary: args.summary,
      p_assistant_message_id: args.assistantMessageId,
      p_content: args.content,
      p_tool_calls: args.toolCalls ?? null,
      p_client_turn_id: args.clientTurnId ?? null,
      p_prompt_version: TENANT_CONTEXT_VERSION,
      p_model_version: ARI_MODEL_VERSION,
      p_now: args.nowIso,
    });
  if (error) return { won: false, error: error.message };
  return { won: data === true, error: null };
}

async function terminalizeProposalForTaskReplacement(args: {
  pendingClient: SupabaseClient;
  userId: string;
  conversationId: string;
  pendingActionId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: cancelled, error: cancelError } = await args.pendingClient
    .from("agent_pending_actions")
    .update({
      status: "cancelled",
      failure_reason: "TASK_REPLACED_BY_NEW_TASK",
    })
    .eq("id", args.pendingActionId)
    .eq("user_id", args.userId)
    .eq("conversation_id", args.conversationId)
    .eq("status", "pending")
    .select("id, tool_name")
    .maybeSingle();
  if (cancelError || !cancelled) {
    return {
      ok: false,
      message:
        "The current proposal changed before Ari could pause it. Refresh and review the latest plan.",
    };
  }
  const { error: terminalError } = await args.pendingClient
    .from("agent_messages")
    .insert({
      conversation_id: args.conversationId,
      user_id: args.userId,
      role: "tool",
      content: { text: "" },
      tool_results: {
        tool_name: cancelled.tool_name,
        pending_action_id: args.pendingActionId,
        outcome: "cancelled",
        reason: "task_replaced",
      },
      prompt_version: TENANT_CONTEXT_VERSION,
      model_version: ARI_MODEL_VERSION,
    });
  if (terminalError) {
    return {
      ok: false,
      message:
        "Ari paused the old proposal, but needs a refresh before starting the new plan.",
    };
  }
  return { ok: true };
}

async function commitTextTurn(args: {
  client: SupabaseClient;
  userId: string;
  conversationId: string;
  clientTurnId: string;
  previousState: TaskStateV1;
  nextState: TaskStateV1;
  expectedRevision: number;
  previousSummary: string | null;
  text: string;
  classification: string;
  startedAt: number;
  choices?: AgentChoicesV2;
  handoffRoute?: string;
  structuredData?: Record<string, unknown>;
  resumed?: boolean;
}): Promise<Response> {
  const assistantMessageId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const finalState: TaskStateV1 =
    args.choices && args.nextState.pending_question
      ? {
        ...args.nextState,
        pending_question: {
          ...args.nextState.pending_question,
          response_message_id: assistantMessageId,
        },
      }
      : args.nextState;
  try {
    parseTaskState(finalState);
  } catch (err: unknown) {
    return err instanceof TaskStateError
      ? taskStateResponse(err)
      : errorResponse(
        500,
        "TASK_STATE_INVALID",
        "Ari couldn't safely continue this plan. Start a new chat or try again.",
      );
  }
  const summary = appendSafeSummary(
    args.previousSummary,
    stateSummaryEvent(args.classification, finalState),
  );
  const content = {
    text: args.text,
    ...((args.choices || args.handoffRoute || args.structuredData)
      ? {
        structured: {
          ...(args.structuredData ?? {}),
          ...(args.choices ? { choices: args.choices } : {}),
          ...(args.handoffRoute ? { handoff_route: args.handoffRoute } : {}),
        },
      }
      : {}),
  };
  const committed = await commitTaskAssistantTurn({
    client: args.client,
    userId: args.userId,
    conversationId: args.conversationId,
    expectedRevision: args.expectedRevision,
    nextState: finalState,
    summary,
    assistantMessageId,
    content,
    clientTurnId: args.clientTurnId,
    nowIso,
  });
  if (!committed.won) {
    emitTaskEvent({
      intent: args.previousState.active_task?.intent ?? null,
      from: args.previousState.status,
      to: args.previousState.status,
      revision: args.expectedRevision,
      classification: args.classification,
      resumed: args.resumed === true,
      errorCode: committed.error
        ? "TASK_RECOVERY_REQUIRED"
        : "TASK_STATE_CONFLICT",
      startedAt: args.startedAt,
      success: false,
    });
    return taskStateResponse(
      new TaskStateError(
        committed.error ? "TASK_RECOVERY_REQUIRED" : "TASK_STATE_CONFLICT",
        committed.error ?? "Task state changed",
      ),
    );
  }
  emitTaskEvent({
    intent: finalState.active_task?.intent ?? null,
    from: args.previousState.status,
    to: finalState.status,
    revision: args.expectedRevision + 1,
    classification: args.classification,
    choiceKind: args.choices?.kind,
    resumed: args.resumed === true,
    startedAt: args.startedAt,
    success: true,
  });
  return jsonResponse(200, {
    kind: "text",
    text: args.text,
    conversation_id: args.conversationId,
    message_id: assistantMessageId,
    task_state_revision: args.expectedRevision + 1,
    ...(args.choices ? { choices: args.choices } : {}),
    ...(args.handoffRoute ? { handoff_route: args.handoffRoute } : {}),
  });
}

function jsonResponse(status: number, body: Response_): Response {
  return ariJsonResponse(status, body);
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  recovery?: { retry_after_seconds?: number; cooldown_until?: string },
): Response {
  // Legacy `message` is intentionally discarded — registry owns user_message.
  return ariErrorResponse(status, code, message, recovery);
}

function tenantScopeResponse(
  status: number,
  code: string,
  message: string,
  scopeState: "new" | "bound" | "legacy",
  requestBrandSupplied: boolean,
  accessibleBrandCount: number,
): Response {
  // Intentionally excludes user/brand/conversation IDs, names, messages,
  // prompts, args, and results.
  console.warn(
    "[agent-chat] tenant scope stopped",
    JSON.stringify({
      fn: "agent-chat",
      revision: "2013",
      code,
      scope_state: scopeState,
      request_brand_supplied: requestBrandSupplied,
      accessible_brand_count: accessibleBrandCount,
    }),
  );
  return errorResponse(status, code, message);
}

function schemaErrorResponse(err: unknown): Response | null {
  const geminiError = err as Partial<GeminiError>;
  if (geminiError?.kind !== "schema") return null;
  // Schema errors contain only static tool names, JSON pointers, keywords,
  // and classifications. Never log the schema value, prompt, or user data.
  console.error("[agent-chat] Ari provider schema error:", geminiError.message);
  return errorResponse(
    500,
    "MODEL_SCHEMA_INVALID",
    "Ari's tools need an update before chat can continue. Please try again later.",
  );
}

Deno.serve(async (req) => {
  return await runWithAriRequest({
    requestIdHeader: req.headers.get("x-request-id"),
  }, async () => {
    emitAriPhase("received", { operationState: "sending" });
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return errorResponse(405, "METHOD_NOT_ALLOWED", "POST required");
    }

    // Race the handler against a wall-clock timeout
    const timeout = new Promise<Response>((resolve) =>
      setTimeout(
        () =>
          resolve(
            errorResponse(
              504,
              "TIMEOUT",
              "Ari is taking too long — try again",
            ),
          ),
        WALL_CLOCK_TIMEOUT_MS,
      )
    );

    // Top-level safety net — without this, an uncaught exception in handle()
    // returns Deno's default 500 with no body, leaving the client with a
    // generic "Edge Function returned a non-2xx status code". Exception text
    // stays in structured logs only; the envelope never echoes it.
    const wrapped = handle(req).catch((err: unknown) => {
      logError("agent-chat uncaught handler error", err, { fn: "agent-chat" });
      return errorResponse(500, "HANDLER_THREW", "agent-chat threw");
    });

    return await Promise.race([wrapped, timeout]);
  });
});

async function handle(req: Request): Promise<Response> {
  const turnStartedAt = Date.now();
  const requestNow = new Date();
  // Parse + validate body
  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  const choiceSubmission = body.choice_response === undefined
    ? null
    : validateChoiceSubmission(body.choice_response);
  if (body.choice_response !== undefined && !choiceSubmission) {
    return errorResponse(400, "BAD_REQUEST", "choice_response is invalid");
  }
  if (
    !choiceSubmission &&
    (typeof body.message !== "string" || body.message.trim().length === 0)
  ) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "message or choice_response is required",
    );
  }
  if (
    typeof body.message === "string" && body.message.length > MAX_MESSAGE_LENGTH
  ) {
    return errorResponse(
      400,
      "MESSAGE_TOO_LONG",
      `Messages must be ≤ ${MAX_MESSAGE_LENGTH} characters`,
    );
  }
  if (
    typeof body.client_turn_id !== "string" ||
    !UUID_PATTERN.test(body.client_turn_id)
  ) {
    return errorResponse(400, "BAD_REQUEST", "client_turn_id must be a UUID");
  }
  updateAriRequest({ clientTurnId: body.client_turn_id });
  const requestMessage = typeof body.message === "string"
    ? body.message.trim()
    : "";

  // Auth — extract JWT from Authorization header and build user-scoped client
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
  emitAriPhase("authorized", { operationState: "sending" });

  // Rate limit — uses service role (system table reads only)
  let serviceClient: SupabaseClient;
  try {
    serviceClient = buildServiceClient();
  } catch {
    return errorResponse(500, "INTERNAL", "Server misconfigured");
  }

  const rateLimit = await enforceTurnRateLimit(userId, serviceClient);
  if (!rateLimit.allowed) {
    const message = rateLimit.reason === "rate_limited_inflight"
      ? "Another action is currently being processed — please wait a moment"
      : "You've reached today's chat limit. Resets in 24 hours.";
    const cooldownUntil = rateLimit.resetAt ??
      new Date(Date.now() + 5_000).toISOString();
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((Date.parse(cooldownUntil) - Date.now()) / 1000),
    );
    return errorResponse(429, "RATE_LIMITED", message, {
      retry_after_seconds: retryAfterSeconds,
      cooldown_until: cooldownUntil,
    });
  }

  // #2013: resolve private tenant scope before conversation/model/message/tool work.
  let accessibleBrands: AccessibleAgentBrand[];
  try {
    accessibleBrands = await resolveAccessibleAgentBrands(userClient, userId);
  } catch (_error) {
    console.error(
      "[agent-chat] tenant scope denied",
      JSON.stringify({
        fn: "agent-chat",
        revision: "2013",
        code: "TENANT_SCOPE_UNAVAILABLE",
        scope_state: body.conversation_id ? "bound_or_legacy" : "new",
        request_brand_supplied: typeof body.brand_id === "string",
      }),
    );
    return errorResponse(
      503,
      "TENANT_SCOPE_UNAVAILABLE",
      "Ari couldn't verify your brand access. Try again.",
    );
  }

  // A response can be lost after a first turn creates its conversation. The
  // retry still has no conversation_id, so recover it from the caller-owned
  // user row before deciding to create another conversation. The brand checks
  // below then run exactly as for an explicitly supplied conversation.
  if (!body.conversation_id) {
    const { data: recoveredTurn } = await userClient.from("agent_messages")
      .select("conversation_id")
      .eq("user_id", userId)
      .eq("role", "user")
      .eq("client_turn_id", body.client_turn_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recoveredTurn?.conversation_id) {
      body.conversation_id = recoveredTurn.conversation_id;
    }
  }

  // Prompt injection detection (flag but do not refuse)
  const injection = detectPromptInjection(requestMessage);

  // Load or create conversation
  let conversationId: string;
  let conversationSummary: string | null = null;
  let activeBrand: AccessibleAgentBrand | null = null;
  let taskState = IDLE_TASK_STATE;
  let taskStateRevision = 0;
  if (body.conversation_id) {
    const { data: convo, error: convoErr } = await userClient
      .from("agent_conversations")
      .select("id, summary, brand_id")
      .eq("id", body.conversation_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (convoErr || !convo) {
      return errorResponse(
        404,
        "CONVERSATION_NOT_FOUND",
        "Conversation not found",
      );
    }
    const conversation = convo as Pick<
      ConversationRow,
      "id" | "summary" | "brand_id"
    >;
    conversationId = conversation.id;
    conversationSummary = typeof conversation.summary === "string"
      ? conversation.summary
      : null;
    const storedBrandId = conversation.brand_id ?? null;
    if (storedBrandId) {
      try {
        activeBrand = requireAccessibleAgentBrand(
          accessibleBrands,
          storedBrandId,
        );
      } catch {
        return tenantScopeResponse(
          403,
          "BRAND_ACCESS_DENIED",
          "You no longer have access to this conversation's brand.",
          "bound",
          typeof body.brand_id === "string",
          accessibleBrands.length,
        );
      }
      if (body.brand_id !== storedBrandId) {
        return tenantScopeResponse(
          409,
          "CONVERSATION_BRAND_MISMATCH",
          "This conversation belongs to a different brand. Start a new chat for the selected brand.",
          "bound",
          typeof body.brand_id === "string",
          accessibleBrands.length,
        );
      }
    } else if (accessibleBrands.length > 0) {
      return tenantScopeResponse(
        409,
        "LEGACY_CONVERSATION_UNSCOPED",
        "This older conversation is read-only. Start a new chat for the selected brand.",
        "legacy",
        typeof body.brand_id === "string",
        accessibleBrands.length,
      );
    } else if (body.brand_id) {
      return tenantScopeResponse(
        403,
        "BRAND_ACCESS_DENIED",
        "That brand is not available to this account.",
        "legacy",
        true,
        accessibleBrands.length,
      );
    }
    const { data: taskRow, error: taskErr } = await userClient
      .from("agent_conversations")
      .select("task_state, task_state_revision")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (taskErr || !taskRow) {
      return errorResponse(
        500,
        "TASK_STATE_INVALID",
        "Ari couldn't safely load this plan. Try again.",
      );
    }
    try {
      taskState = parseTaskState(taskRow.task_state);
      taskStateRevision = taskRow.task_state_revision;
    } catch (err: unknown) {
      if (err instanceof TaskStateError) return taskStateResponse(err);
      return errorResponse(
        500,
        "TASK_STATE_INVALID",
        "Ari couldn't safely continue this plan. Start a new chat or try again.",
      );
    }
  } else {
    if (accessibleBrands.length > 0 && !body.brand_id) {
      return tenantScopeResponse(
        409,
        "BRAND_CONTEXT_REQUIRED",
        "Select a brand before starting a new Ari chat.",
        "new",
        false,
        accessibleBrands.length,
      );
    }
    if (body.brand_id) {
      try {
        activeBrand = requireAccessibleAgentBrand(
          accessibleBrands,
          body.brand_id,
        );
      } catch {
        return tenantScopeResponse(
          403,
          "BRAND_ACCESS_DENIED",
          "That brand is not available to this account.",
          "new",
          true,
          accessibleBrands.length,
        );
      }
    }
    const firstTurnContent = {
      text: requestMessage,
      ...(choiceSubmission
        ? {
          structured: {
            choice_submission: {
              question_id: choiceSubmission.question_id,
              option_ids: choiceSubmission.option_ids,
            },
          },
        }
        : {}),
    };
    const { data: claimedRows, error: claimError } = await userClient.rpc(
      "claim_agent_first_turn",
      {
        p_brand_id: body.brand_id ?? null,
        p_client_turn_id: body.client_turn_id,
        p_content: firstTurnContent,
        p_prompt_version: TENANT_CONTEXT_VERSION,
        p_model_version: ARI_MODEL_VERSION,
      },
    );
    const claimed = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows;
    if (
      claimError || !claimed ||
      typeof claimed.conversation_id !== "string" ||
      typeof claimed.message_id !== "string"
    ) {
      return errorResponse(
        claimError?.code === "40001" ? 409 : 500,
        claimError?.code === "40001" ? "TASK_STATE_CONFLICT" : "INTERNAL",
        claimError?.code === "40001"
          ? "This first message is already being processed. Retry in a moment."
          : "Failed to start this conversation safely.",
      );
    }
    conversationId = claimed.conversation_id;
    if (claimed.created !== true) {
      const { data: recoveredConversation, error: recoveredConversationError } =
        await userClient.from("agent_conversations")
          .select("summary, brand_id")
          .eq("id", conversationId)
          .eq("user_id", userId)
          .single();
      if (recoveredConversationError || !recoveredConversation) {
        return errorResponse(
          500,
          "INTERNAL",
          "Failed to recover this conversation safely.",
        );
      }
      if (
        (recoveredConversation.brand_id ?? null) !== (body.brand_id ?? null)
      ) {
        return tenantScopeResponse(
          409,
          "CONVERSATION_BRAND_MISMATCH",
          "This retry belongs to a different brand conversation.",
          "bound",
          typeof body.brand_id === "string",
          accessibleBrands.length,
        );
      }
      conversationSummary = typeof recoveredConversation.summary === "string"
        ? recoveredConversation.summary
        : null;
    }
    const { data: taskRow, error: taskErr } = await userClient.from(
      "agent_conversations",
    )
      .select("task_state, task_state_revision")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .single();
    if (taskErr || !taskRow) {
      return errorResponse(
        500,
        "TASK_STATE_INVALID",
        "Ari couldn't safely start this plan. Try again.",
      );
    }
    try {
      taskState = parseTaskState(taskRow.task_state);
      taskStateRevision = taskRow.task_state_revision;
    } catch (err: unknown) {
      if (err instanceof TaskStateError) return taskStateResponse(err);
      return errorResponse(
        500,
        "TASK_STATE_INVALID",
        "Ari couldn't safely start this plan. Try again.",
      );
    }
  }

  // Reconcile a terminal confirmation before planning the next turn. This is
  // the recovery path for a domain write that completed while confirmation
  // bookkeeping failed; it never executes the tool again.
  if (
    taskState.status === "awaiting_confirmation" &&
    taskState.active_task?.pending_action_id
  ) {
    const pendingActionId = taskState.active_task.pending_action_id;
    const { data: pendingRecovery } = await userClient.from(
      "agent_pending_actions",
    )
      .select("tool_name, status, executed_result, failure_reason")
      .eq("id", pendingActionId)
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    let outcome = pendingRecovery?.status as
      | "executed"
      | "failed"
      | "cancelled"
      | "expired"
      | "executing"
      | "pending"
      | undefined;
    let recoveredResult = pendingRecovery?.executed_result as unknown;
    if (outcome === "executing") {
      const { data: toolRecovery } = await userClient.from("agent_messages")
        .select("tool_results")
        .eq("conversation_id", conversationId)
        .eq("role", "tool")
        .contains("tool_results", {
          pending_action_id: pendingActionId,
          outcome: "executed",
        })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (toolRecovery) {
        outcome = "executed";
        recoveredResult =
          (toolRecovery.tool_results as { result?: unknown }).result;
      }
    }
    if (
      outcome &&
      ["executed", "failed", "cancelled", "expired"].includes(outcome)
    ) {
      try {
        const reconciled = reconcilePendingAction({
          state: taskState,
          pendingActionId,
          outcome: outcome as "executed" | "failed" | "cancelled" | "expired",
          nowIso: requestNow.toISOString(),
          errorCode: typeof pendingRecovery?.failure_reason === "string"
            ? pendingRecovery.failure_reason.slice(0, 80)
            : undefined,
          resource: taskResourceFromResult(
            pendingRecovery?.tool_name ?? "",
            recoveredResult,
          ),
        });
        const recoveryMessageId = crypto.randomUUID();
        const recoveryText = outcome === "executed"
          ? "I reconciled the completed action once."
          : `I reconciled the ${outcome} action.`;
        const committed = await commitTaskAssistantTurn({
          client: serviceClient,
          userId,
          conversationId,
          expectedRevision: taskStateRevision,
          nextState: reconciled,
          summary: appendSafeSummary(
            conversationSummary,
            `Recovered confirmation outcome ${outcome}.`,
          ),
          assistantMessageId: recoveryMessageId,
          content: { text: recoveryText },
          nowIso: requestNow.toISOString(),
        });
        if (!committed.won) {
          return taskStateResponse(
            new TaskStateError(
              committed.error
                ? "TASK_RECOVERY_REQUIRED"
                : "TASK_STATE_CONFLICT",
              committed.error ?? "Task state changed",
            ),
          );
        }
        taskState = reconciled;
        taskStateRevision += 1;
        conversationSummary = appendSafeSummary(
          conversationSummary,
          `Recovered confirmation outcome ${outcome}.`,
        );
      } catch (err: unknown) {
        if (err instanceof TaskStateError) return taskStateResponse(err);
        return taskStateResponse(
          new TaskStateError(
            "TASK_RECOVERY_REQUIRED",
            "Confirmation recovery failed",
          ),
        );
      }
    } else if (outcome === "executing") {
      return taskStateResponse(
        new TaskStateError(
          "TASK_RECOVERY_REQUIRED",
          "Confirmation is still reconciling",
        ),
      );
    }
  }

  // Idempotent retry: one persisted user row per (conversation, client turn).
  // If a terminal assistant row already exists, return it without re-running a
  // model, read tool, pending-action insert, or state revision.
  const { data: turnRows, error: turnRowsError } = await userClient
    .from("agent_messages")
    .select("id, role, content, tool_calls, client_turn_id, created_at")
    .eq("conversation_id", conversationId)
    .eq("client_turn_id", body.client_turn_id)
    .order("created_at", { ascending: true });
  if (turnRowsError) {
    return errorResponse(
      500,
      "INTERNAL",
      "Failed to check this turn's retry state",
    );
  }
  const existingAssistant = (turnRows ?? []).find((row) =>
    row.role === "assistant"
  );
  if (existingAssistant) {
    const storedText =
      typeof (existingAssistant.content as { text?: unknown })?.text ===
          "string"
        ? (existingAssistant.content as { text: string }).text
        : "";
    const storedChoices = validateAgentChoicesV2(
      (existingAssistant.content as { structured?: { choices?: unknown } })
        ?.structured?.choices,
    );
    const toolCall = existingAssistant.tool_calls as {
      tool_name?: unknown;
      args?: unknown;
      pending_action_id?: unknown;
    } | null;
    if (
      toolCall && typeof toolCall.tool_name === "string" &&
      typeof toolCall.pending_action_id === "string" &&
      toolCall.args !== null && typeof toolCall.args === "object" &&
      !Array.isArray(toolCall.args)
    ) {
      return jsonResponse(200, {
        kind: "pending_action",
        pending_action_id: toolCall.pending_action_id,
        tool_name: toolCall.tool_name,
        tool_args: toolCall.args as Record<string, unknown>,
        conversation_id: conversationId,
        message_id: existingAssistant.id,
        task_state_revision: taskStateRevision,
      });
    }
    return jsonResponse(200, {
      kind: "text",
      text: storedText,
      conversation_id: conversationId,
      message_id: existingAssistant.id,
      task_state_revision: taskStateRevision,
      ...(storedChoices ? { choices: storedChoices } : {}),
      ...((existingAssistant.content as {
          structured?: { handoff_route?: unknown };
        })?.structured?.handoff_route &&
          typeof (existingAssistant.content as {
              structured: { handoff_route: unknown };
            }).structured.handoff_route === "string"
        ? {
          handoff_route: (existingAssistant.content as {
            structured: { handoff_route: string };
          }).structured.handoff_route,
        }
        : {}),
    });
  }

  let liveChoices: AgentChoicesV2 | null = null;
  let semanticMessage = requestMessage;
  if (choiceSubmission) {
    if (
      !taskState.pending_question ||
      taskState.pending_question.question_id !== choiceSubmission.question_id
    ) {
      return taskStateResponse(
        new TaskStateError("CHOICE_STALE", "That choice is no longer active"),
      );
    }
    if (!taskState.pending_question.response_message_id) {
      return taskStateResponse(
        new TaskStateError("CHOICE_STALE", "That choice is no longer active"),
      );
    }
    const { data: questionMessage, error: questionError } = await userClient
      .from("agent_messages")
      .select("content")
      .eq("id", taskState.pending_question.response_message_id)
      .eq("conversation_id", conversationId)
      .eq("role", "assistant")
      .maybeSingle();
    if (questionError || !questionMessage) {
      return taskStateResponse(
        new TaskStateError("CHOICE_STALE", "That choice is no longer active"),
      );
    }
    liveChoices = validateAgentChoicesV2(
      (questionMessage.content as { structured?: { choices?: unknown } })
        ?.structured?.choices,
    );
    if (
      !liveChoices || liveChoices.question_id !== choiceSubmission.question_id
    ) {
      return taskStateResponse(
        new TaskStateError("CHOICE_STALE", "That choice is no longer active"),
      );
    }
    const selectedLabels = choiceSubmission.option_ids.map((id) =>
      liveChoices?.options.find((option) => option.id === id)?.label
    );
    if (selectedLabels.some((label) => typeof label !== "string")) {
      return taskStateResponse(
        new TaskStateError("CHOICE_STALE", "That choice is no longer active"),
      );
    }
    semanticMessage = choiceSubmission.free_text ?? selectedLabels.join(", ");
  }

  // Load last N messages
  // deno-fmt-ignore -- protected #2013 provenance gate requires this exact select boundary.
  const { data: historyRows } = await userClient
    .from("agent_messages")
    .select(
      "role, content, tool_calls, tool_results, prompt_version, created_at",
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_WINDOW);
  const history = (historyRows ?? []).reverse(); // oldest -> newest

  // Load profile
  const { data: profileRow } = await userClient
    .from("agent_user_profile")
    .select(
      "display_name, preferred_timezone, preferred_currency, communication_style",
    )
    .eq("user_id", userId)
    .maybeSingle();
  const profile = profileRow as AgentUserProfile | null;
  const effectiveTimezone = chooseEffectiveTimezone({
    requestText: semanticMessage,
    preferredTimezone: profile?.preferred_timezone ?? null,
    clientTimezone: body.client_timezone ?? null,
  });
  const clockContext = plannerClockContext(requestNow, effectiveTimezone);

  // hasBlockingEvents (Q1 = grouped count, no migration) — mirrors the
  // delete-guard semantics EXACTLY so the prompt's "deletable" hint and the
  // delete_brand executor's actual guard cannot drift: scheduled/live events
  // with a future event_dates.end_at, type-agnostic.
  // orch-strict-grep-allow events-type-filter — intentionally NO event_type filter.
  const brandIds = activeBrand ? [activeBrand.id] : [];
  const blockingBrandIds = new Set<string>();
  if (brandIds.length > 0) {
    const nowIso = new Date().toISOString();
    const { data: blockingRows } = await userClient
      .from("events")
      .select("brand_id, event_dates!inner(end_at)")
      .in("brand_id", brandIds)
      .in("status", ["scheduled", "live"])
      .is("deleted_at", null)
      .gt("event_dates.end_at", nowIso);
    for (const r of (blockingRows ?? []) as any[]) {
      if (r?.brand_id) blockingBrandIds.add(r.brand_id as string);
    }
  }

  const brandsList: BrandSummary[] = accessibleBrands.slice(0, 20).map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    defaultCurrency: b.default_currency ?? null,
    hasCover: b.cover_media_url != null,
    hasBlockingEvents: blockingBrandIds.has(b.id),
    role: b.role,
    effectiveRank: b.effective_rank,
  }));

  // Wave 0 — compact offerings + payout-ready. Cap tokens; never dump PII.
  const offerings: OfferingSummary[] = [];
  let payoutReady: boolean | null = null;
  if (brandIds.length > 0) {
    const { data: offeringRows } = await userClient
      .from("events")
      .select(
        "id, title, status, event_type, currency, theme, pass_tax, pass_mingla_fee, pass_service_fee",
      )
      .in("brand_id", brandIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(12);
    for (const row of (offeringRows ?? []) as any[]) {
      const draftTickets = row.status === "draft" &&
          Array.isArray(row.theme?.business_draft?.tickets)
        ? row.theme.business_draft.tickets.slice(0, 6)
        : [];
      offerings.push({
        id: row.id,
        title: String(row.title ?? "untitled").slice(0, 80),
        kind: String(row.event_type ?? "event"),
        status: String(row.status ?? "draft"),
        ticketSummary: draftTickets.length > 0
          ? draftTickets.map((tier: any) =>
            `${String(tier.name ?? "Tier").slice(0, 40)} ${
              tier.isFree === true
                ? "free"
                : `${Number(tier.priceGbp ?? tier.price ?? 0).toFixed(2)} ${
                  String(row.currency ?? "currency pending")
                }`
            }`
          ).join("; ")
          : null,
        pricingSummary: `tax=${
          row.pass_tax === null
            ? "inherit"
            : row.pass_tax
            ? "included"
            : "absorbed"
        }, mingla=${
          row.pass_mingla_fee === null
            ? "inherit"
            : row.pass_mingla_fee
            ? "buyer"
            : "absorbed"
        }, service=${
          row.pass_service_fee === null
            ? "inherit"
            : row.pass_service_fee
            ? "buyer"
            : "absorbed"
        }`,
      });
    }
    const liveOfferingIds = offerings.filter((offering) =>
      offering.status !== "draft"
    ).map((offering) => offering.id);
    if (liveOfferingIds.length > 0) {
      const { data: liveTiers } = await userClient.from("ticket_types")
        .select("event_id,name,price_cents,is_free,currency")
        .in("event_id", liveOfferingIds).is("deleted_at", null)
        .order("display_order", { ascending: true }).limit(24);
      for (const offering of offerings) {
        const tiers = (liveTiers ?? []).filter((tier: any) =>
          tier.event_id === offering.id
        ).slice(0, 6);
        if (tiers.length > 0) {
          offering.ticketSummary = tiers.map((tier: any) =>
            `${String(tier.name ?? "Tier").slice(0, 40)} ${
              tier.is_free === true
                ? "free"
                : `${(Number(tier.price_cents ?? 0) / 100).toFixed(2)} ${
                  String(tier.currency ?? "currency pending")
                }`
            }`
          ).join("; ");
        }
      }
    }
    const probeBrand = activeBrand?.id;
    try {
      const { data: can } = await userClient.rpc("pg_brand_can_collect", {
        p_brand_id: probeBrand,
      });
      payoutReady = can === true ||
        (can as { can_collect?: boolean } | null)?.can_collect === true;
    } catch {
      payoutReady = null;
    }
  }
  const business: BusinessContext = {
    brands: brandsList,
    activeBrand: activeBrand
      ? brandsList.find((brand) => brand.id === activeBrand.id) ?? null
      : null,
    offerings,
    payoutReady,
    roleHint: activeBrand?.role ?? null,
    conversationSummary,
    taskContext: {
      status: taskState.status,
      intent: taskState.active_task?.intent ?? null,
      resolvedSlotKeys: Object.entries(taskState.active_task?.slots ?? {})
        .filter(([, slot]) => slot.status === "resolved")
        .map(([key]) => key),
      pendingSlotKeys: Object.entries(taskState.active_task?.slots ?? {})
        .filter(([, slot]) => slot.status !== "resolved")
        .map(([key]) => key),
    },
    clockContext,
  };

  // Auto-title: if this is the first user message in the conversation and
  // the title is still null, derive a short title from the message text so
  // the conversations drawer shows something meaningful instead of "Untitled".
  // Best-effort; failures don't block the chat turn.
  if (history.length === 0) {
    const derivedTitle = semanticMessage.trim().slice(0, 60).replace(
      /\s+/g,
      " ",
    );
    if (derivedTitle.length > 0) {
      await userClient
        .from("agent_conversations")
        .update({ title: derivedTitle })
        .eq("id", conversationId)
        .is("title", null);
    }
  }

  // Insert once. A retry after a transient planner/model failure reuses the
  // existing row and its original server-derived transcript label.
  const existingUser = (turnRows ?? []).find((row) => row.role === "user");
  let userMsg: { id: string };
  if (existingUser) {
    userMsg = { id: existingUser.id };
    const stored = (existingUser.content as { text?: unknown })?.text;
    if (typeof stored === "string") semanticMessage = stored;
  } else {
    const { data: insertedUser, error: userMsgErr } = await userClient
      .from("agent_messages")
      .insert({
        conversation_id: conversationId,
        user_id: userId,
        role: "user",
        content: {
          text: semanticMessage,
          ...(choiceSubmission
            ? {
              structured: {
                choice_submission: {
                  question_id: choiceSubmission.question_id,
                  option_ids: choiceSubmission.option_ids,
                },
              },
            }
            : {}),
        },
        client_turn_id: body.client_turn_id,
        prompt_version: TENANT_CONTEXT_VERSION,
        model_version: ARI_MODEL_VERSION,
      })
      .select("id")
      .single();
    if (userMsgErr || !insertedUser) {
      return errorResponse(
        500,
        "INTERNAL",
        `Failed to write user message: ${userMsgErr?.message ?? "unknown"}`,
      );
    }
    userMsg = insertedUser;
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(profile, brandsList, {
    injectStrictReminder: injection.flagged,
    business,
  });

  // Build contents — wrap user-stored content in <user_data> delimiters per I-ARI-USER-DATA-WRAP
  const contents: GeminiContentMessage[] = [];
  // #2013 rework: only rows written under the first tenant-contained prompt
  // revision have authenticated scope provenance. Older/unmarked transcript
  // remains visible in the client but never crosses the Gemini boundary.
  const trustedHistoryPromptVersion = "tenant-v1";
  for (const m of history) {
    if (m.prompt_version !== trustedHistoryPromptVersion) continue;
    if (m.role === "user") {
      const text = (m.content as any)?.text ?? "";
      contents.push({
        role: "user",
        parts: [{ text: `<user_data>\n${String(text)}\n</user_data>` }],
      });
    } else if (m.role === "assistant") {
      const text = (m.content as any)?.text;
      const toolCall = m.tool_calls as any;
      if (toolCall?.tool_name && toolCall?.args) {
        contents.push({
          role: "model",
          parts: [{
            functionCall: { name: toolCall.tool_name, args: toolCall.args },
          }],
        });
      } else if (typeof text === "string") {
        contents.push({ role: "model", parts: [{ text }] });
      }
    } else if (m.role === "tool") {
      const tr = m.tool_results as any;
      if (tr?.tool_name) {
        contents.push({
          role: "user",
          parts: [{
            functionResponse: {
              name: tr.tool_name,
              response: { result: tr.result ?? tr },
            },
          }],
        });
      }
    }
  }
  // Append the new user message
  contents.push({
    role: "user",
    parts: [{ text: `<user_data>\n${semanticMessage}\n</user_data>` }],
  });

  if (!liveChoices && taskState.pending_question?.response_message_id) {
    const { data: pendingQuestionMessage } = await userClient
      .from("agent_messages")
      .select("content")
      .eq("id", taskState.pending_question.response_message_id)
      .eq("conversation_id", conversationId)
      .eq("role", "assistant")
      .maybeSingle();
    liveChoices = validateAgentChoicesV2(
      (pendingQuestionMessage?.content as
        | { structured?: { choices?: unknown } }
        | undefined)?.structured?.choices,
    );
  }

  const plannerContext: PlannerContext | null = activeBrand
    ? {
      now: requestNow,
      timezone: effectiveTimezone,
      locale: typeof body.locale === "string" ? body.locale : undefined,
      activeBrand: { id: activeBrand.id, name: activeBrand.name },
      originMessageId: userMsg.id,
      taskId: crypto.randomUUID(),
      questionId: crypto.randomUUID(),
    }
    : null;
  const activeEventPlan = taskState.active_task?.intent === "create_event" &&
    !["completed", "cancelled"].includes(taskState.status);
  const readInterruption = activeEventPlan &&
    isReadInterruption(semanticMessage);
  const questionInterruption = activeEventPlan && !readInterruption &&
    /\b(?:what|why|how|who|where|can you|do you)\b/i.test(semanticMessage) &&
    !/\b(?:today|tomorrow|next|this|month|week|am|pm|morning|afternoon|evening|title|called|named)\b/i
      .test(semanticMessage);

  if (plannerContext && choiceSubmission && liveChoices) {
    try {
      const startsReplacementTask = liveChoices.options.some((option) =>
        choiceSubmission.option_ids.includes(option.id) &&
        option.payload.type === "task_command" &&
        (option.payload.command === "pause" ||
          option.payload.command === "start_new") &&
        typeof option.payload.replacement_request === "string"
      );
      const replacedPendingActionId = startsReplacementTask
        ? taskState.active_task?.pending_action_id
        : undefined;
      const planned = applyStoredChoice({
        state: taskState,
        choices: assertAgentChoicesV2(liveChoices),
        optionIds: choiceSubmission.option_ids,
        freeText: choiceSubmission.free_text,
        context: plannerContext,
      });
      if (replacedPendingActionId) {
        const terminalized = await terminalizeProposalForTaskReplacement({
          pendingClient: serviceClient,
          userId,
          conversationId,
          pendingActionId: replacedPendingActionId,
        });
        if (!terminalized.ok) {
          return errorResponse(
            409,
            "TASK_RECOVERY_REQUIRED",
            terminalized.message,
          );
        }
      }
      if (planned.proposal) {
        const tool = findTool(planned.proposal.tool_name);
        if (!tool) {
          return errorResponse(
            500,
            "INTERNAL",
            "create_event tool is unavailable",
          );
        }
        try {
          await authorizeAgentTool(
            tool,
            planned.proposal.tool_args,
            userClient,
            userId,
          );
        } catch (err: unknown) {
          if (err instanceof ToolError) {
            return errorResponse(
              err.code === "ROLE_CHECK_UNAVAILABLE" ? 503 : 403,
              err.code,
              err.message,
            );
          }
          return errorResponse(
            503,
            "ROLE_CHECK_UNAVAILABLE",
            "Ari could not verify permissions right now",
          );
        }
        return await commitPendingTurn({
          client: serviceClient,
          pendingClient: serviceClient,
          userId,
          conversationId,
          clientTurnId: body.client_turn_id,
          previousState: taskState,
          readyState: planned.state,
          expectedRevision: taskStateRevision,
          previousSummary: conversationSummary,
          toolName: planned.proposal.tool_name,
          toolArgs: planned.proposal.tool_args,
          classification: planned.classification,
          startedAt: turnStartedAt,
        });
      }
      return await commitTextTurn({
        client: serviceClient,
        userId,
        conversationId,
        clientTurnId: body.client_turn_id,
        previousState: taskState,
        nextState: planned.state,
        expectedRevision: taskStateRevision,
        previousSummary: conversationSummary,
        text: planned.text,
        classification: planned.classification,
        startedAt: turnStartedAt,
        choices: planned.choices,
        handoffRoute: planned.handoffRoute,
      });
    } catch (err: unknown) {
      if (err instanceof TaskStateError) return taskStateResponse(err);
      logError("agent-chat choice planning failed", err, {
        fn: "agent-chat",
        revision: "1985-v1",
      });
      return errorResponse(
        502,
        "PLANNER_UNAVAILABLE",
        "Ari couldn't safely apply that answer. Your choice is still here — try again.",
      );
    }
  }

  if (
    plannerContext && !readInterruption && !questionInterruption &&
    (activeEventPlan || isCreateEventPlanningRequest(semanticMessage))
  ) {
    try {
      const baseState = ["completed", "cancelled"].includes(taskState.status) &&
          isCreateEventPlanningRequest(semanticMessage)
        ? {
          ...IDLE_TASK_STATE,
          last_completed_step: taskState.last_completed_step,
        }
        : taskState;
      const planned = planEventTurn(baseState, semanticMessage, plannerContext);
      if (planned.proposal) {
        const tool = findTool(planned.proposal.tool_name);
        if (!tool) {
          return errorResponse(
            500,
            "INTERNAL",
            "create_event tool is unavailable",
          );
        }
        try {
          await authorizeAgentTool(
            tool,
            planned.proposal.tool_args,
            userClient,
            userId,
          );
        } catch (err: unknown) {
          if (err instanceof ToolError) {
            return errorResponse(
              err.code === "ROLE_CHECK_UNAVAILABLE" ? 503 : 403,
              err.code,
              err.message,
            );
          }
          return errorResponse(
            503,
            "ROLE_CHECK_UNAVAILABLE",
            "Ari could not verify permissions right now",
          );
        }
        return await commitPendingTurn({
          client: serviceClient,
          pendingClient: serviceClient,
          userId,
          conversationId,
          clientTurnId: body.client_turn_id,
          previousState: taskState,
          readyState: planned.state,
          expectedRevision: taskStateRevision,
          previousSummary: conversationSummary,
          toolName: planned.proposal.tool_name,
          toolArgs: planned.proposal.tool_args,
          classification: planned.classification,
          startedAt: turnStartedAt,
        });
      }
      return await commitTextTurn({
        client: serviceClient,
        userId,
        conversationId,
        clientTurnId: body.client_turn_id,
        previousState: taskState,
        nextState: planned.state,
        expectedRevision: taskStateRevision,
        previousSummary: conversationSummary,
        text: planned.text,
        classification: planned.classification,
        startedAt: turnStartedAt,
        choices: planned.choices,
      });
    } catch (err: unknown) {
      if (err instanceof TaskStateError) return taskStateResponse(err);
      logError("agent-chat event planning failed", err, {
        fn: "agent-chat",
        revision: "1985-v1",
      });
      return errorResponse(
        502,
        "PLANNER_UNAVAILABLE",
        "Ari couldn't safely continue this plan. Your message is saved — try again.",
      );
    }
  }

  const interruptionState = (readInterruption || questionInterruption)
    ? beginInterruption(taskState, {
      turn_id: body.client_turn_id,
      kind: readInterruption ? "read" : "question",
      user_text_digest: `turn-${body.client_turn_id.slice(0, 8)}`,
      started_at: requestNow.toISOString(),
    })
    : taskState;

  // Call Gemini
  let gemini;
  try {
    gemini = await callGemini({
      systemPrompt,
      contents,
      tools: AGENT_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    });
  } catch (err: any) {
    const schemaResponse = schemaErrorResponse(err);
    if (schemaResponse) return schemaResponse;
    console.error(
      "[agent-chat] Gemini error:",
      err?.kind,
      err?.message,
      err?.detail,
    );
    // Surface config errors specifically — these are operator-fixable
    // (set the secret) and the generic "having trouble" message hides
    // the actual problem. HTTP errors with a status get a more
    // specific message too. Everything else falls back to MODEL_UNAVAILABLE.
    if (err?.kind === "config") {
      return errorResponse(
        500,
        "MODEL_NOT_CONFIGURED",
        err.message ??
          "Ari isn't configured yet — operator must set GEMINI_API_KEY_ARI in Supabase function secrets.",
      );
    }
    if (err?.kind === "http") {
      const status = typeof err.status === "number" ? err.status : 0;
      if (status === 401 || status === 403) {
        return errorResponse(
          500,
          "MODEL_AUTH_FAILED",
          "Ari's API key was rejected by Google. Operator: verify GEMINI_API_KEY_ARI is a valid AI Studio key.",
        );
      }
      if (status === 429) {
        return errorResponse(
          429,
          "MODEL_RATE_LIMITED",
          "Ari is hitting Google's rate limit — try again in a moment.",
        );
      }
    }
    // Generic fallback for any other Gemini failure mode (HTTP 4xx other
    // than auth/rate-limit, malformed responses after retries, empty
    // responses). The real diagnostic detail is in the server logs above;
    // the user-visible message stays friendly.
    return errorResponse(
      502,
      "MODEL_UNAVAILABLE",
      "Ari is having trouble right now — try again in a moment.",
    );
  }

  // Branch on tool call vs text
  if (gemini.toolCall) {
    const tool = findTool(gemini.toolCall.name);
    if (!tool) {
      return errorResponse(
        500,
        "INTERNAL",
        `Unknown tool: ${gemini.toolCall.name}`,
      );
    }

    // For READ-ONLY tools, execute inline (no confirmation needed)
    if (isReadOnlyAgentToolCall(tool.name, gemini.toolCall.args)) {
      try {
        const result = await tool.executor(
          gemini.toolCall.args,
          userClient,
          userId,
          {
            operationId: null,
          },
        );
        // Log tool result as a tool message, then ask Gemini for a natural-language summary
        await serviceClient
          .from("agent_messages")
          .insert({
            conversation_id: conversationId,
            user_id: userId,
            role: "tool",
            content: { text: "" },
            tool_results: { tool_name: tool.name, result },
            client_turn_id: body.client_turn_id,
            prompt_version: TENANT_CONTEXT_VERSION,
            model_version: ARI_MODEL_VERSION,
          })
          .select("id")
          .single();

        // Follow-up Gemini call to summarise the read result
        const followupContents: GeminiContentMessage[] = [
          ...contents,
          {
            role: "model",
            parts: [{
              functionCall: { name: tool.name, args: gemini.toolCall.args },
            }],
          },
          {
            role: "user",
            parts: [{
              functionResponse: {
                name: tool.name,
                response: { result },
              },
            }],
          },
        ];
        let followup;
        try {
          followup = await callGemini({
            systemPrompt,
            contents: followupContents,
            tools: AGENT_TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          });
        } catch (err: unknown) {
          const schemaResponse = schemaErrorResponse(err);
          if (schemaResponse) return schemaResponse;
          followup = undefined;
        }
        const text = followup?.textResponse ?? "Here's what I found.";
        const resumedState = readInterruption
          ? resumeInterruption(interruptionState)
          : taskState;
        const resumePrompt = readInterruption
          ? liveChoices?.prompt ?? pendingQuestionPrompt(resumedState)
          : null;
        const resumedText = resumePrompt
          ? `${text}\n\nBack to your event plan: ${resumePrompt}`
          : text;
        return await commitTextTurn({
          client: serviceClient,
          userId,
          conversationId,
          clientTurnId: body.client_turn_id,
          previousState: taskState,
          nextState: resumedState,
          expectedRevision: taskStateRevision,
          previousSummary: conversationSummary,
          text: resumedText,
          classification: readInterruption
            ? "read_interruption"
            : "general_read",
          startedAt: turnStartedAt,
          choices: readInterruption && liveChoices ? liveChoices : undefined,
          structuredData: result !== null && typeof result === "object" &&
              !Array.isArray(result)
            ? result as Record<string, unknown>
            : { result },
          resumed: readInterruption,
        });
      } catch (err: any) {
        if (err instanceof ToolError) {
          console.error(
            "[agent-chat] tenant-scoped read stopped",
            JSON.stringify({
              fn: "agent-chat",
              revision: "2013",
              code: err.code,
              scope_state: activeBrand ? "bound" : "legacy_or_zero_brand",
              request_brand_supplied: typeof body.brand_id === "string",
              accessible_brand_count: accessibleBrands.length,
              tool_name: tool.name,
            }),
          );
          if (readInterruption) {
            await serviceClient.from("agent_messages").insert({
              conversation_id: conversationId,
              user_id: userId,
              role: "tool",
              content: { text: "" },
              tool_results: {
                tool_name: tool.name,
                outcome: "failed",
                code: err.code,
              },
              client_turn_id: body.client_turn_id,
              prompt_version: TENANT_CONTEXT_VERSION,
              model_version: ARI_MODEL_VERSION,
            });
            const resumedState = resumeInterruption(interruptionState);
            const resumePrompt = liveChoices?.prompt ??
              pendingQuestionPrompt(resumedState) ??
              "continue where we left off";
            return await commitTextTurn({
              client: serviceClient,
              userId,
              conversationId,
              clientTurnId: body.client_turn_id,
              previousState: taskState,
              nextState: resumedState,
              expectedRevision: taskStateRevision,
              previousSummary: conversationSummary,
              text:
                `I couldn't complete that read safely. Back to your event plan: ${resumePrompt}`,
              classification: "read_interruption",
              startedAt: turnStartedAt,
              choices: liveChoices ?? undefined,
              resumed: true,
            });
          }
          return errorResponse(
            err.code === "TENANT_SCOPE_UNAVAILABLE" ||
              err.code === "ROLE_CHECK_UNAVAILABLE"
              ? 503
              : err.code === "INVALID_ARGS"
              ? 400
              : 403,
            err.code,
            err.message,
          );
        }
        if (readInterruption) {
          const resumedState = resumeInterruption(interruptionState);
          const resumePrompt = liveChoices?.prompt ??
            pendingQuestionPrompt(resumedState) ?? "continue where we left off";
          return await commitTextTurn({
            client: serviceClient,
            userId,
            conversationId,
            clientTurnId: body.client_turn_id,
            previousState: taskState,
            nextState: resumedState,
            expectedRevision: taskStateRevision,
            previousSummary: conversationSummary,
            text:
              `That read didn't finish. Back to your event plan: ${resumePrompt}`,
            classification: "read_interruption",
            startedAt: turnStartedAt,
            choices: liveChoices ?? undefined,
            resumed: true,
          });
        }
        return errorResponse(
          500,
          "EXECUTION_FAILED",
          err?.message ?? "Tool failed",
        );
      }
    }

    if (activeEventPlan) {
      const resumedState = interruptionState.status === "interrupted"
        ? resumeInterruption(interruptionState)
        : taskState;
      const resumePrompt = liveChoices?.prompt ??
        pendingQuestionPrompt(resumedState) ?? "finish the current event plan";
      return await commitTextTurn({
        client: serviceClient,
        userId,
        conversationId,
        clientTurnId: body.client_turn_id,
        previousState: taskState,
        nextState: resumedState,
        expectedRevision: taskStateRevision,
        previousSummary: conversationSummary,
        text: `Your event plan is still active. ${resumePrompt}`,
        classification: "question_interruption",
        startedAt: turnStartedAt,
        choices: liveChoices ?? undefined,
        resumed: true,
      });
    }

    // #2063: bind canonical optimistic state before authorization/persistence.
    // The proposal, confirmation, and SQL owner all receive the same version.
    try {
      gemini.toolCall.args = canonicalizeAgentProposalArgs(
        tool.name,
        gemini.toolCall.args,
      );
      gemini.toolCall.args = await bindAgentProposalState(
        tool.name,
        gemini.toolCall.args,
        userClient,
      );
    } catch (err: unknown) {
      if (err instanceof ToolError) {
        return errorResponse(
          err.code === "INVALID_ARGS" ? 400 : 503,
          err.code,
          err.message,
        );
      }
      return errorResponse(
        503,
        "ROLE_CHECK_UNAVAILABLE",
        "Ari could not read the current state for this proposal.",
      );
    }

    // #2019: authorization precedes every persisted proposal.
    let proposalContext: Record<string, unknown> | null = null;
    try {
      await authorizeAgentTool(tool, gemini.toolCall.args, userClient, userId);
      proposalContext = await preflightTicketPricingProposal(
        tool.name,
        gemini.toolCall.args,
        userClient,
      );
    } catch (err: unknown) {
      if (err instanceof ToolError) {
        const status = err.code === "ROLE_CHECK_UNAVAILABLE"
          ? 503
          : err.code === "INVALID_ARGS"
          ? 400
          : 403;
        return errorResponse(status, err.code, err.message);
      }
      return errorResponse(
        503,
        "ROLE_CHECK_UNAVAILABLE",
        "Ari could not verify permissions right now",
      );
    }

    return await commitPendingTurn({
      client: serviceClient,
      pendingClient: serviceClient,
      userId,
      conversationId,
      clientTurnId: body.client_turn_id,
      previousState: taskState,
      readyState: taskState,
      expectedRevision: taskStateRevision,
      previousSummary: conversationSummary,
      toolName: tool.name,
      toolArgs: gemini.toolCall.args,
      proposalContext,
      classification: "general_write_proposal",
      startedAt: turnStartedAt,
    });
  }

  // Text response (no tool call)
  if (!gemini.textResponse) {
    return errorResponse(502, "MODEL_EMPTY", "Ari didn't respond — try again");
  }
  const answer = gemini.textResponse.trim();
  const resumedState = interruptionState.status === "interrupted"
    ? resumeInterruption(interruptionState)
    : taskState;
  const resumePrompt = (readInterruption || questionInterruption)
    ? liveChoices?.prompt ?? pendingQuestionPrompt(resumedState)
    : null;
  const text = resumePrompt
    ? `${answer}\n\nBack to your event plan: ${resumePrompt}`
    : answer;
  return await commitTextTurn({
    client: serviceClient,
    userId,
    conversationId,
    clientTurnId: body.client_turn_id,
    previousState: taskState,
    nextState: resumedState,
    expectedRevision: taskStateRevision,
    previousSummary: conversationSummary,
    text,
    classification: readInterruption
      ? "read_interruption"
      : questionInterruption
      ? "question_interruption"
      : "general",
    startedAt: turnStartedAt,
    choices: (readInterruption || questionInterruption) && liveChoices
      ? liveChoices
      : undefined,
    resumed: readInterruption || questionInterruption,
  });
}

async function commitPendingTurn(args: {
  client: SupabaseClient;
  pendingClient: SupabaseClient;
  userId: string;
  conversationId: string;
  clientTurnId: string;
  previousState: TaskStateV1;
  readyState: TaskStateV1;
  expectedRevision: number;
  previousSummary: string | null;
  toolName: string;
  toolArgs: Record<string, unknown>;
  proposalContext?: Record<string, unknown> | null;
  classification: string;
  startedAt: number;
}): Promise<Response> {
  const pendingActionId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  let nextState: TaskStateV1;
  try {
    nextState = args.readyState.active_task?.intent === "create_event"
      ? markAwaitingConfirmation(args.readyState, pendingActionId)
      : args.readyState;
  } catch (err: unknown) {
    return err instanceof TaskStateError
      ? taskStateResponse(err)
      : errorResponse(
        500,
        "TASK_STATE_INVALID",
        "Ari couldn't safely prepare that action.",
      );
  }
  const { error: pendingError } = await args.pendingClient.from(
    "agent_pending_actions",
  ).insert({
    id: pendingActionId,
    user_id: args.userId,
    conversation_id: args.conversationId,
    tool_name: args.toolName,
    tool_args: args.toolArgs,
    status: "pending",
    server_proposed_at: new Date().toISOString(),
  });
  if (pendingError) {
    return errorResponse(
      500,
      "INTERNAL",
      `Failed to create pending action: ${pendingError.message}`,
    );
  }

  const nowIso = new Date().toISOString();
  const proposalArgs = verifiedProposalArgs(
    args.toolArgs,
    args.proposalContext ?? null,
  );
  const toolCalls = {
    tool_name: args.toolName,
    args: proposalArgs,
    pending_action_id: pendingActionId,
  };
  const committed = await commitTaskAssistantTurn({
    client: args.client,
    userId: args.userId,
    conversationId: args.conversationId,
    expectedRevision: args.expectedRevision,
    nextState,
    summary: appendSafeSummary(
      args.previousSummary,
      stateSummaryEvent(args.classification, nextState),
    ),
    assistantMessageId,
    content: { text: "" },
    toolCalls,
    clientTurnId: args.clientTurnId,
    nowIso,
  });
  if (!committed.won) {
    await args.pendingClient.from("agent_pending_actions")
      .update({ status: "cancelled", failure_reason: "TASK_STATE_CONFLICT" })
      .eq("id", pendingActionId).eq("status", "pending");
    emitTaskEvent({
      intent: args.previousState.active_task?.intent ?? null,
      from: args.previousState.status,
      to: args.previousState.status,
      revision: args.expectedRevision,
      classification: args.classification,
      resumed: false,
      errorCode: committed.error
        ? "TASK_RECOVERY_REQUIRED"
        : "TASK_STATE_CONFLICT",
      startedAt: args.startedAt,
      success: false,
    });
    return taskStateResponse(
      new TaskStateError(
        committed.error ? "TASK_RECOVERY_REQUIRED" : "TASK_STATE_CONFLICT",
        committed.error ?? "Task state changed",
      ),
    );
  }
  emitTaskEvent({
    intent: nextState.active_task?.intent ?? null,
    from: args.previousState.status,
    to: nextState.status,
    revision: args.expectedRevision + 1,
    classification: args.classification,
    resumed: false,
    startedAt: args.startedAt,
    success: true,
  });
  return jsonResponse(200, {
    kind: "pending_action",
    pending_action_id: pendingActionId,
    tool_name: args.toolName,
    tool_args: proposalArgs,
    conversation_id: args.conversationId,
    message_id: assistantMessageId,
    task_state_revision: args.expectedRevision + 1,
  });
}
