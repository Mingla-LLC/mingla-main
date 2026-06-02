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
import { PROMPT_VERSION } from "../_shared/agentSystemPrompt.ts";
import { ARI_MODEL_VERSION } from "../_shared/agentGemini.ts";
import { findTool, ToolError } from "../_shared/agentTools.ts";

interface RequestBody {
  action: "confirm" | "cancel";
  pending_action_id: string;
  edited_args?: Record<string, unknown>;
}

type Response_ =
  | { kind: "executed"; pending_action_id: string; tool_name: string; result: unknown; followup_text?: string }
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

  // CANCEL path
  if (body.action === "cancel") {
    if (pending.status !== "pending") {
      return errorResponse(400, "WRONG_STATE", `Cannot cancel — current status: ${pending.status}`);
    }
    const { error: cancelErr } = await userClient
      .from("agent_pending_actions")
      .update({ status: "cancelled" })
      .eq("id", pending.id)
      .eq("status", "pending");
    if (cancelErr) {
      return errorResponse(500, "INTERNAL", `Cancel failed: ${cancelErr.message}`);
    }
    // Ari-only audit trail in agent_messages (Hub proposals have no conversation).
    if (pending.conversation_id) {
      await userClient.from("agent_messages").insert({
        conversation_id: pending.conversation_id,
        user_id: userId,
        role: "tool",
        content: { text: "" },
        tool_results: {
          tool_name: pending.tool_name,
          pending_action_id: pending.id,
          outcome: "cancelled",
        },
        prompt_version: PROMPT_VERSION,
        model_version: ARI_MODEL_VERSION,
      });
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

  // Atomic flip pending -> executing
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

  // Resolve final args (operator edits override model args)
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
    if (pending.conversation_id) {
      await userClient.from("agent_messages").insert({
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
        prompt_version: PROMPT_VERSION,
        model_version: ARI_MODEL_VERSION,
      });
    }
    if (err instanceof ToolError) {
      // 4xx = recoverable validation errors that the user can resolve by
      // adjusting their request (rename the brand, pick a different event,
      // etc.). 5xx is reserved for genuine server-side issues.
      let status: number;
      if (err.code === "OWNERSHIP_DENIED") status = 403;
      else if (err.code === "INVALID_ARGS" || err.code === "SLUG_TAKEN") status = 400;
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
    // Write succeeded but bookkeeping failed — log but still return success
    console.error("[agent-confirm-action] Failed to mark executed:", doneErr.message);
  }

  if (pending.conversation_id) {
    await userClient.from("agent_messages").insert({
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
      prompt_version: PROMPT_VERSION,
      model_version: ARI_MODEL_VERSION,
    });
  }

  const followupText = buildFollowupText(tool.name, result);
  if (followupText && pending.conversation_id) {
    await userClient.from("agent_messages").insert({
      conversation_id: pending.conversation_id,
      user_id: userId,
      role: "assistant",
      content: { text: followupText },
      prompt_version: PROMPT_VERSION,
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

function buildFollowupText(toolName: string, result: unknown): string | undefined {
  try {
    if (toolName === "create_brand") {
      const name = (result as any)?.brand?.name;
      return name ? `Created brand "${name}". Want to schedule an event under it?` : undefined;
    }
    if (toolName === "create_event") {
      const title = (result as any)?.event?.title;
      return title ? `Created "${title}". Want to set ticket tiers?` : undefined;
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
