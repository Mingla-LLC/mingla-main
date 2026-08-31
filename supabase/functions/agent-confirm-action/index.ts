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

interface RequestBody {
  action: "confirm" | "cancel";
  pending_action_id: string;
  edited_args?: Record<string, unknown>;
}

type Response_ =
  | {
    kind: "executed";
    pending_action_id: string;
    tool_name: string;
    result: unknown;
    followup_text?: string;
    task_state_revision?: number;
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse(status, { kind: "error", code, message });
}

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
  },
): Promise<{ id: string; status: string; terminalMessageId?: string }> {
  const { data, error } = await pendingStateClient.rpc(
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
  ).select("id, status, conversation_id").maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "terminal_state_not_committed");
  }
  const terminalMessageId = await findTerminalMessageId(pendingStateClient, {
    conversationId: data.conversation_id as string | null,
    pendingActionId: input.id,
    userId: input.userId,
    outcome: input.outcome,
  });
  return {
    id: data.id as string,
    status: data.status as string,
    ...(terminalMessageId ? { terminalMessageId } : {}),
  };
}

/**
 * The HTTP status for a `ToolError` raised by a tool executor.
 *
 * 4xx = recoverable validation errors that the user can resolve by adjusting
 * their request (rename the brand, pick a different event, choose a different
 * visibility). 5xx is reserved for genuine server-side issues.
 *
 * Hoisted out of the catch block so it is CALLABLE by a test. Per #2113 a check
 * that can only read source text carries no information; the status mapping is
 * proven by executing this function, in
 * `supabase/functions/agent-confirm-action/__tests__/issue_2009_private_visibility_status.test.ts`.
 * The mapping itself is unchanged apart from the one branch named below.
 */
export function toolErrorHttpStatus(code: string): number {
  if (
    ["OWNERSHIP_DENIED", "ROLE_DENIED", "BRAND_ACCESS_DENIED"].includes(code)
  ) return 403;
  if (["ROLE_CHECK_UNAVAILABLE", "PAYOUT_CHECK_FAILED"].includes(code)) {
    return 503;
  }
  if (code === "INVALID_ARGS" || code === "SLUG_TAKEN") return 400;
  if (
    [
      "PAYOUT_NOT_READY",
      "TAX_REGISTRATION_REQUIRED",
      "EVENT_CURRENCY_REQUIRED",
    ].includes(code)
  ) return 409;
  // ORCH-1103 — delete refused because the brand has upcoming/live events.
  // Recoverable, user-actionable conflict (cancel/transfer first) → 409.
  if (code === "DELETE_BLOCKED_BY_EVENTS") return 409;
  // issue #2592 — an optimistic-concurrency conflict. The resource moved under
  // the caller, so the request is CORRECTLY refused and the caller resolves it
  // by re-reading the current version. That is the same 409 the Edge-owned
  // version-conflict siblings already return (`manage-stay-inventory`,
  // `stay-reservations`, `manage-brand-discovery-currency` all map their stable
  // conflict literal to 409). Before this branch a stale version fell through
  // to 500 — a server fault, and the one status the Ari envelope contract
  // classifies `safe_to_retry: true`, which is precisely what a deterministic
  // caller mistake must never be told.
  if (code === "VERSION_CONFLICT") return 409;
  // issue #2009 (BINDING SPEC AMENDMENT 3B, Defect 4) — `business_set_event_visibility`
  // refuses every transition entering or leaving Private while #1931's private-access
  // release stays frozen. This is a KNOWN, EXPECTED, CORRECTLY-REFUSED request, not a
  // server fault, and it previously fell through to 500.
  //
  // 400 rather than 403/409, to match this map's own semantics: the organiser resolves
  // it by adjusting the requested value — the shipped copy is literally "Choose Public
  // or Unlisted for now" — which is exactly the SLUG_TAKEN shape (a value the server
  // will not accept in its current state). 403 is reserved here for access denial, and
  // 409 for a conflict the user clears by acting on OTHER resources first
  // (cancel/transfer the brand's events), neither of which describes this.
  //
  // CASE-INSENSITIVE ON PURPOSE, and this is the whole reason the branch works.
  // Amendment 3B names the RPC's stable code `private_visibility_unavailable`, but the
  // code that actually ARRIVES here is the UPPERCASED one: agentTools.ts's
  // `issue2009VisibilityToolError` builds `new ToolError(code.toUpperCase(), copy)`.
  // A branch matching only the lowercase literal would read correctly, pass a
  // source-text check, and never once fire — the exact unfalsifiable-check bug class
  // #2113 exists to stop. One condition, one branch, either spelling.
  if (code.toUpperCase() === "PRIVATE_VISIBILITY_UNAVAILABLE") return 400;
  return 500;
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
    return errorResponse(
      400,
      "BAD_REQUEST",
      "action must be 'confirm' or 'cancel'",
    );
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
      "id, conversation_id, tool_name, tool_args, status, expires_at, source, related_brand_id, server_proposed_at",
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

  let conversationTask: { row: ConversationTaskRow; state: TaskStateV1 } | null;
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
      requireAccessibleAgentBrand(
        accessibleBrands,
        conversationTask.row.brand_id,
      );
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
  if (
    pending.status === "pending" &&
    new Date(pending.expires_at).getTime() < Date.now()
  ) {
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
    canonicalArgs = canonicalizeAgentProposalArgs(
      pending.tool_name,
      candidateArgs,
    );
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

  // Find tool + validate
  const tool = findTool(pending.tool_name);
  if (!tool) {
    try {
      await terminalizePending(pendingStateClient, {
        id: pending.id,
        userId,
        expectedStatus: "pending",
        outcome: "failed",
        failureReason: "Unknown tool",
      });
    } catch (error) {
      return errorResponse(500, "TERMINALIZATION_FAILED", String(error));
    }
    return errorResponse(500, "INTERNAL", "Unknown tool");
  }

  try {
    await authorizeAgentTool(tool, finalArgs, userClient, userId);
  } catch (err: unknown) {
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
        expectedStatus: "pending",
        outcome: "failed",
        failureReason: code,
      });
      terminalMessageId = terminalized.terminalMessageId;
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

  if (
    body.edited_args && pending.conversation_id &&
    conversationTask?.state.active_task?.intent === "create_event"
  ) {
    const replacementPendingActionId = crypto.randomUUID();
    const replacementMessageId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    let replacementState: TaskStateV1;
    let canonicalArgs: Record<string, unknown>;
    try {
      const readyState = replaceCreateEventProposalArgs({
        state: conversationTask.state,
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

    try {
      await terminalizePending(pendingStateClient, {
        id: pending.id,
        userId,
        expectedStatus: "pending",
        outcome: "cancelled",
        failureReason: `EDITED_REPLACEMENT:${replacementPendingActionId}`,
      });
    } catch {
      return errorResponse(
        409,
        "WRONG_STATE",
        "This proposal was already handled. Refresh the chat.",
      );
    }

    const { error: replacementError } = await pendingStateClient
      .from("agent_pending_actions")
      .insert({
        id: replacementPendingActionId,
        user_id: userId,
        conversation_id: pending.conversation_id,
        tool_name: pending.tool_name,
        tool_args: canonicalArgs,
        status: "pending",
        server_proposed_at: nowIso,
      });
    if (replacementError) {
      return errorResponse(
        409,
        "TASK_RECOVERY_REQUIRED",
        "The old proposal was stopped, but Ari could not save the replacement. Refresh the chat.",
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
          p_expected_revision: conversationTask.row.task_state_revision,
          p_task_state: replacementState,
          p_summary: safeSummary(
            conversationTask.row.summary,
            `Edited proposal replaced for ${pending.tool_name}.`,
          ),
          p_assistant_message_id: replacementMessageId,
          p_content: { text: "" },
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
      task_state_revision: conversationTask.row.task_state_revision + 1,
    });
  }

  // Persist edited args together with the atomic pending -> executing flip.
  // A recovery request therefore replays the exact confirmed payload.
  if (pending.status === "pending") {
    // #1985 retest coordination: the assistant proposal row is the canonical
    // refresh surface. Replace its structured args before execution so a
    // reload cannot resurrect the model's pre-edit slots as confirmable.
    if (pending.conversation_id) {
      const { error: proposalErr } = await pendingStateClient
        .from("agent_messages")
        .update({
          tool_calls: {
            tool_name: pending.tool_name,
            args: finalArgs,
            pending_action_id: pending.id,
          },
        })
        .eq("user_id", userId)
        .eq("conversation_id", pending.conversation_id)
        .eq("role", "assistant")
        .contains("tool_calls", { pending_action_id: pending.id });
      if (proposalErr) {
        return errorResponse(
          500,
          "INTERNAL",
          `Proposal update failed: ${proposalErr.message}`,
        );
      }
    }
    const { data: flipped, error: flipErr } = await pendingStateClient
      .from("agent_pending_actions")
      .update({
        status: "executing",
        tool_args: finalArgs,
        execution_attested_at: new Date().toISOString(),
      })
      .eq("id", pending.id)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (flipErr || !flipped) {
      return errorResponse(
        409,
        "WRONG_STATE",
        "Race detected — this action was already handled",
      );
    }
  }

  // Execute
  let result: unknown;
  try {
    result = await tool.executor(finalArgs, userClient, userId, {
      // Immutable server context: never copied into editable_args/tool_args.
      // #1972's receipt-backed dispatcher binds this UUID to the confirmed args.
      operationId: pending.id,
    });
  } catch (err: any) {
    const reason = err instanceof ToolError
      ? `${err.code}: ${err.message}`
      : (err?.message ?? "unknown");
    // Transport/RPC failures are ambiguous: the database transaction may have
    // committed before the response was lost. Keep `executing` so confirm can
    // safely recover through the operation receipt. Deterministic pre-write
    // validation failures remain terminal.
    const isAmbiguous = RECEIPT_BACKED_EVENT_TOOL_NAMES.has(tool.name) &&
      (!(err instanceof ToolError) ||
        ["RPC_FAILED", "EDGE_FAILED", "WRITE_FAILED"].includes(err.code));
    if (!isAmbiguous) {
      let terminalMessageId: string | undefined;
      try {
        const terminalized = await terminalizePending(pendingStateClient, {
          id: pending.id,
          userId,
          expectedStatus: "executing",
          outcome: "failed",
          failureReason: reason,
        });
        terminalMessageId = terminalized.terminalMessageId;
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
      }
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
  try {
    const terminalized = await terminalizePending(pendingStateClient, {
      id: pending.id,
      userId,
      expectedStatus: "executing",
      outcome: "executed",
      result,
      requireOperationReceipt: RECEIPT_BACKED_EVENT_TOOL_NAMES.has(tool.name),
    });
    terminalMessageId = terminalized.terminalMessageId;
  } catch (error) {
    return errorResponse(
      500,
      "TERMINALIZATION_FAILED",
      error instanceof Error
        ? error.message
        : "Executed result was not durably recorded",
    );
  }

  const followupText = buildFollowupText(tool.name, result);
  const resource = createdResource(tool.name, result);
  const choices = proactiveChoices(resource);
  const assistantMessageId = crypto.randomUUID();
  if (followupText && pending.conversation_id) {
    await pendingStateClient.from("agent_messages").insert({
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
  try {
    nextTaskRevision = await persistTaskOutcome({
      client: pendingStateClient,
      userId,
      conversation: conversationTask,
      pendingActionId: pending.id,
      outcome: "executed",
      toolName: tool.name,
      result,
      assistantMessageId: followupText && pending.conversation_id
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

  return jsonResponse(200, {
    kind: "executed",
    pending_action_id: pending.id,
    tool_name: tool.name,
    result,
    followup_text: followupText,
    ...(nextTaskRevision !== undefined
      ? { task_state_revision: nextTaskRevision }
      : {}),
  });
});

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
