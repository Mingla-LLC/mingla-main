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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { TENANT_CONTEXT_VERSION } from "../_shared/agentSystemPrompt.ts";
import { ARI_MODEL_VERSION } from "../_shared/agentGemini.ts";
import { findTool, ToolError } from "../_shared/agentTools.ts";
import { authorizeAgentTool } from "../_shared/agentToolAuthorization.ts";
import { buildServiceClient } from "../_shared/agentRateLimit.ts";

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
  }
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

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse(status, { kind: "error", code, message });
}

const RECEIPT_BACKED_TOOL_NAMES = new Set([
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
]);

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
): Promise<{ id: string; status: string }> {
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
  ).select("id, status").maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "terminal_state_not_committed");
  }
  return data as { id: string; status: string };
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
  if (code === "ROLE_CHECK_UNAVAILABLE") return 503;
  if (code === "INVALID_ARGS" || code === "SLUG_TAKEN") return 400;
  // ORCH-1103 — delete refused because the brand has upcoming/live events.
  // Recoverable, user-actionable conflict (cancel/transfer first) → 409.
  if (code === "DELETE_BLOCKED_BY_EVENTS") return 409;
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
      RECEIPT_BACKED_TOOL_NAMES.has(pending.tool_name))
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
  const finalArgs = pending.status === "pending" && body.edited_args &&
      typeof body.edited_args === "object"
    ? body.edited_args
    : (pending.tool_args as Record<string, unknown>);

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
    try {
      await terminalizePending(pendingStateClient, {
        id: pending.id,
        userId,
        expectedStatus: "pending",
        outcome: "failed",
        failureReason: code,
      });
    } catch (terminalError) {
      return errorResponse(
        500,
        "TERMINALIZATION_FAILED",
        String(terminalError),
      );
    }
    return errorResponse(
      status,
      code,
      code === "ROLE_CHECK_UNAVAILABLE"
        ? "Ari could not verify permissions right now"
        : "Your current access does not allow this action",
    );
  }

  // Persist edited args together with the atomic pending -> executing flip.
  // A recovery request therefore replays the exact confirmed payload.
  if (pending.status === "pending") {
    // #1985 retest coordination: the assistant proposal row is the canonical
    // refresh surface. Replace its structured args before execution so a
    // reload cannot resurrect the model's pre-edit slots as confirmable.
    if (pending.conversation_id) {
      const { error: proposalErr } = await userClient
        .from("agent_messages")
        .update({
          tool_calls: {
            tool_name: pending.tool_name,
            args: finalArgs,
            pending_action_id: pending.id,
          },
        })
        .eq("conversation_id", pending.conversation_id)
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
    const isAmbiguous = RECEIPT_BACKED_TOOL_NAMES.has(tool.name) &&
      (!(err instanceof ToolError) ||
        ["RPC_FAILED", "EDGE_FAILED", "WRITE_FAILED"].includes(err.code));
    if (!isAmbiguous) {
      try {
        await terminalizePending(pendingStateClient, {
          id: pending.id,
          userId,
          expectedStatus: "executing",
          outcome: "failed",
          failureReason: reason,
        });
      } catch (terminalError) {
        return errorResponse(
          500,
          "TERMINALIZATION_FAILED",
          String(terminalError),
        );
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

  try {
    await terminalizePending(pendingStateClient, {
      id: pending.id,
      userId,
      expectedStatus: "executing",
      outcome: "executed",
      result,
      requireOperationReceipt: RECEIPT_BACKED_TOOL_NAMES.has(tool.name),
    });
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
  if (followupText && pending.conversation_id) {
    await userClient.from("agent_messages").insert({
      conversation_id: pending.conversation_id,
      user_id: userId,
      role: "assistant",
      content: { text: followupText },
      prompt_version: TENANT_CONTEXT_VERSION,
      model_version: ARI_MODEL_VERSION,
    });
  }

  return jsonResponse(200, {
    kind: "executed",
    pending_action_id: pending.id,
    tool_name: tool.name,
    result,
    followup_text: followupText,
  });
});

function buildFollowupText(
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
        ? `Created "${title}". Want to set ticket tiers?`
        : undefined;
    }
    if (toolName === "update_event") {
      return `Updated. Anything else to change?`;
    }
    if (toolName === "create_experience") {
      const title = (result as any)?.event?.title;
      return title
        ? `Published experience "${title}" to your venue.`
        : undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}
