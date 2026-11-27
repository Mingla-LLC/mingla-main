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
import { pendingActionBrandMismatch } from "../_shared/agentBrandSetupTools.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { TENANT_CONTEXT_VERSION } from "../_shared/agentSystemPrompt.ts";
import { ARI_MODEL_VERSION } from "../_shared/agentGemini.ts";
import {
  canonicalizeAgentProposalArgs,
  findTool,
  ToolError,
} from "../_shared/agentTools.ts";
import { authorizeAgentTool } from "../_shared/agentToolAuthorization.ts";
import { buildServiceClient } from "../_shared/agentRateLimit.ts";
import {
  assertEditedCreateEventProposal,
  markAwaitingConfirmation,
  parseTaskState,
  reconcilePendingAction,
  replaceCreateEventProposalArgs,
  TaskStateError,
  TaskStateV1,
} from "../_shared/agentConversationState.ts";
import {
  AgentChoicesV2,
  assertAgentChoicesV2,
} from "../_shared/agentChoices.ts";
import {
  requireAccessibleAgentBrand,
  resolveAccessibleAgentBrands,
} from "../_shared/agentTenantScope.ts";
import { decideAriFinalization } from "../_shared/agentReliability.ts";
import {
  ariErrorResponse,
  ariJsonResponse,
  emitAriPhase,
  runWithAriRequest,
  updateAriRequest,
} from "../_shared/agentReliabilityHttp.ts";
import {
  buildGenericProposalRendition,
  buildToolReceiptRendition,
  parseAriUiCapabilities,
} from "../_shared/ariRendition.ts";
import {
  continueAfterApprovedAction,
  type PostApprovalContinuation,
  prepareContinuationProposal,
} from "../_shared/agentPostApproval.ts";
import { sanitizeAriUserFacingDiagnostics } from "../_shared/agentSanitization.ts";
import { websiteSetupApprovedWriteFollowup } from "../_shared/agentWebsiteSetup.ts";
import {
  answerClaimExpired,
  ariProposalExpiredResponse,
  expiredProposalAnswer,
} from "./proposalExpiry.ts";
import {
  isAmbiguousExecutionFailure,
  requiresOperationReceipt,
  toolErrorHttpStatus,
} from "./executionOutcome.ts";
import {
  claimPendingForConfirm,
  probePendingForConfirm,
} from "./pendingClaim.ts";
import { retypeAriRefusal } from "../_shared/agentToolHelpers.ts";
import { emitOwnerText } from "../_shared/ariOwnerEmit.ts";
import {
  type AriScopeIssue,
  ariScopeTextForTurn,
  proposalScopeIssue,
  resolveAriStatedScope,
} from "../_shared/ariRequirements.ts";
import {
  proposalOwnerLead,
  receiptTitle,
  withProposalPresentation,
} from "../_shared/ariPresentation/registry.ts";
import {
  closeSweptProposal,
  type ConfirmNext,
  flowNextAfterConfirm,
  liveFlowRunFor,
  representFlowAfterExpiry,
  websiteSetupNextAfterConfirm,
} from "./confirmNext.ts";
import type { FlowStateView } from "../_shared/ariFlows/edge.ts";
import {
  SITE_CHANGE_SET_TOOL,
  type SiteWorkspaceExecutionContext,
  siteWorkspaceFollowupText,
} from "../_shared/agentSiteWorkspaceTools.ts";
import { siteStepActivityWriter } from "./siteStepActivity.ts";
import { AriTurnMeter } from "../_shared/ariTurnMeter.ts";
import {
  type AriFailureReply,
  buildAriFailureReply,
} from "../_shared/ariFailureCopy.ts";

interface RequestBody {
  action: "confirm" | "cancel";
  pending_action_id: string;
  edited_args?: Record<string, unknown>;
  ari_ui?: unknown;
  /**
   * #3355 P3: "server" = this Host never authors a continuation message; the
   * confirm response carries the next step instead.
   */
  continuation?: "server";
  /**
   * #3355 P3: confirmed from Website setup — return the next gap.
   * #4453: "website_workspace" is the workspace's own confirm (no setup
   * follow-on); the plan's result is the whole answer.
   */
  workflow_context?: "website_setup" | "website_workspace";
  /** #4389 AR-13: the brand the Host has selected when it confirms. */
  brand_id?: string;
}

type Response_ =
  | {
    kind: "executed";
    pending_action_id: string;
    tool_name: string;
    result: unknown;
    followup_text?: string;
    next_pending_action_id?: string;
    task_state_revision?: number;
    /** #3355 P3: the next step, already persisted as an assistant row. */
    next?: ConfirmNext | null;
    flow_state?: FlowStateView | null;
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
  return ariJsonResponse(status, body);
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  // Legacy `message` is intentionally discarded — registry owns user_message.
  return ariErrorResponse(status, code, message);
}

async function appendPendingActivity(args: {
  client: SupabaseClient;
  userId: string;
  conversationId: string | null;
  pendingActionId: string;
  eventType: "approved_action_started" | "finalizing_started";
}): Promise<void> {
  if (!args.conversationId) return;
  const { data: proposal } = await args.client.from("agent_messages")
    .select("client_turn_id")
    .eq("user_id", args.userId)
    .eq("conversation_id", args.conversationId)
    .eq("role", "assistant")
    .contains("tool_calls", { pending_action_id: args.pendingActionId })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (typeof proposal?.client_turn_id !== "string") return;
  const { data: attempt } = await args.client.from("agent_turn_attempts")
    .select("id,attempt_number")
    .eq("user_id", args.userId)
    .eq("conversation_id", args.conversationId)
    .eq("client_turn_id", proposal.client_turn_id)
    .maybeSingle();
  if (!attempt) return;
  const { error } = await args.client.rpc("append_agent_activity_event", {
    p_attempt_id: attempt.id,
    p_user_id: args.userId,
    p_attempt_number: attempt.attempt_number,
    p_event_type: args.eventType,
    p_now: new Date().toISOString(),
  });
  if (error) {
    console.error(JSON.stringify({
      event: "ari_activity_write_failed",
      phase: args.eventType,
    }));
  }
}

/**
 * Issue #4637 slice 0: a confirmation continuation belongs to the owner turn
 * that produced the proposal. The database RPC resolves that proposal and
 * applies this delta once per pending action, so a receipt replay cannot bill
 * the turn twice. Telemetry is fail-soft after the write has been verified.
 */
async function recordPostApprovalMetering(args: {
  client: SupabaseClient;
  userId: string;
  pendingActionId: string;
  meter: AriTurnMeter;
}): Promise<void> {
  const delta = args.meter.snapshot({ attemptStatus: "completed" });
  if (delta.model_calls === 0) return;
  try {
    const { data, error } = await args.client.rpc(
      "add_ari_pending_action_turn_metering",
      {
        p_pending_action_id: args.pendingActionId,
        p_user_id: args.userId,
        p_input_tokens: delta.input_tokens,
        p_output_tokens: delta.output_tokens,
        p_cached_input_tokens: delta.cached_input_tokens,
        p_thinking_tokens: delta.thinking_tokens,
        p_model_calls: delta.model_calls,
        p_phase_ms: delta.phase_ms,
        p_pricing_version: delta.pricing_version,
      },
    );
    if (error || data !== true) {
      console.error(JSON.stringify({
        event: "ari_post_approval_metering_not_applied",
        pending_action_id: args.pendingActionId,
        error: error?.message ?? "source_missing_or_already_applied",
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: "ari_post_approval_metering_failed",
      pending_action_id: args.pendingActionId,
      error: error instanceof Error ? error.name : "unknown",
    }));
  }
}

// I-ARI-RECEIPT-SET-COMPLETE (#2830): every Ari write whose SQL commits through
// agent_operation_receipt_begin is in this set. Declared and enforced in
// __tests__/issue_2830_receipt_set_and_expiry.implementor.test.ts.
const RECEIPT_BACKED_TOOL_NAMES = new Set([
  "create_brand",
  "create_event",
  "update_event",
  "publish_event",
  "unpublish_event",
  "cancel_event",
  "end_event_sales",
  "duplicate_event",
  "patch_event_when",
  "set_event_cover",
  "set_event_guest_privacy",
  "discard_event_draft",
  "create_experience",
  "publish_experience",
  "update_experience",
  "manage_experience_stops",
  "unpublish_experience",
  "delete_experience",
  // Issue #2063 — these writes commit through ari_execute_brand_operation and
  // the shared #1972 operation receipt, so an ambiguous executing retry must
  // replay that receipt instead of returning WRONG_STATE.
  "update_brand",
  "delete_brand",
  "manage_brand_hours",
  "manage_brand_discovery_currency",
  // Issue #1974 — ticket/pricing writes are receipt-backed.
  "upsert_ticket_tier",
  "set_pricing_switches",
  "set_brand_pricing_defaults",
  // Issue #1971 — trip lifecycle and graph writes commit through
  // ari_execute_trip_operation and the shared #1972 operation receipt, so an
  // ambiguous `executing` retry replays that receipt instead of returning
  // WRONG_STATE or re-running the mutation.
  "create_trip",
  "update_trip",
  "manage_trip_days",
  "manage_trip_inclusions",
  "manage_trip_tiers",
  "manage_trip_traveler_intake",
  "publish_trip",
  "delete_trip",
  // Issue #1977 — RSVP lifecycle writes commit through ari_execute_rsvp_operation
  // and the shared #1972 operation receipt.
  "create_rsvp",
  "update_rsvp",
  "publish_rsvp",
  "update_rsvp_contribution_settings",
  "set_rsvp_guest_status",
  "refund_rsvp_contribution",
  // Issue #2830 — ari_update_brand_context begins and completes the shared
  // #1972 operation receipt itself, so its ambiguous retry must replay too.
  "update_brand_context",
  // Issue #3355 bundle 5 — ari_tell_owner_in_brand_group sends the owner note
  // inside the #1972 receipt, so a retry reads back the note that posted.
  "tell_owner_in_brand_group",
]);
// [TEST-MOD-APPROVED #1973] Preserve the #1972 recovery-contract name while
// extending the exact same receipt gate to the experience lifecycle.
const RECEIPT_BACKED_EVENT_TOOL_NAMES = RECEIPT_BACKED_TOOL_NAMES;

async function findTerminalMessageId(
  client: ReturnType<typeof buildServiceClient>,
  input: {
    conversationId: string | null;
    pendingActionId: string;
    userId: string;
    outcome: "executed" | "failed" | "cancelled" | "expired";
  },
): Promise<string | undefined> {
  if (!input.conversationId) return undefined;
  const { data, error } = await client.rpc(
    "get_agent_pending_terminal_message_id",
    {
      p_user_id: input.userId,
      p_conversation_id: input.conversationId,
      p_pending_action_id: input.pendingActionId,
      p_outcome: input.outcome,
    },
  );
  if (error || !data) {
    throw new Error(error?.message ?? "terminal_message_not_committed");
  }
  return data as string;
}

async function terminalizePending(
  pendingStateClient: ReturnType<typeof buildServiceClient>,
  input: {
    id: string;
    userId: string;
    expectedStatus: "pending" | "executing";
    outcome: "executed" | "failed" | "cancelled" | "expired";
    result?: unknown;
    failureReason?: string;
    requireOperationReceipt?: boolean;
    failureReply?: AriFailureReply;
  },
): Promise<
  {
    id: string;
    status: string;
    casWon: boolean;
    terminalMessageId?: string;
    failureMessageId?: string;
  }
> {
  const failureReply = input.outcome === "failed" ? input.failureReply : null;
  const { data, error } = failureReply
    ? await pendingStateClient.rpc(
      "terminalize_agent_pending_failure",
      {
        p_pending_action_id: input.id,
        p_user_id: input.userId,
        p_expected_status: input.expectedStatus,
        p_failure_reason: input.failureReason ?? "EXECUTION_FAILED",
        p_content: failureReply,
        p_prompt_version: TENANT_CONTEXT_VERSION,
        p_model_version: ARI_MODEL_VERSION,
      },
    ).select(
      "id, status, conversation_id, cas_won, failure_message_id",
    ).maybeSingle()
    : await pendingStateClient.rpc(
      "terminalize_agent_pending_action",
      {
        p_pending_action_id: input.id,
        p_user_id: input.userId,
        p_expected_status: input.expectedStatus,
        p_outcome: input.outcome,
        p_result: input.result ?? null,
        p_failure_reason: input.failureReason ?? null,
        p_prompt_version: TENANT_CONTEXT_VERSION,
        p_model_version: ARI_MODEL_VERSION,
        p_require_operation_receipt: input.requireOperationReceipt ?? false,
      },
    ).select("id, status, conversation_id, cas_won").maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "terminal_state_not_committed");
  }
  const terminalMessageId = await findTerminalMessageId(pendingStateClient, {
    conversationId: data.conversation_id as string | null,
    pendingActionId: input.id,
    userId: input.userId,
    outcome: input.outcome,
  });
  const failureMessageId = (data as unknown as {
    failure_message_id?: unknown;
  }).failure_message_id;
  return {
    id: data.id as string,
    status: data.status as string,
    // false when another request already terminalized it (a replay).
    casWon: (data as { cas_won?: unknown }).cas_won !== false,
    ...(terminalMessageId ? { terminalMessageId } : {}),
    ...(typeof failureMessageId === "string" ? { failureMessageId } : {}),
  };
}

async function amendedCardError(
  client: ReturnType<typeof buildServiceClient>,
  pending: { id: string; user_id?: string; conversation_id: string | null },
  userId: string,
): Promise<Response> {
  const { data } = pending.conversation_id
    ? await client.from("agent_pending_actions")
      .select("id")
      .eq("user_id", userId)
      .eq("conversation_id", pending.conversation_id)
      .eq("source", "ari")
      .eq("status", "pending")
      .neq("id", pending.id)
      .limit(1)
    : { data: [] };
  return data && data.length > 0
    ? errorResponse(
      409,
      "STALE",
      "A newer version of this change is waiting for you.",
    )
    : errorResponse(
      409,
      "STALE_AMENDED",
      "This card changed after your last message. Ask Ari to show it again.",
    );
}

function scopeQuestion(issue: AriScopeIssue): string {
  return issue.message.includes("ticket type")
    ? "Which ticket type should this apply to?"
    : "Which event or listing should this apply to?";
}

async function originatingAriScopeIssue(args: {
  client: SupabaseClient;
  userId: string;
  conversationId: string | null;
  originClientTurnId: string | null;
  brandId: string | null;
  source: string | null;
  toolName: string;
  toolArgs: Record<string, unknown>;
}): Promise<AriScopeIssue | null> {
  if (args.source !== "ari") return null;
  if (!args.conversationId || !args.originClientTurnId) {
    return proposalScopeIssue({
      toolName: args.toolName,
      args: args.toolArgs,
      scopeReadFailed: true,
    });
  }
  const { data: ownerMessage, error: ownerError } = await args.client.from(
    "agent_messages",
  )
    .select("id,content,created_at")
    .eq("user_id", args.userId)
    .eq("conversation_id", args.conversationId)
    .eq("client_turn_id", args.originClientTurnId)
    .eq("role", "user")
    .maybeSingle();
  const currentText =
    typeof (ownerMessage?.content as { text?: unknown } | null)
        ?.text === "string"
      ? String((ownerMessage?.content as { text: string }).text)
      : "";
  const { data: scopeRows, error: historyError } = ownerMessage
    ? await args.client.from("agent_messages")
      .select("role,content,created_at")
      .eq("user_id", args.userId)
      .eq("conversation_id", args.conversationId)
      .lte("created_at", ownerMessage.created_at)
      .order("created_at", { ascending: false })
      .limit(4)
    : { data: null, error: ownerError };
  const ownerText = ariScopeTextForTurn(
    (scopeRows ?? []).reverse().map((row) => ({
      role: row.role,
      text: typeof (row.content as { text?: unknown } | null)?.text === "string"
        ? String((row.content as { text: string }).text)
        : "",
    })),
    currentText,
  );
  const readFailed = Boolean(ownerError || !ownerMessage || historyError);
  const statedScope = readFailed
    ? null
    : await resolveAriStatedScope(args.client, args.brandId, ownerText);
  return proposalScopeIssue({
    toolName: args.toolName,
    args: args.toolArgs,
    hostText: ownerText,
    statedScope,
    scopeReadFailed: readFailed,
  });
}

// The status map and the ambiguity decision live in executionOutcome.ts so
// tests can execute them without starting this server.
export { toolErrorHttpStatus } from "./executionOutcome.ts";

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
  return [safePrevious, `[task-v1] ${safeEvent}`].filter(Boolean).join("\n")
    .slice(-2000);
}

function createdResource(
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

function proactiveChoices(
  resource: { kind: string; id: string; label: string } | undefined,
): AgentChoicesV2 | undefined {
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
  if (error || !data) {
    throw new TaskStateError(
      "TASK_RECOVERY_REQUIRED",
      "Conversation task state is unavailable",
    );
  }
  const row = data as ConversationTaskRow;
  return { row, state: parseTaskState(row.task_state) };
}

async function persistTaskOutcome(args: {
  client: SupabaseClient;
  userId: string;
  conversation: { row: ConversationTaskRow; state: TaskStateV1 } | null;
  pendingActionId: string;
  outcome: "executed" | "failed" | "cancelled" | "expired";
  toolName: string;
  result?: unknown;
  errorCode?: string;
  assistantMessageId?: string;
  choices?: AgentChoicesV2;
}): Promise<number | undefined> {
  if (
    !args.conversation ||
    args.conversation.state.active_task?.pending_action_id !==
      args.pendingActionId
  ) return undefined;
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
  const expectedRevision = args.conversation.row.task_state_revision;
  const nowIso = new Date().toISOString();
  const { data, error } = await args.client.rpc("commit_agent_task_outcome", {
    p_user_id: args.userId,
    p_conversation_id: args.conversation.row.id,
    p_expected_revision: expectedRevision,
    p_task_state: next,
    p_summary: safeSummary(
      args.conversation.row.summary,
      `Confirmation ${args.outcome} for ${args.toolName}.`,
    ),
    p_summary_through_message_id: args.assistantMessageId ?? null,
    p_now: nowIso,
  });
  if (error || data !== true) {
    throw new TaskStateError(
      "TASK_STATE_CONFLICT",
      "Task state changed during confirmation",
    );
  }
  return expectedRevision + 1;
}

Deno.serve(async (req) => {
  return await runWithAriRequest({
    requestIdHeader: req.headers.get("x-request-id"),
  }, async () => {
    emitAriPhase("received", { operationState: "none" });
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
    const ariUiCapabilities = parseAriUiCapabilities(body.ari_ui);

    if (typeof body.pending_action_id !== "string") {
      return errorResponse(400, "BAD_REQUEST", "pending_action_id required");
    }
    if (body.action !== "confirm" && body.action !== "cancel") {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "action must be 'confirm' or 'cancel'",
      );
    }
    // pending_action_id is the sole execution identity (#1972 receipt / #2060).
    updateAriRequest({ executionId: body.pending_action_id });

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

    const { data: userData, error: userErr } = await userClient.auth.getUser(
      jwt,
    );
    if (userErr || !userData?.user) {
      return errorResponse(401, "UNAUTHORIZED", "Invalid or expired session");
    }
    const userId = userData.user.id;
    emitAriPhase("authorized", { operationState: "pending" });
    let pendingStateClient: ReturnType<typeof buildServiceClient>;
    try {
      pendingStateClient = buildServiceClient();
    } catch {
      return errorResponse(
        500,
        "INTERNAL",
        "Pending-action authority unavailable",
      );
    }

    // Load the pending action
    const { data: pending, error: pendingErr } = await userClient
      .from("agent_pending_actions")
      .select(
        "id, conversation_id, tool_name, tool_args, status, failure_reason, expires_at, source, related_brand_id, server_proposed_at, origin_client_turn_id",
      )
      .eq("id", body.pending_action_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (pendingErr || !pending) {
      return errorResponse(404, "NOT_FOUND", "Pending action not found");
    }
    if (pending.server_proposed_at === null) {
      return errorResponse(
        400,
        "WRONG_STATE",
        "Pending action is not server-attested",
      );
    }

    return await handleConfirmAction({
      body,
      ariUiCapabilities,
      userId,
      userClient,
      pendingStateClient,
      pending,
    });
  });
});

async function handleConfirmAction(args: {
  body: RequestBody;
  ariUiCapabilities: ReturnType<typeof parseAriUiCapabilities>;
  userId: string;
  userClient: SupabaseClient;
  pendingStateClient: ReturnType<typeof buildServiceClient>;
  pending: {
    id: string;
    conversation_id: string | null;
    origin_client_turn_id: string | null;
    tool_name: string;
    tool_args: unknown;
    status: string;
    expires_at: string;
    source: string | null;
    related_brand_id: string | null;
    server_proposed_at: string | null;
    failure_reason?: string | null;
  };
}): Promise<Response> {
  const {
    body,
    ariUiCapabilities,
    userId,
    userClient,
    pendingStateClient,
    pending,
  } = args;

  let conversationTask: { row: ConversationTaskRow; state: TaskStateV1 } | null;
  let conversationBrandName: string | null = null;
  try {
    conversationTask = await loadConversationTask(
      userClient,
      pending.conversation_id,
      userId,
    );
    if (conversationTask?.row.brand_id) {
      const accessibleBrands = await resolveAccessibleAgentBrands(
        userClient,
        userId,
      );
      conversationBrandName = requireAccessibleAgentBrand(
        accessibleBrands,
        conversationTask.row.brand_id,
      ).name;
      if (
        conversationTask.state.active_task &&
        conversationTask.state.active_task.brand_id !==
          conversationTask.row.brand_id
      ) {
        return errorResponse(
          409,
          "TASK_STATE_INVALID",
          "Ari couldn't safely continue this plan. Start a new chat or try again.",
        );
      }
    }
  } catch (err: unknown) {
    if (err instanceof TaskStateError) {
      const status = err.code === "TASK_STATE_INVALID" ? 500 : 409;
      return errorResponse(
        status,
        err.code,
        err.code === "TASK_STATE_VERSION_UNSUPPORTED"
          ? "This chat is read-only. Start a new chat to continue."
          : "Ari needs to reconcile this action. Refresh the chat and try again.",
      );
    }
    return errorResponse(
      403,
      "BRAND_ACCESS_DENIED",
      "You no longer have access to this conversation's brand.",
    );
  }

  // #4389 AR-13 — a confirmation card is bound to the brand it was proposed
  // for; confirming it while another brand is selected is refused.
  if (
    body.action === "confirm" &&
    pendingActionBrandMismatch(
      // Ari rows carry their brand on the conversation; Hub rows on the action.
      pending.related_brand_id ?? conversationTask?.row.brand_id ?? null,
      body.brand_id,
    )
  ) {
    return errorResponse(
      409,
      "BRAND_MISMATCH",
      "This card belongs to another brand. Switch back to it to confirm.",
    );
  }

  // CANCEL path
  if (body.action === "cancel") {
    if (pending.status !== "pending") {
      return errorResponse(
        400,
        "WRONG_STATE",
        `Cannot cancel — current status: ${pending.status}`,
      );
    }
    const { data: cancelled, error: cancelErr } = await pendingStateClient.rpc(
      "terminalize_agent_pending_action",
      {
        p_pending_action_id: pending.id,
        p_user_id: userId,
        p_expected_status: "pending",
        p_outcome: "cancelled",
        p_result: null,
        p_failure_reason: null,
        p_prompt_version: TENANT_CONTEXT_VERSION,
        p_model_version: ARI_MODEL_VERSION,
        p_require_operation_receipt: false,
      },
    ).select("id, status").maybeSingle();
    if (cancelErr || !cancelled || cancelled.status !== "cancelled") {
      return errorResponse(
        cancelErr?.message?.includes("cas_conflict") ? 409 : 500,
        cancelErr?.message?.includes("cas_conflict")
          ? "WRONG_STATE"
          : "INTERNAL",
        `Cancel failed: ${
          cancelErr?.message ?? "terminal state not committed"
        }`,
      );
    }
    try {
      const terminalMessageId = await findTerminalMessageId(
        pendingStateClient,
        {
          conversationId: pending.conversation_id,
          pendingActionId: pending.id,
          userId,
          outcome: "cancelled",
        },
      );
      await persistTaskOutcome({
        client: pendingStateClient,
        userId,
        conversation: conversationTask,
        pendingActionId: pending.id,
        outcome: "cancelled",
        toolName: pending.tool_name,
        assistantMessageId: terminalMessageId,
      });
    } catch (err: unknown) {
      if (err instanceof TaskStateError) {
        return errorResponse(
          409,
          err.code,
          "The action was cancelled, but Ari needs a refresh to reconcile the plan.",
        );
      }
      return errorResponse(
        409,
        "TASK_RECOVERY_REQUIRED",
        "The action was cancelled, but Ari needs a refresh to reconcile the plan.",
      );
    }
    return jsonResponse(200, {
      kind: "cancelled",
      pending_action_id: pending.id,
    });
  }

  // CONFIRM path. `executing` is deliberately recoverable: the prior request
  // may have committed the domain write and lost its HTTP response. The domain
  // receipt turns this retry into a read of the committed result.
  // #2830: a teammate took this Website setup over, so this card can't save.
  // Tell the person why, instead of a status the client would quietly clear.
  if (
    pending.status === "superseded" &&
    pending.failure_reason === "flow_taken_over"
  ) {
    let name: string | undefined;
    try {
      const { data } = await pendingStateClient.rpc(
        "ari_flow_run_displacement_get",
        { p_user_id: userId, p_conversation_id: pending.conversation_id },
      );
      const taken = data as { to_name?: unknown } | null;
      if (typeof taken?.to_name === "string" && taken.to_name) {
        name = taken.to_name;
      }
    } catch {
      // The name is a courtesy; the refusal stands either way.
    }
    return ariErrorResponse(409, "FLOW_TAKEN_OVER", "", {
      taken_over_by: name,
    });
  }
  // #3355 P1: a newer proposal in this chat replaced this one. Nothing ran;
  // the owner reviews the newest card instead.
  if (pending.status === "superseded") {
    return pending.failure_reason === "OWNER_AMENDED"
      ? await amendedCardError(pendingStateClient, pending, userId)
      : errorResponse(
        409,
        "STALE",
        "A newer version of this change is waiting for you.",
      );
  }
  // #3355 bundle 5 (3(b).6): an approval that timed out inside a live flow
  // re-presents its step from a fresh read instead of dead-ending.
  const representExpired = async (): Promise<void> => {
    const brandId = conversationTask?.row.brand_id ?? null;
    await representFlowAfterExpiry({
      userClient,
      service: pendingStateClient,
      userId,
      conversationId: pending.conversation_id,
      brand: brandId
        ? { id: brandId, name: conversationBrandName ?? "your brand" }
        : null,
      expired: {
        id: pending.id,
        tool_name: pending.tool_name,
        server_proposed_at: pending.server_proposed_at ?? null,
      },
      promptVersion: TENANT_CONTEXT_VERSION,
      modelVersion: ARI_MODEL_VERSION,
    });
  };
  // #3355 bundle 5: the expiry sweep already closed this Ari approval (it
  // runs every 15 minutes), so the answers below never see it. Answer it as
  // the timeout it is — the Host shows why and resumes — and bring the flow's
  // step back, instead of a status the Host clears without a word.
  if (
    pending.status === "expired" &&
    expiredProposalAnswer(pending.source) === "ari_proposal_expired"
  ) {
    // Close the swept card for good first: a history re-read must never
    // bring it back as an answerable card.
    await closeSweptProposal(pendingStateClient, {
      userId,
      conversationId: pending.conversation_id,
      pendingActionId: pending.id,
      toolName: pending.tool_name,
      promptVersion: TENANT_CONTEXT_VERSION,
      modelVersion: ARI_MODEL_VERSION,
    });
    await representExpired();
    return ariProposalExpiredResponse();
  }
  if (
    pending.status !== "pending" &&
    !(pending.status === "executing" &&
      RECEIPT_BACKED_EVENT_TOOL_NAMES.has(pending.tool_name))
  ) {
    return errorResponse(
      400,
      "WRONG_STATE",
      `Cannot confirm — current status: ${pending.status}`,
    );
  }
  // #3355 P1 (D-14): the database clock decides expiry, not this worker's.
  let expiredByDbClock = false;
  if (pending.status === "pending") {
    try {
      const probe = await probePendingForConfirm(pendingStateClient, {
        id: pending.id,
        userId,
        expiresAt: pending.expires_at,
      });
      expiredByDbClock = probe.answer === "expired";
      if (probe.answer === "stale_amended") {
        return await amendedCardError(pendingStateClient, pending, userId);
      }
    } catch {
      return errorResponse(
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Ari couldn't check this approval right now.",
      );
    }
  }
  if (expiredByDbClock) {
    // META-ORCH-1009 Sub-E (C2, SPEC §11.4): an expired Hub proposal must NOT
    // dead-end with a 410 "Ask Ari" redirect — this Hub flow never uses Ari.
    // Lazy-expire (preserves the I-ARI-PENDING-STATE-MACHINE pending->expired
    // transition) then return an in-Hub regenerate contract the client renders
    // as a "regenerate / re-snap" CTA instead of an Accept button that 410s.
    const { data: expired, error: expireErr } = await pendingStateClient.rpc(
      "terminalize_agent_pending_action",
      {
        p_pending_action_id: pending.id,
        p_user_id: userId,
        p_expected_status: "pending",
        p_outcome: "expired",
        p_result: null,
        p_failure_reason: null,
        p_prompt_version: TENANT_CONTEXT_VERSION,
        p_model_version: ARI_MODEL_VERSION,
        p_require_operation_receipt: false,
      },
    ).select("id, status").maybeSingle();
    if (expireErr || !expired || expired.status !== "expired") {
      return errorResponse(
        expireErr?.message?.includes("cas_conflict") ? 409 : 500,
        expireErr?.message?.includes("cas_conflict")
          ? "WRONG_STATE"
          : "INTERNAL",
        `Expire failed: ${
          expireErr?.message ?? "terminal state not committed"
        }`,
      );
    }
    if (pending.conversation_id) {
      try {
        const terminalMessageId = await findTerminalMessageId(
          pendingStateClient,
          {
            conversationId: pending.conversation_id,
            pendingActionId: pending.id,
            userId,
            outcome: "expired",
          },
        );
        await persistTaskOutcome({
          client: pendingStateClient,
          userId,
          conversation: conversationTask,
          pendingActionId: pending.id,
          outcome: "expired",
          toolName: pending.tool_name,
          assistantMessageId: terminalMessageId,
        });
      } catch (err: unknown) {
        if (err instanceof TaskStateError) {
          return errorResponse(
            409,
            err.code,
            "This proposal expired. Refresh the chat to continue the plan.",
          );
        }
      }
    }
    if (expiredProposalAnswer(pending.source) === "ari_proposal_expired") {
      // #3355 bundle 5: inside a flow, the step comes back from a fresh read
      // (saved before this answer, so the Host's resume shows it).
      await representExpired();
      // #2830 (D-3) — never a silent 200: the Ari Host used to clear the card
      // and report success for an approval that saved nothing.
      return ariProposalExpiredResponse();
    }
    return jsonResponse(200, {
      kind: "expired_regenerate",
      pending_action_id: pending.id,
      status: "expired",
      // Inputs the Hub re-snap path needs to regenerate the same proposal.
      parser_source:
        ((pending.tool_args as Record<string, unknown> | null)?.parser_source as
          | string
          | null) ?? null,
      tool_name: pending.tool_name,
      brand_id: (pending.related_brand_id as string | null) ?? null,
      regenerate: {
        cta: "regenerate",
        title: "This suggestion expired",
        body:
          "Re-snap your menu or photos and we'll generate a fresh suggestion.",
      },
    });
  }

  // #2019: resolve and authorize final edited scope while still pending.
  const storedArgs = { ...(pending.tool_args as Record<string, unknown>) };
  // Proposal context is server-owned presentation data. It is neither editable
  // nor part of any model tool schema, so it must never enter final auth or the
  // domain executor (which both reject undeclared arguments).
  delete storedArgs.__proposal_context;
  const candidateArgs = pending.status === "pending" && body.edited_args &&
      typeof body.edited_args === "object"
    ? { ...(body.edited_args as Record<string, unknown>) }
    : storedArgs;
  if ("__proposal_context" in candidateArgs) {
    delete candidateArgs.__proposal_context;
  }

  let canonicalArgs: Record<string, unknown>;
  try {
    // An `executing` retry replays the args its claim already stored (they
    // were canonical when claimed). Canonicalizing them again under a newer
    // deploy would change the bytes the #1972 receipt bound, so a committed
    // edit could never replay (operation_binding_mismatch).
    if (pending.status === "pending") {
      canonicalArgs = canonicalizeAgentProposalArgs(
        pending.tool_name,
        candidateArgs,
      );
    } else {
      canonicalArgs = candidateArgs;
    }
  } catch (err: unknown) {
    if (err instanceof ToolError) {
      return errorResponse(400, err.code, err.message);
    }
    return errorResponse(
      400,
      "INVALID_ARGS",
      "The edited proposal is invalid.",
    );
  }
  const finalArgs = canonicalArgs;

  const editedScopeIssue = await originatingAriScopeIssue({
    client: userClient,
    userId,
    conversationId: pending.conversation_id,
    originClientTurnId: pending.origin_client_turn_id,
    brandId: pending.related_brand_id ?? conversationTask?.row.brand_id ?? null,
    source: pending.source,
    toolName: pending.tool_name,
    toolArgs: finalArgs,
  });
  if (editedScopeIssue) {
    return errorResponse(400, "INVALID_ARGS", scopeQuestion(editedScopeIssue));
  }

  const editedCreateEventTask = body.edited_args && pending.conversation_id &&
      conversationTask?.state.active_task?.intent === "create_event"
    ? conversationTask
    : null;
  let claimEstablished = pending.status === "executing";
  const ensureFinalClaim = async (): Promise<Response | null> => {
    if (claimEstablished) return null;
    let claim: Awaited<ReturnType<typeof claimPendingForConfirm>>;
    try {
      claim = await claimPendingForConfirm(pendingStateClient, {
        id: pending.id,
        userId,
        status: "executing",
        toolArgs: finalArgs,
      });
    } catch {
      return errorResponse(
        409,
        "WRONG_STATE",
        "Race detected — this action was already handled",
      );
    }
    if (claim.answer === "expired") {
      return await answerClaimExpired({
        source: pending.source,
        terminalize: () =>
          terminalizePending(pendingStateClient, {
            id: pending.id,
            userId,
            expectedStatus: "pending",
            outcome: "expired",
          }).then((done) => {
            if (!done.casWon) throw new Error("expired_elsewhere");
          }),
        represent: representExpired,
        hubExpired: () =>
          errorResponse(409, "EXPIRED", "This suggestion expired."),
      });
    }
    if (claim.answer === "stale_amended") {
      return await amendedCardError(pendingStateClient, pending, userId);
    }
    if (claim.answer !== "claimed") {
      return errorResponse(
        409,
        "WRONG_STATE",
        "Race detected — this action was already handled",
      );
    }
    claimEstablished = true;
    emitAriPhase("execution_claimed", { operationState: "executing" });
    await appendPendingActivity({
      client: pendingStateClient,
      userId,
      conversationId: pending.conversation_id,
      pendingActionId: pending.id,
      eventType: "approved_action_started",
    });
    return null;
  };

  // A normal confirmation acquires the final database claim before any path
  // can terminalize or execute it. Edited event cards use the atomic
  // claim-and-replace RPC below instead.
  if (!editedCreateEventTask) {
    const claimResponse = await ensureFinalClaim();
    if (claimResponse) return claimResponse;
  }

  // Find tool + validate
  const tool = findTool(pending.tool_name);
  if (!tool) {
    const claimResponse = await ensureFinalClaim();
    if (claimResponse) return claimResponse;
    try {
      await terminalizePending(pendingStateClient, {
        id: pending.id,
        userId,
        expectedStatus: "executing",
        outcome: "failed",
        failureReason: "Unknown tool",
        failureReply: buildAriFailureReply({
          errorCode: "UNKNOWN_TOOL",
          toolName: pending.tool_name,
        }),
      });
    } catch (error) {
      return errorResponse(500, "TERMINALIZATION_FAILED", String(error));
    }
    return errorResponse(500, "INTERNAL", "Unknown tool");
  }

  try {
    await authorizeAgentTool(tool, finalArgs, userClient, userId);
  } catch (err: unknown) {
    const claimResponse = await ensureFinalClaim();
    if (claimResponse) return claimResponse;
    const code = err instanceof ToolError ? err.code : "ROLE_CHECK_UNAVAILABLE";
    const status = code === "ROLE_CHECK_UNAVAILABLE"
      ? 503
      : code === "INVALID_ARGS"
      ? 400
      : 403;
    let terminalMessageId: string | undefined;
    try {
      const terminalized = await terminalizePending(pendingStateClient, {
        id: pending.id,
        userId,
        expectedStatus: "executing",
        outcome: "failed",
        failureReason: code,
        failureReply: buildAriFailureReply({
          errorCode: code,
          toolName: pending.tool_name,
        }),
      });
      terminalMessageId = terminalized.failureMessageId ??
        terminalized.terminalMessageId;
    } catch (terminalError) {
      return errorResponse(
        500,
        "TERMINALIZATION_FAILED",
        String(terminalError),
      );
    }
    if (pending.conversation_id) {
      try {
        await persistTaskOutcome({
          client: pendingStateClient,
          userId,
          conversation: conversationTask,
          pendingActionId: pending.id,
          outcome: "failed",
          toolName: pending.tool_name,
          errorCode: code,
          assistantMessageId: terminalMessageId,
        });
      } catch {
        return errorResponse(
          409,
          "TASK_RECOVERY_REQUIRED",
          "Permissions changed and the action was stopped. Refresh the chat to continue safely.",
        );
      }
    }
    return errorResponse(
      status,
      code,
      code === "ROLE_CHECK_UNAVAILABLE"
        ? "Ari could not verify permissions right now"
        : "Your current access does not allow this action",
    );
  }

  if (editedCreateEventTask && pending.conversation_id) {
    const replacementPendingActionId = crypto.randomUUID();
    const replacementMessageId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    let replacementState: TaskStateV1;
    let canonicalArgs: Record<string, unknown>;
    try {
      const readyState = replaceCreateEventProposalArgs({
        state: editedCreateEventTask.state,
        pendingActionId: pending.id,
        toolArgs: finalArgs,
        nowIso,
      });
      canonicalArgs = assertEditedCreateEventProposal(readyState);
      await authorizeAgentTool(tool, canonicalArgs, userClient, userId);
      replacementState = markAwaitingConfirmation(
        readyState,
        replacementPendingActionId,
      );
    } catch (err: unknown) {
      if (err instanceof TaskStateError) {
        return errorResponse(
          err.code === "TASK_STATE_INVALID" ? 400 : 409,
          err.code,
          err.message,
        );
      }
      if (err instanceof ToolError) {
        return errorResponse(400, err.code, err.message);
      }
      return errorResponse(
        500,
        "TASK_RECOVERY_REQUIRED",
        "Ari could not safely replace this proposal.",
      );
    }

    const { data: replacementAnswer, error: replacementError } =
      await pendingStateClient.rpc("replace_agent_pending_action_for_edit", {
        p_pending_action_id: pending.id,
        p_user_id: userId,
        p_replacement_pending_action_id: replacementPendingActionId,
        p_tool_args: canonicalArgs,
        p_prompt_version: TENANT_CONTEXT_VERSION,
        p_model_version: ARI_MODEL_VERSION,
      });
    if (replacementError) {
      return errorResponse(
        503,
        "DEPENDENCY_UNAVAILABLE",
        "Ari couldn't safely replace this proposal right now.",
      );
    }
    if (replacementAnswer === "stale_amended") {
      return await amendedCardError(pendingStateClient, pending, userId);
    }
    if (replacementAnswer === "expired") {
      return await answerClaimExpired({
        source: pending.source,
        terminalize: () =>
          terminalizePending(pendingStateClient, {
            id: pending.id,
            userId,
            expectedStatus: "pending",
            outcome: "expired",
          }).then((done) => {
            if (!done.casWon) throw new Error("expired_elsewhere");
          }),
        represent: representExpired,
        hubExpired: () =>
          errorResponse(409, "EXPIRED", "This suggestion expired."),
      });
    }
    if (replacementAnswer !== "replaced") {
      return errorResponse(
        409,
        "WRONG_STATE",
        "This proposal was already handled. Refresh the chat.",
      );
    }

    const toolCalls = {
      tool_name: pending.tool_name,
      args: canonicalArgs,
      pending_action_id: replacementPendingActionId,
    };
    const { data: committed, error: commitError } = await pendingStateClient
      .rpc(
        "commit_agent_task_assistant_turn",
        {
          p_user_id: userId,
          p_conversation_id: pending.conversation_id,
          p_expected_revision: editedCreateEventTask.row.task_state_revision,
          p_task_state: replacementState,
          p_summary: safeSummary(
            editedCreateEventTask.row.summary,
            `Edited proposal replaced for ${pending.tool_name}.`,
          ),
          p_assistant_message_id: replacementMessageId,
          p_content: {
            text: proposalOwnerLead(pending.tool_name, canonicalArgs),
          },
          p_tool_calls: toolCalls,
          p_client_turn_id: null,
          p_prompt_version: TENANT_CONTEXT_VERSION,
          p_model_version: ARI_MODEL_VERSION,
          p_now: nowIso,
        },
      );
    if (commitError || committed !== true) {
      await pendingStateClient.from("agent_pending_actions")
        .update({ status: "cancelled", failure_reason: "TASK_STATE_CONFLICT" })
        .eq("id", replacementPendingActionId)
        .eq("user_id", userId)
        .eq("status", "pending");
      return errorResponse(
        409,
        commitError ? "TASK_RECOVERY_REQUIRED" : "TASK_STATE_CONFLICT",
        "The proposal changed in another session. Refresh the chat and review the latest plan.",
      );
    }

    return jsonResponse(200, {
      kind: "proposal_replaced",
      pending_action_id: replacementPendingActionId,
      replaced_pending_action_id: pending.id,
      tool_name: pending.tool_name,
      tool_args: canonicalArgs,
      task_state_revision: editedCreateEventTask.row.task_state_revision + 1,
    });
  }

  // Execute
  let result: unknown;
  try {
    const executionContext: SiteWorkspaceExecutionContext = {
      // Immutable server context: never copied into editable_args/tool_args.
      // #1972's receipt-backed dispatcher binds this UUID to the confirmed args.
      operationId: pending.id,
      retry: pending.status === "executing",
      // #4453 Website workspace: each step of a confirmed plan is one
      // activity row on the proposing turn (the Host shows it live).
      ...(tool.name === SITE_CHANGE_SET_TOOL
        ? {
          onSiteStep: siteStepActivityWriter({
            client: pendingStateClient,
            userId,
            conversationId: pending.conversation_id,
            pendingActionId: pending.id,
          }),
        }
        : {}),
    };
    result = await tool.executor(
      finalArgs,
      userClient,
      userId,
      executionContext,
    );
  } catch (rawErr: any) {
    // #3355 P1 (D-9): a deterministic publish/money refusal from the database
    // rolled the whole RPC back. Type it so it is terminal and worded, never
    // RPC_FAILED -> "verifying the result".
    const err: any = retypeAriRefusal(rawErr);
    const reason = err instanceof ToolError
      ? `${err.code}: ${err.message}`
      : (err?.message ?? "unknown");
    // Transport/RPC failures are ambiguous: the database transaction may have
    // committed before the response was lost. Keep `executing` so confirm can
    // safely recover through the operation receipt. Deterministic pre-write
    // validation failures remain terminal.
    const isAmbiguous = isAmbiguousExecutionFailure(
      RECEIPT_BACKED_EVENT_TOOL_NAMES.has(tool.name),
      err,
    );
    if (!isAmbiguous) {
      let terminalMessageId: string | undefined;
      try {
        await appendPendingActivity({
          client: pendingStateClient,
          userId,
          conversationId: pending.conversation_id,
          pendingActionId: pending.id,
          eventType: "finalizing_started",
        });
        const terminalized = await terminalizePending(pendingStateClient, {
          id: pending.id,
          userId,
          expectedStatus: "executing",
          outcome: "failed",
          failureReason: reason,
          failureReply: buildAriFailureReply({
            errorCode: err instanceof ToolError ? err.code : "EXECUTION_FAILED",
            toolName: tool.name,
          }),
        });
        terminalMessageId = terminalized.failureMessageId ??
          terminalized.terminalMessageId;
      } catch (terminalError) {
        return errorResponse(
          500,
          "TERMINALIZATION_FAILED",
          String(terminalError),
        );
      }
      if (pending.conversation_id) {
        try {
          await persistTaskOutcome({
            client: pendingStateClient,
            userId,
            conversation: conversationTask,
            pendingActionId: pending.id,
            outcome: "failed",
            toolName: tool.name,
            errorCode: err instanceof ToolError ? err.code : "EXECUTION_FAILED",
            assistantMessageId: terminalMessageId,
          });
        } catch {
          return errorResponse(
            409,
            "TASK_RECOVERY_REQUIRED",
            "The action failed safely, but Ari needs a refresh to continue the plan.",
          );
        }
        // #3355 P7: a refused write inside a live flow run re-presents the
        // step with the plain reason and the next choices (saved as Ari's
        // row; the Host re-reads it with flow_resume). Without this the run
        // sat waiting on a confirmation that had already failed: no card.
        const failedBrandId = conversationTask?.row.brand_id ?? null;
        if (failedBrandId) {
          try {
            await flowNextAfterConfirm({
              userClient,
              service: pendingStateClient,
              userId,
              conversationId: pending.conversation_id,
              brand: {
                id: failedBrandId,
                name: conversationBrandName ?? "your brand",
              },
              failed: {
                tool_name: tool.name,
                message: err instanceof ToolError ? err.message : "",
              },
              promptVersion: TENANT_CONTEXT_VERSION,
              modelVersion: ARI_MODEL_VERSION,
            });
          } catch (flowError) {
            // The refusal is already saved and answered; the Host's resume
            // re-reads the run either way.
            console.error(JSON.stringify({
              event: "ari_confirm_failed_next_failed",
              tool_name: tool.name,
              error: flowError instanceof Error ? flowError.name : "unknown",
            }));
          }
        }
      }
    }
    if (isAmbiguous) {
      const decision = decideAriFinalization(false, {
        state: "unavailable",
        reference: null,
      });
      if (decision.state === "executed") {
        return errorResponse(500, "EXECUTION_FAILED", "result unknown");
      }
      emitAriPhase("canonical_readback", {
        operationState: "reconciliation_required",
        errorCode: decision.code,
      });
      return errorResponse(202, decision.code, "result unknown");
    }
    if (err instanceof ToolError) {
      return errorResponse(
        toolErrorHttpStatus(err.code),
        err.code,
        err.message,
      );
    }
    return errorResponse(500, "EXECUTION_FAILED", String(reason));
  }

  let terminalMessageId: string | undefined;
  let receiptDurable = false;
  try {
    await appendPendingActivity({
      client: pendingStateClient,
      userId,
      conversationId: pending.conversation_id,
      pendingActionId: pending.id,
      eventType: "finalizing_started",
    });
    const terminalized = await terminalizePending(pendingStateClient, {
      id: pending.id,
      userId,
      expectedStatus: "executing",
      outcome: "executed",
      result,
      requireOperationReceipt: requiresOperationReceipt(
        RECEIPT_BACKED_EVENT_TOOL_NAMES.has(tool.name),
        result,
      ),
    });
    terminalMessageId = terminalized.terminalMessageId;
    receiptDurable = true;
  } catch (error) {
    const decision = decideAriFinalization(false, {
      state: "unavailable",
      reference: null,
    });
    if (decision.state === "executed") {
      return errorResponse(
        500,
        "EXECUTION_FAILED",
        error instanceof Error
          ? error.message
          : "Executed result was not durably recorded",
      );
    }
    emitAriPhase("canonical_readback", {
      operationState: "reconciliation_required",
      errorCode: decision.code,
    });
    return errorResponse(
      202,
      decision.code,
      error instanceof Error
        ? error.message
        : "Executed result was not durably recorded",
    );
  }

  const decision = decideAriFinalization(receiptDurable, {
    state: "matched",
    reference: pending.id,
    value: result,
  });
  emitAriPhase("canonical_readback", {
    operationState: decision.state === "executed"
      ? "executed"
      : "reconciliation_required",
    errorCode: decision.state === "executed" ? null : decision.code,
  });
  if (decision.state !== "executed") {
    return errorResponse(202, decision.code, "reconciliation required");
  }

  let continuation: PostApprovalContinuation | null = null;
  const deterministicEventTaskFinished = tool.name === "create_event" &&
    conversationTask?.state.active_task?.intent === "create_event";
  // #2830 P4: a live engine run owns what comes next in this chat — no
  // model continuation, and the receipt line comes from the runner's
  // canonical re-read instead of a fixed "re-checking" line.
  const liveRun = pending.conversation_id
    ? await liveFlowRunFor({
      service: pendingStateClient,
      userId,
      conversationId: pending.conversation_id,
    })
    : null;
  const websiteSetupFollowup = liveRun
    ? null
    : websiteSetupApprovedWriteFollowup(tool.name);
  // #4453 Website workspace: what happened to the plan is said by the
  // server from the result (applied, put back, or a request sent), never by
  // a model continuation.
  const siteWorkspaceFollowup = siteWorkspaceFollowupText(tool.name, result);
  if (
    pending.conversation_id && !deterministicEventTaskFinished &&
    !websiteSetupFollowup && !siteWorkspaceFollowup && !liveRun
  ) {
    const { data: loopEnabled, error: loopFlagError } = await userClient.rpc(
      "ari_agent_loop_enabled",
    );
    if (!loopFlagError && loopEnabled === true) {
      const continuationMeter = new AriTurnMeter();
      try {
        continuation = await continueAfterApprovedAction({
          client: userClient,
          serviceClient: pendingStateClient,
          userId,
          conversationId: pending.conversation_id,
          toolName: tool.name,
          result,
          meter: continuationMeter,
          toolArgs: finalArgs,
          brandId: pending.related_brand_id ?? null,
        });
        if (continuation?.kind === "proposal") {
          const nextTool = findTool(continuation.toolName);
          if (!nextTool) {
            continuation = null;
          } else {
            // #3355 rework 4 (R4-7): the same discount fill-in as agent-chat
            // before #4304 canonicalises; a question replaces the card.
            // #3355 ship-prep: origin/main's canonicalisation when the
            // continuation came from the switch's off path.
            continuation = continuation.legacy
              ? {
                ...continuation,
                toolArgs: canonicalizeAgentProposalArgs(
                  nextTool.name,
                  continuation.toolArgs,
                ),
              }
              : await prepareContinuationProposal({
                continuation,
                client: userClient,
                canonicalize: canonicalizeAgentProposalArgs,
              });
            if (continuation.kind === "proposal") {
              const continuationScopeIssue = await originatingAriScopeIssue({
                client: userClient,
                userId,
                conversationId: pending.conversation_id,
                originClientTurnId: pending.origin_client_turn_id,
                brandId: pending.related_brand_id ??
                  conversationTask?.row.brand_id ?? null,
                source: pending.source,
                toolName: continuation.toolName,
                toolArgs: continuation.toolArgs,
              });
              if (continuationScopeIssue) {
                continuation = {
                  kind: "text",
                  text: `That's saved. ${
                    scopeQuestion(continuationScopeIssue)
                  }`,
                  observations: continuation.observations,
                };
              } else {
                await authorizeAgentTool(
                  nextTool,
                  continuation.toolArgs,
                  userClient,
                  userId,
                );
              }
            }
          }
        }
      } catch (error) {
        console.error(JSON.stringify({
          event: "ari_post_approval_continuation_failed",
          tool_name: tool.name,
          error_code: error instanceof ToolError ? error.code : "UNAVAILABLE",
        }));
        continuation = null;
      }
      await recordPostApprovalMetering({
        client: pendingStateClient,
        userId,
        pendingActionId: pending.id,
        meter: continuationMeter,
      });
    }
  }
  const continuationHasScopeFailure =
    continuation?.observations.some((item) =>
      item.error && [
        "BRAND_ACCESS_DENIED",
        "TENANT_SCOPE_UNAVAILABLE",
        "PERMISSION_DENIED",
      ].includes(item.error.code)
    ) ?? false;
  // The structured event receipt is itself the canonical completion proof.
  // A weak continuation model must not append an unrelated research or scope
  // error after a successful event write; a genuine next protected proposal
  // is still persisted separately below.
  const rawFollowupText = tool.name === "create_event" ||
      (liveRun && websiteSetupApprovedWriteFollowup(tool.name))
    ? undefined
    : tool.name === "draft_campaign" ||
        tool.name === "update_campaign_draft"
    ? buildFollowupText(tool.name, result)
    : websiteSetupFollowup
    ? websiteSetupFollowup
    : siteWorkspaceFollowup
    ? siteWorkspaceFollowup
    : continuationHasScopeFailure
    ? buildFollowupText(tool.name, result)
    // #3355 rework 3 (R3-9): a continuation whose words could not be shown
    // safely, or were all claims the records do not back, says the server's
    // own receipt line.
    : continuation?.text || buildFollowupText(tool.name, result);
  // #4453: a plan that was put back saved nothing, so it gets no "Saved in
  // Mingla" receipt; the follow-up line says which step stopped it.
  const siteChangeSetNotApplied = tool.name === SITE_CHANGE_SET_TOOL &&
    (result as { status?: unknown } | null)?.status !== "applied";
  // #3355 P1 (D-6): the owner copy gate is the last word on follow-up text.
  const followupText = rawFollowupText
    ? emitOwnerText(
      "reply",
      sanitizeAriUserFacingDiagnostics(rawFollowupText),
      {
        // Never "saved" for a plan that was not applied.
        fallback: siteChangeSetNotApplied
          ? "That change could not be applied to your draft."
          : "That's saved.",
        surface: "confirm_followup",
      },
    )
    : undefined;
  const rendition = siteChangeSetNotApplied ? null : buildToolReceiptRendition({
    toolName: tool.name,
    result,
    toolArgs: finalArgs,
    brandName: conversationBrandName,
    pendingActionId: pending.id,
    capabilities: ariUiCapabilities,
    completedAt: new Date().toISOString(),
  });
  const resource = createdResource(tool.name, result);
  const choices = proactiveChoices(resource);
  const assistantMessageId = crypto.randomUUID();
  const persistedFollowupText = followupText ??
    (rendition ? `${receiptTitle(tool.name)}.` : undefined);
  if ((followupText || rendition) && pending.conversation_id) {
    await pendingStateClient.from("agent_messages").insert({
      id: assistantMessageId,
      conversation_id: pending.conversation_id,
      user_id: userId,
      role: "assistant",
      content: {
        text: persistedFollowupText ?? "",
        ...((choices || rendition)
          ? {
            structured: {
              ...(choices ? { choices } : {}),
              ...(rendition ? { rendition } : {}),
            },
          }
          : {}),
      },
      prompt_version: TENANT_CONTEXT_VERSION,
      model_version: ARI_MODEL_VERSION,
    });
  }

  let nextTaskRevision: number | undefined;
  try {
    nextTaskRevision = await persistTaskOutcome({
      client: pendingStateClient,
      userId,
      conversation: conversationTask,
      pendingActionId: pending.id,
      outcome: "executed",
      toolName: tool.name,
      result,
      assistantMessageId: (followupText || rendition) && pending.conversation_id
        ? assistantMessageId
        : terminalMessageId,
      choices,
    });
  } catch (err: unknown) {
    if (err instanceof TaskStateError) {
      return errorResponse(
        409,
        "TASK_RECOVERY_REQUIRED",
        "The action completed once, but Ari needs a refresh to reconcile the plan.",
      );
    }
    return errorResponse(
      409,
      "TASK_RECOVERY_REQUIRED",
      "The action completed once, but Ari needs a refresh to reconcile the plan.",
    );
  }

  let nextPendingActionId: string | undefined;
  if (continuation?.kind === "proposal" && pending.conversation_id) {
    nextPendingActionId = crypto.randomUUID();
    const nextAssistantMessageId = crypto.randomUUID();
    const { error: nextPendingError } = await pendingStateClient.from(
      "agent_pending_actions",
    ).insert({
      id: nextPendingActionId,
      user_id: userId,
      conversation_id: pending.conversation_id,
      origin_client_turn_id: pending.origin_client_turn_id,
      related_brand_id: pending.related_brand_id,
      // #3355 P3: the column only accepts 'ari' | 'hub_*'; 'ari_chat' was
      // refused, so chained follow-on proposals never persisted.
      source: "ari",
      tool_name: continuation.toolName,
      tool_args: continuation.toolArgs,
      status: "pending",
      server_proposed_at: new Date().toISOString(),
    });
    if (!nextPendingError) {
      const nextRendition = buildGenericProposalRendition({
        toolName: continuation.toolName,
        toolArgs: continuation.toolArgs,
        pendingActionId: nextPendingActionId,
        capabilities: ariUiCapabilities,
      });
      const { error: nextMessageError } = await pendingStateClient.from(
        "agent_messages",
      ).insert({
        id: nextAssistantMessageId,
        conversation_id: pending.conversation_id,
        user_id: userId,
        role: "assistant",
        content: {
          text: proposalOwnerLead(
            continuation.toolName,
            continuation.toolArgs,
          ),
          ...(nextRendition
            ? { structured: { rendition: nextRendition } }
            : {}),
        },
        tool_calls: {
          tool_name: continuation.toolName,
          // #3355 P1 (D-5): the next card reads the server's owner words.
          args: withProposalPresentation(
            continuation.toolName,
            continuation.toolArgs,
          ),
          pending_action_id: nextPendingActionId,
        },
        prompt_version: TENANT_CONTEXT_VERSION,
        model_version: ARI_MODEL_VERSION,
      });
      if (nextMessageError) {
        await pendingStateClient.from("agent_pending_actions")
          .update({
            status: "cancelled",
            failure_reason: "CONTINUATION_MESSAGE_FAILED",
          })
          .eq("id", nextPendingActionId)
          .eq("status", "pending");
        nextPendingActionId = undefined;
      }
    } else {
      nextPendingActionId = undefined;
    }
  }

  // #3355 P3 (3(b).5): the server decides and persists what comes next.
  let next: ConfirmNext | null = null;
  let flowState: FlowStateView | null = null;
  const conversationBrandId = conversationTask?.row.brand_id ?? null;
  if (pending.conversation_id && conversationBrandId) {
    try {
      const flow = await flowNextAfterConfirm({
        userClient,
        service: pendingStateClient,
        userId,
        conversationId: pending.conversation_id,
        brand: {
          id: conversationBrandId,
          name: conversationBrandName ?? "your brand",
        },
        confirmed: { tool_name: tool.name, result },
        promptVersion: TENANT_CONTEXT_VERSION,
        modelVersion: ARI_MODEL_VERSION,
      });
      next = flow.next;
      flowState = flow.flow_state;
      if (
        !next && !flowState && !nextPendingActionId &&
        body.continuation === "server" &&
        body.workflow_context === "website_setup"
      ) {
        next = await websiteSetupNextAfterConfirm({
          userClient,
          service: pendingStateClient,
          userId,
          conversationId: pending.conversation_id,
          brand: { id: conversationBrandId, name: conversationBrandName },
          toolName: tool.name,
          promptVersion: TENANT_CONTEXT_VERSION,
          modelVersion: ARI_MODEL_VERSION,
        });
      }
    } catch (error) {
      // The write is saved and verified; only the next step failed to load.
      // The Host resumes it with flow_resume, never by sending a message.
      console.error(JSON.stringify({
        event: "ari_confirm_next_failed",
        tool_name: tool.name,
        error: error instanceof Error ? error.name : "unknown",
      }));
    }
  }

  return jsonResponse(200, {
    kind: "executed",
    pending_action_id: pending.id,
    tool_name: tool.name,
    result,
    followup_text: followupText,
    next,
    flow_state: flowState,
    ...(nextPendingActionId
      ? { next_pending_action_id: nextPendingActionId }
      : {}),
    ...(nextTaskRevision !== undefined
      ? { task_state_revision: nextTaskRevision }
      : {}),
  });
}

export function buildFollowupText(
  toolName: string,
  result: unknown,
): string | undefined {
  try {
    if (toolName === "create_brand") {
      const name = (result as any)?.brand?.name;
      if (!name) return undefined;
      const base =
        `Created brand "${name}". Want to schedule an event under it?`;
      // ORCH-1103 — if this became the user's current brand, say so.
      return (result as any)?.set_as_default
        ? `${base} It's now your current brand.`
        : base;
    }
    if (toolName === "update_brand") {
      const name = (result as any)?.brand?.name;
      return name
        ? `Updated "${name}". Anything else?`
        : `Updated. Anything else?`;
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
    if (toolName === "draft_campaign" || toolName === "update_campaign_draft") {
      const row = result as {
        name?: unknown;
        status?: unknown;
        channel?: unknown;
      } | null;
      const name = typeof row?.name === "string" ? row.name.trim() : "";
      if (!name || row?.status !== "draft") return undefined;
      const channel = row.channel === "sms" ? "SMS" : "email";
      return toolName === "draft_campaign"
        ? `Saved “${name}” as an ${channel} campaign draft. Nothing has been scheduled or sent.`
        : `Updated the saved campaign draft to “${name}”. Nothing has been scheduled or sent.`;
    }
    if (toolName === "create_experience") {
      const event = (result as { event?: unknown } | null)?.event;
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        return undefined;
      }
      const canonical = event as Record<string, unknown>;
      const title = typeof canonical.title === "string"
        ? canonical.title.trim()
        : "";
      if (
        !title || canonical.status !== "draft" ||
        canonical.visibility !== "draft" || canonical.published_at !== null
      ) {
        return undefined;
      }
      return `Created draft experience "${title}".`;
    }
    if (toolName === "upsert_ticket_tier") {
      const tierName = (result as any)?.tier?.name ??
        (result as any)?.tiers?.[0]?.name;
      return tierName
        ? `Saved ticket tier "${tierName}" and verified it on the event.`
        : `Saved the ticket tier and verified it.`;
    }
    if (toolName === "set_pricing_switches") {
      return `Saved the event pricing settings and verified the resolved result.`;
    }
    if (toolName === "set_brand_pricing_defaults") {
      return `Saved the brand pricing defaults and verified the resolved result.`;
    }
  } catch {
    // ignore
  }
  return undefined;
}
