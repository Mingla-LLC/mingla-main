/**
 * Issue #3355 P3 — `flow_resume`: the Host's mount / reload / reconnect /
 * handoff-return call. It is not a turn: no user row, no attempt, never
 * rate-limited. It returns the chat's current card so a reload shows the open
 * question exactly once (no duplicate card), and on handoff return it runs
 * the step runner once so a fix made elsewhere is verified and the flow moves
 * on — or, if nothing changed, the handoff simply stays open.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  flowStateOf,
  persistFlowRow,
  runFlowForConversation,
} from "../_shared/ariFlows/edge.ts";
import {
  createFlowStore,
  flowEngineEnabled,
  FlowEngineUnavailable,
  type FlowStore,
} from "../_shared/ariFlows/store.ts";
import type { FlowArtefact } from "../_shared/ariFlows/types.ts";
import { LIVE_FLOW_STATUSES } from "../_shared/ariFlows/types.ts";

import { TENANT_CONTEXT_VERSION as PROMPT_VERSION } from "../_shared/agentSystemPrompt.ts";
import { ARI_MODEL_VERSION as MODEL_VERSION } from "../_shared/agentGemini.ts";

export async function resumeFlowForHost(args: {
  service: SupabaseClient;
  userClient: SupabaseClient;
  userId: string;
  conversationId: string;
  trigger: "resume" | "handoff_return";
  enabled?: boolean;
  store?: FlowStore;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!(args.enabled ?? flowEngineEnabled())) {
    return { status: 200, body: { flow_state: null, artefact: null } };
  }
  const { data: conversation, error } = await args.userClient
    .from("agent_conversations")
    .select("id,brand_id")
    .eq("id", args.conversationId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) return { status: 500, body: { code: "RESUME_UNAVAILABLE" } };
  if (!conversation) return { status: 404, body: { code: "NOT_FOUND" } };
  if (!conversation.brand_id) {
    return { status: 200, body: { flow_state: null, artefact: null } };
  }
  const store = args.store ?? createFlowStore(args.service, args.userId);
  try {
    if (args.trigger === "resume") {
      // A plain reload reads only; it never re-probes or writes.
      const run = await store.getForConversation(args.conversationId);
      const live = run && LIVE_FLOW_STATUSES.has(run.status);
      return {
        status: 200,
        body: {
          flow_state: flowStateOf(run),
          artefact: live ? run.current_artefact : null,
        },
      };
    }
    const { data: brand } = await args.userClient.from("brands")
      .select("id,name")
      .eq("id", conversation.brand_id)
      .maybeSingle();
    const { outcome, run } = await runFlowForConversation({
      service: args.service,
      userClient: args.userClient,
      userId: args.userId,
      brand: {
        id: conversation.brand_id,
        name: typeof brand?.name === "string" ? brand.name : "your brand",
      },
      conversationId: args.conversationId,
      trigger: "handoff_return",
      store,
    });
    const state = flowStateOf(run);
    let next: Record<string, unknown> | null = null;
    if (
      outcome &&
      (outcome.kind === "artefact" || outcome.kind === "completed")
    ) {
      const messageId = await persistFlowRow({
        service: args.service,
        userId: args.userId,
        conversationId: args.conversationId,
        text: outcome.text,
        artefact: outcome.artefact,
        state,
        promptVersion: PROMPT_VERSION,
        modelVersion: MODEL_VERSION,
      });
      if (messageId) {
        next = {
          message_id: messageId,
          text: outcome.text,
          artefact: outcome.artefact,
        };
      }
    }
    const current: FlowArtefact | null =
      run && LIVE_FLOW_STATUSES.has(run.status) ? run.current_artefact : null;
    return {
      status: 200,
      body: { flow_state: state, artefact: current, next },
    };
  } catch (error) {
    if (error instanceof FlowEngineUnavailable) {
      return { status: 200, body: { flow_state: null, artefact: null } };
    }
    return { status: 500, body: { code: "RESUME_UNAVAILABLE" } };
  }
}
