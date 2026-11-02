/**
 * Issue #3355 P3 (3(b).5) — a confirm response carries what comes next.
 *
 * After a confirmed write has been read back, the server — never the phone —
 * decides the next step and persists it as an engine-authored assistant row:
 *   - a live flow run in the chat: the step runner runs once ("confirm"
 *     trigger) and its card or evidence-backed summary is the next step;
 *   - Website setup (until #2830 P4 ports it onto the engine): the server
 *     re-reads the live setup plan and presents the next gap itself. This
 *     replaces the Host's client-authored "Continue Website setup: …" message
 *     (I-ARI-NO-CLIENT-AUTHORED-CONTINUATION). Only Hosts that send
 *     `continuation: "server"` get it, so an older Host that still sends its
 *     own message never sees two.
 * Engine rows are assistant rows only: no user row, no turn attempt, so the
 * daily owner-turn limit never counts them.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { findTool } from "../_shared/agentTools.ts";
import {
  buildWebsiteSetupPresentation,
  websiteSetupApprovedWriteFollowup,
  websiteSetupInitialCalls,
} from "../_shared/agentWebsiteSetup.ts";
import type { AgentLoopObservation } from "../_shared/agentLoop.ts";
import { assertOwnerCopy } from "../_shared/ariOwnerCopy.ts";
import {
  flowChoices,
  flowStateOf,
  type FlowStateView,
  runFlowForConversation,
} from "../_shared/ariFlows/edge.ts";
import {
  createFlowStore,
  flowEngineEnabled,
  type FlowStore,
} from "../_shared/ariFlows/store.ts";
import type {
  FlowArtefact,
  FlowProbeDeps,
} from "../_shared/ariFlows/types.ts";
import { LIVE_FLOW_STATUSES } from "../_shared/ariFlows/types.ts";

export interface ConfirmNext {
  message_id: string;
  text: string;
  artefact?: FlowArtefact;
  rendition?: unknown;
}

export interface ConfirmNextResult {
  next: ConfirmNext | null;
  flow_state: FlowStateView | null;
}

async function insertRow(args: {
  service: SupabaseClient;
  userId: string;
  conversationId: string;
  content: Record<string, unknown>;
  promptVersion: string;
  modelVersion: string;
}): Promise<string | null> {
  const id = crypto.randomUUID();
  const { error } = await args.service.from("agent_messages").insert({
    id,
    conversation_id: args.conversationId,
    user_id: args.userId,
    role: "assistant",
    content: args.content,
    prompt_version: args.promptVersion,
    model_version: args.modelVersion,
  });
  return error ? null : id;
}

export async function websiteSetupNextAfterConfirm(args: {
  userClient: SupabaseClient;
  service: SupabaseClient;
  userId: string;
  conversationId: string;
  brand: { id: string; name: string | null };
  toolName: string;
  promptVersion: string;
  modelVersion: string;
}): Promise<ConfirmNext | null> {
  if (!websiteSetupApprovedWriteFollowup(args.toolName)) return null;
  const observations: AgentLoopObservation[] = [];
  for (const call of websiteSetupInitialCalls("fix_all", args.brand.id)) {
    const tool = findTool(call.name);
    const started = Date.now();
    if (!tool) {
      observations.push({
        tool: call.name,
        args: call.args,
        error: { code: "UNKNOWN_TOOL", message: "unavailable" },
        elapsedMs: 0,
      });
      continue;
    }
    try {
      const result = await tool.executor(
        call.args,
        args.userClient,
        args.userId,
        { operationId: null },
      );
      observations.push({
        tool: call.name,
        args: call.args,
        result,
        elapsedMs: Date.now() - started,
      });
    } catch (error) {
      observations.push({
        tool: call.name,
        args: call.args,
        error: {
          code: "READ_FAILED",
          message: error instanceof Error ? error.message : "read failed",
        },
        elapsedMs: Date.now() - started,
      });
    }
  }
  const presentation = buildWebsiteSetupPresentation(
    "fix_all",
    observations,
    args.brand.name,
    args.brand.id,
  );
  if (!presentation) return null;
  const text = assertOwnerCopy(presentation.text, {
    fallback: "Here's the next Website setup step.",
    surface: "confirm_next_website",
    mode: "prose",
  });
  const messageId = await insertRow({
    service: args.service,
    userId: args.userId,
    conversationId: args.conversationId,
    content: {
      text,
      ...(presentation.rendition
        ? { structured: { rendition: presentation.rendition } }
        : {}),
    },
    promptVersion: args.promptVersion,
    modelVersion: args.modelVersion,
  });
  return messageId
    ? {
      message_id: messageId,
      text,
      ...(presentation.rendition ? { rendition: presentation.rendition } : {}),
    }
    : null;
}

/**
 * #2830 P4 — the chat's live flow run, if the engine is on and has one.
 * While a run owns the chat, the model's post-approval continuation and the
 * pre-engine Website follow-up stay out (the runner says what's next, from
 * a canonical re-read). Any failure reads as "no run": the old path stands.
 */
export async function liveFlowRunFor(args: {
  service: SupabaseClient;
  userId: string;
  conversationId: string;
  enabled?: boolean;
  store?: FlowStore;
}): Promise<{ flow_key: string; id: string } | null> {
  if (!(args.enabled ?? flowEngineEnabled())) return null;
  try {
    const store = args.store ?? createFlowStore(args.service, args.userId);
    const run = await store.getForConversation(args.conversationId);
    return run && LIVE_FLOW_STATUSES.has(run.status)
      ? { flow_key: run.flow_key, id: run.id }
      : null;
  } catch (_error) {
    return null;
  }
}

export async function flowNextAfterConfirm(args: {
  userClient: SupabaseClient;
  service: SupabaseClient;
  userId: string;
  conversationId: string;
  brand: { id: string; name: string };
  /** Absent when the write was refused (`failed`). */
  confirmed?: { tool_name: string; result: unknown };
  /**
   * #3355 P7 — the confirmed write was refused and nothing was saved. The
   * flow re-presents its step with the plain reason and the next choices,
   * so a refusal never leaves the owner at a dead end.
   */
  failed?: { tool_name: string; message: string };
  promptVersion: string;
  modelVersion: string;
  enabled?: boolean;
  /** Test seam. */
  store?: FlowStore;
  /** Test seam: the canonical reads. */
  probes?: FlowProbeDeps;
}): Promise<ConfirmNextResult> {
  if (!(args.enabled ?? flowEngineEnabled())) {
    return { next: null, flow_state: null };
  }
  const { outcome, run } = await runFlowForConversation({
    service: args.service,
    userClient: args.userClient,
    userId: args.userId,
    brand: args.brand,
    conversationId: args.conversationId,
    trigger: "confirm",
    ...(args.confirmed ? { confirmed: args.confirmed } : {}),
    ...(args.failed ? { failed: args.failed } : {}),
    ...(args.store ? { store: args.store } : {}),
    ...(args.probes ? { probes: args.probes } : {}),
  });
  const state = flowStateOf(run);
  if (
    !outcome ||
    !["artefact", "completed", "notice"].includes(outcome.kind)
  ) {
    return { next: null, flow_state: state };
  }
  const artefact = outcome.kind === "notice" ? null : (
    outcome as { artefact: FlowArtefact }
  ).artefact;
  const text = assertOwnerCopy((outcome as { text: string }).text, {
    fallback: artefact?.title ?? "Here's the next step.",
    surface: "confirm_next_flow",
    mode: "prose",
  });
  const choices = artefact ? flowChoices(artefact) : undefined;
  const messageId = await insertRow({
    service: args.service,
    userId: args.userId,
    conversationId: args.conversationId,
    content: {
      text,
      structured: {
        ...(artefact ? { flow: artefact } : {}),
        ...(choices ? { choices } : {}),
        // #2830 P4: a form card's control rides as its rendition.
        ...(artefact?.rendition ? { rendition: artefact.rendition } : {}),
        ...(state ? { flow_state: state } : {}),
      },
    },
    promptVersion: args.promptVersion,
    modelVersion: args.modelVersion,
  });
  return {
    next: messageId
      ? {
        message_id: messageId,
        text,
        ...(artefact ? { artefact } : {}),
        ...(artefact?.rendition ? { rendition: artefact.rendition } : {}),
      }
      : null,
    flow_state: state,
  };
}
