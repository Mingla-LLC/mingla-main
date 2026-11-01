/**
 * Issue #3355 P3 — glue between the flow runner and the Ari edge functions
 * (agent-chat, agent-confirm-action, agent-turn-control). Kept here so each
 * function only calls one helper and tests can drive it with fake clients.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { AgentChoicesV2 } from "../agentChoices.ts";
import {
  type BrandReadiness,
  readBrandReadiness,
} from "../agentReadinessTools.ts";
import type { ReadinessAction } from "../readinessCatalog.ts";
import {
  classifyOfferingIntent,
  classifyReadinessQuestion,
  findFlowDefinition,
  intentWantsPaid,
} from "./index.ts";
import { buildReadinessAnswer } from "./readinessAnswer.ts";
import { SITE_AGENT_READ_ONLY, SITE_AGENT_TOOLS } from "../agentSiteTools.ts";
import { detectWebsiteSetupIntent } from "../agentWebsiteSetup.ts";
import { WEBSITE_SETUP_FLOW, WEBSITE_SETUP_FLOW_KEY } from "./websiteSetup.ts";
import { PLAN_PARTS, type PlanPartKey } from "../siteContracts/sitePlan.ts";
import {
  runFlowStep,
  type RunnerOutcome,
  type RunnerTrigger,
} from "./runner.ts";
import {
  createFlowStore,
  FlowConflict,
  FlowEngineUnavailable,
  type FlowStore,
} from "./store.ts";
import type {
  FlowAnswer,
  FlowAnswerValues,
  FlowArtefact,
  FlowProbeDeps,
  FlowRun,
} from "./types.ts";
import { LIVE_FLOW_STATUSES } from "./types.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validate the Host's structured answer (`flow_answer`). */
export function parseFlowAnswer(value: unknown): FlowAnswer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.run_id !== "string" || !UUID.test(raw.run_id) ||
    typeof raw.question_id !== "string" || !UUID.test(raw.question_id) ||
    typeof raw.step_key !== "string" ||
    !/^[a-z][a-z_]{1,40}$/.test(raw.step_key) ||
    typeof raw.choice_id !== "string" ||
    !/^[a-z][a-z_]*(?::[a-z][a-z_.]*)?$/.test(raw.choice_id) ||
    raw.choice_id.length > 80 ||
    typeof raw.display_text !== "string" ||
    raw.display_text.trim().length === 0 || raw.display_text.length > 200
  ) return null;
  // #2830 P4: a form answer (choice "answer") carries the card control's
  // values and nothing else; a chip answer carries none.
  let values: FlowAnswerValues | undefined;
  if (raw.choice_id === "answer") {
    const parsed = parseFlowAnswerValues(raw.values);
    if (!parsed) return null;
    values = parsed;
  } else if (raw.values !== undefined) {
    return null;
  }
  return {
    run_id: raw.run_id,
    question_id: raw.question_id,
    step_key: raw.step_key,
    choice_id: raw.choice_id,
    display_text: raw.display_text.trim(),
    ...(values ? { values } : {}),
  };
}

function parseFlowAnswerValues(value: unknown): FlowAnswerValues | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).some((key) =>
      !["choices", "country", "response"].includes(key)
    )
  ) return null;
  const choices = raw.choices ?? [];
  if (
    !Array.isArray(choices) || choices.length > 10 ||
    choices.some((choice) =>
      typeof choice !== "string" || !choice.trim() || choice.length > 100
    )
  ) return null;
  const country = raw.country ?? null;
  if (
    country !== null &&
    (typeof country !== "string" || !/^[A-Z]{2}$/.test(country))
  ) return null;
  const response = raw.response ?? "";
  if (typeof response !== "string" || response.length > 2000) return null;
  if (choices.length === 0 && !response.trim()) return null;
  return {
    choices: (choices as string[]).map((choice) => choice.trim()),
    country: country as string | null,
    response: response.trim(),
  };
}

/** What every response tells the Host about the chat's run. */
export interface FlowStateView {
  run_id: string;
  /** #2830 P4: which flow (the Host shows Website setup progress for it). */
  flow_key: string;
  status: FlowRun["status"];
  current_artefact_id: string | null;
  current_step_key: string | null;
  lease_owner_name: string | null;
  /** Who started the run (shown to teammates who can only follow along). */
  owner_name: string;
  view_only: boolean;
}

export function flowStateOf(run: FlowRun | null): FlowStateView | null {
  if (!run) return null;
  const live = LIVE_FLOW_STATUSES.has(run.status);
  return {
    run_id: run.id,
    flow_key: run.flow_key,
    status: run.status,
    current_artefact_id: live
      ? run.current_artefact?.artefact_id ?? null
      : null,
    current_step_key: run.current_step_key,
    lease_owner_name: run.lease_held && !run.lease_held_by_me
      ? run.lease_owner_name
      : null,
    owner_name: run.started_by_name,
    view_only: !run.started_by_me,
  };
}

/**
 * The card's choices in the existing v2 choices shape. Each option still
 * travels to the server as a structured `flow_answer`, never as text.
 */
export function flowChoices(
  artefact: FlowArtefact,
): AgentChoicesV2 | undefined {
  if (!artefact.question_id || artefact.options.length === 0) return undefined;
  return {
    schema_version: 2,
    question_id: artefact.question_id,
    kind: "next_step",
    prompt: artefact.title,
    required_slot_keys: [],
    options: artefact.options.slice(0, 4).map((option) => ({
      id: option.id,
      label: option.label,
      payload: option.route
        ? { type: "handoff" as const, route: option.route }
        : {
          type: "slot_patch" as const,
          slot_updates: { flow_choice: option.id },
        },
    })),
  };
}

/**
 * #2830 P4 — the extra structured content an agent-chat reply needs for a
 * flow card: a form card's control (its rendition). Every row that shows a
 * form card must carry it, or the owner sees the question with no control.
 */
export function flowReplyStructured(
  artefact: FlowArtefact | null,
): { structuredData?: Record<string, unknown> } {
  return artefact?.rendition
    ? { structuredData: { rendition: artefact.rendition } }
    : {};
}

/** Assistant row content for a flow artefact. */
export function flowMessageContent(
  text: string,
  artefact: FlowArtefact | null,
  state: FlowStateView | null,
): Record<string, unknown> {
  const choices = artefact ? flowChoices(artefact) : undefined;
  return {
    text,
    ...(artefact || state
      ? {
        structured: {
          ...(artefact ? { flow: artefact } : {}),
          ...(choices ? { choices } : {}),
          // #2830 P4: a form card's control rides as its rendition.
          ...(artefact?.rendition ? { rendition: artefact.rendition } : {}),
          ...(state ? { flow_state: state } : {}),
        },
      }
      : {}),
  };
}

const SITE_READS: ReadonlyMap<string, (typeof SITE_AGENT_TOOLS)[number]> =
  new Map(
    SITE_AGENT_TOOLS.filter((tool) => SITE_AGENT_READ_ONLY.has(tool.name))
      .map((tool) => [tool.name, tool]),
  );

/** Canonical reads the runner makes for one brand, memoised per request. */
export function buildFlowProbeDeps(
  userClient: SupabaseClient,
  brandId: string,
  userId?: string,
  conversationId?: string,
): FlowProbeDeps {
  const cache = new Map<string, Promise<BrandReadiness>>();
  const reads = new Map<string, Promise<unknown>>();
  return {
    // #2830 P4: one read-only Website tool as the caller, memoised for the
    // request. A write tool is never reachable here.
    readTool(name: string, args: Record<string, unknown>) {
      const tool = SITE_READS.get(name);
      if (!tool || !userId) {
        return Promise.reject(new Error(`read ${name} unavailable`));
      }
      const key = `${name}:${JSON.stringify(args)}`;
      let pending = reads.get(key);
      if (!pending) {
        pending = tool.executor(args, userClient, userId, {
          operationId: null,
        });
        reads.set(key, pending);
      }
      return pending;
    },
    async hasOpenProposal() {
      if (!userId || !conversationId) return false;
      const { data, error } = await userClient.from("agent_pending_actions")
        .select("id")
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .limit(1);
      return !error && Array.isArray(data) && data.length > 0;
    },
    readiness(action: ReadinessAction | null) {
      const key = action ?? "all";
      let pending = cache.get(key);
      if (!pending) {
        pending = readBrandReadiness(userClient, brandId, action);
        cache.set(key, pending);
      }
      return pending;
    },
    async subjectExists(table: string, id: string) {
      if (!["events"].includes(table)) return false;
      const { data, error } = await userClient.from(table)
        .select("id")
        .eq("id", id)
        .eq("brand_id", brandId)
        .maybeSingle();
      return !error && !!data;
    },
    async setAside(itemKey: string) {
      cache.clear();
      const { error } = await userClient.rpc("brand_readiness_defer", {
        p_brand_id: brandId,
        p_item_key: itemKey,
        p_reason: "Not now (from Ari)",
      });
      return error ? "session_only" : "brand";
    },
  };
}

export type FlowTurnDecision =
  | { kind: "none" }
  | {
    kind: "reply";
    text: string;
    artefact: FlowArtefact | null;
    state: FlowStateView | null;
    handoff_route?: string;
    classification: string;
  }
  | {
    kind: "delegate";
    semantic_message: string;
    ack?: string;
    state: FlowStateView | null;
  }
  | { kind: "stale"; next: FlowArtefact | null; state: FlowStateView | null }
  /** #2830 P4: the owner's answer becomes one protected proposal. */
  | {
    kind: "propose";
    tool_name: string;
    tool_args: Record<string, unknown>;
    rows: { label: string; value: string }[];
    ack?: string;
    state: FlowStateView | null;
  }
  /**
   * #2830 P4: not the engine's turn, but the engine owns this chat's Website
   * setup — the pre-engine Website lanes must stay out of it.
   */
  | {
    kind: "side";
    state: FlowStateView | null;
    /**
     * #3355 — the card the owner is on. If the side answer fails, it comes
     * back with plain words instead of an error (the flow is never stranded).
     */
    artefact?: FlowArtefact | null;
  };

function decisionFromOutcome(outcome: RunnerOutcome): FlowTurnDecision {
  const state = flowStateOf(outcome.run);
  switch (outcome.kind) {
    case "artefact":
    case "completed":
      return {
        kind: "reply",
        text: outcome.text,
        artefact: outcome.artefact,
        state,
        ...(outcome.kind === "artefact" && outcome.open_route
          ? { handoff_route: outcome.open_route }
          : {}),
        classification: "flow_engine",
      };
    case "notice":
      return {
        kind: "reply",
        text: outcome.text,
        // #2830 P4: a refusal or "not there yet" brings the same card back
        // under the words (same artefact id: still the one current card).
        artefact: outcome.represent ? outcome.artefact : null,
        state,
        ...(outcome.open_route ? { handoff_route: outcome.open_route } : {}),
        classification: "flow_engine",
      };
    case "busy":
      return {
        kind: "reply",
        text: outcome.text,
        artefact: null,
        state,
        classification: "flow_engine_busy",
      };
    case "cancelled":
      return {
        kind: "reply",
        text: outcome.text,
        artefact: null,
        state,
        classification: "flow_engine",
      };
    case "delegate":
      return {
        kind: "delegate",
        semantic_message: outcome.semantic_message,
        ...(outcome.ack ? { ack: outcome.ack } : {}),
        state,
      };
    case "stale":
      return { kind: "stale", next: outcome.artefact, state };
    case "propose":
      return {
        kind: "propose",
        tool_name: outcome.tool_name,
        tool_args: outcome.tool_args,
        rows: outcome.rows,
        ...(outcome.ack ? { ack: outcome.ack } : {}),
        state,
      };
    case "unchanged":
    case "pass":
      return { kind: "none" };
  }
}

export interface FlowTurnArgs {
  service: SupabaseClient;
  userClient: SupabaseClient;
  userId: string;
  brand: { id: string; name: string } | null;
  conversationId: string;
  message: string;
  flowAnswer: FlowAnswer | null;
  engineEnabled: boolean;
  /** An event plan or Website setup already owns this chat. */
  otherLaneActive: boolean;
  /**
   * #2830 P4: this turn is Website setup (the Website setup screen, or a
   * "start / continue Website setup" request).
   */
  websiteSetup?: boolean;
  /** Test seam. */
  store?: FlowStore;
  /** Test seam: the canonical reads. */
  probes?: FlowProbeDeps;
}

/**
 * The engine's say at the start of an agent-chat turn. "none" leaves every
 * existing lane exactly as it was (engine off, migration not applied, or not
 * the engine's turn).
 */
export async function decideFlowTurn(
  args: FlowTurnArgs,
): Promise<FlowTurnDecision> {
  if (!args.brand) return { kind: "none" };
  const websiteMode = args.websiteSetup === true;

  // Deterministic readiness answers: the canonical checklist, no model.
  if (!args.flowAnswer && !websiteMode) {
    const action = classifyReadinessQuestion(args.message);
    if (action) {
      try {
        const readiness = await readBrandReadiness(
          args.userClient,
          args.brand.id,
          action === "all" ? null : action,
        );
        const answer = buildReadinessAnswer({
          readiness,
          action,
          brandName: args.brand.name,
        });
        return {
          kind: "reply",
          text: answer.text,
          artefact: null,
          state: null,
          classification: "readiness_answer",
        };
      } catch (_error) {
        // READINESS_UNAVAILABLE during the deploy window: the normal lanes answer.
      }
    }
  }

  if (!args.engineEnabled) {
    return args.flowAnswer
      ? { kind: "stale", next: null, state: null }
      : { kind: "none" };
  }
  const store = args.store ?? createFlowStore(args.service, args.userId);
  const deps = {
    store,
    probes: args.probes ?? buildFlowProbeDeps(
      args.userClient,
      args.brand.id,
      args.userId,
      args.conversationId,
    ),
  };
  try {
    let run = await store.getForConversation(args.conversationId);
    const live = run && LIVE_FLOW_STATUSES.has(run.status) ? run : null;
    if (args.flowAnswer) {
      if (!live) return { kind: "stale", next: null, state: flowStateOf(run) };
      return decisionFromOutcome(
        await runFlowStep(deps, {
          run: live,
          trigger: "answer",
          answer: args.flowAnswer,
          ownerText: args.flowAnswer.display_text,
          brandName: args.brand.name,
        }),
      );
    }
    if (live) {
      const outcome = await runFlowStep(deps, {
        run: live,
        trigger: "turn",
        ownerText: args.message,
        brandName: args.brand.name,
      });
      const website = live.flow_key === WEBSITE_SETUP_FLOW_KEY;
      // #2830 P4: "Start / continue Website setup" points at the open card.
      if (
        website && outcome.kind === "notice" && outcome.unmatched &&
        isWebsiteSetupRequest(args.message)
      ) {
        return resumeWebsiteReply(outcome.run);
      }
      const decision = decisionFromOutcome(outcome);
      if (!website || decision.kind !== "none") return decision;
      // The engine owns this chat's Website setup: anything else is a side
      // question for the normal lanes, never the pre-engine Website job.
      if (isWebsiteSetupRequest(args.message)) {
        return resumeWebsiteReply(live);
      }
      const current = LIVE_FLOW_STATUSES.has(outcome.run.status)
        ? outcome.run
        : live;
      return {
        kind: "side",
        state: flowStateOf(current),
        artefact: current.current_artefact,
      };
    }
    if (websiteMode) {
      // A finished Website setup in this chat is not restarted by every
      // message on the Website screen — only by asking for it again.
      if (
        run && run.flow_key === WEBSITE_SETUP_FLOW_KEY &&
        !isWebsiteSetupRequest(args.message)
      ) {
        return { kind: "side", state: flowStateOf(run), artefact: null };
      }
      return await startWebsiteSetup(args, store, deps);
    }
    if (args.otherLaneActive) return { kind: "none" };
    const flowKey = classifyOfferingIntent(args.message);
    if (!flowKey) return { kind: "none" };
    const def = findFlowDefinition(flowKey);
    if (!def) return { kind: "none" };
    const started = await store.start({
      brandId: args.brand.id,
      flowKey: def.key,
      flowVersion: def.version,
      concurrency: def.concurrency,
      conversationId: args.conversationId,
      answers: {
        intent_text: { value: args.message.slice(0, 600), source: "owner" },
        paid: { value: intentWantsPaid(args.message), source: "owner" },
      },
    });
    run = started.run;
    return decisionFromOutcome(
      await runFlowStep(deps, {
        run,
        trigger: "turn",
        brandName: args.brand.name,
      }),
    );
  } catch (error) {
    if (
      error instanceof FlowEngineUnavailable || error instanceof FlowConflict
    ) {
      return args.flowAnswer
        ? { kind: "stale", next: null, state: null }
        : { kind: "none" };
    }
    throw error;
  }
}

/**
 * #2830 P4 — opening Website setup is a structured request, not owner words.
 * The owner's bubble says only this; the server builds the instruction the
 * pre-engine lane needs (engine off) from the request itself.
 */
export const WEBSITE_SETUP_KICKOFF_DISPLAY = "Set up my Website";

export interface WebsiteSetupKickoff {
  part: PlanPartKey | null;
}

/** Validate `website_setup_kickoff` ({ part?: plan part key }). */
export function parseWebsiteSetupKickoff(
  value: unknown,
): WebsiteSetupKickoff | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== "part")) return null;
  if (raw.part === undefined || raw.part === null) return { part: null };
  const part = PLAN_PARTS.find((candidate) => candidate.key === raw.part);
  return part ? { part: part.key } : null;
}

/**
 * The instruction the turn runs on (never shown, never stored as the owner's
 * words). It starts with "Start Website setup", which the engine reads as
 * the request to start or resume the run.
 */
export function websiteSetupKickoffInstruction(
  kickoff: WebsiteSetupKickoff,
): string {
  const label = kickoff.part
    ? PLAN_PARTS.find((part) => part.key === kickoff.part)?.label ?? null
    : null;
  return `Start Website setup.${
    label ? ` I'm working on ${label}.` : ""
  } Check the live setup plan, tell me what's done and every field gap, then offer Fix all, one gap, or Add it myself. Ask one question at a time. Don't create a draft until setup and brand context are complete.`;
}

const WEBSITE_KICKOFF =
  /^(?:start|continue|resume)\s+(?:the\s+)?website setup\b|^(?:please\s+)?publish\s+(?:my|the|our)\s+website\b|^(?:continue website setup:)|\bfix all\b[^.?!]*website|\breview every remaining website setup gap\b/i;

/** "Start / continue Website setup" and the Website setup screen's buttons. */
export function isWebsiteSetupRequest(message: string): boolean {
  const normalized = message.replace(/\s+/g, " ").trim();
  return WEBSITE_KICKOFF.test(normalized) ||
    detectWebsiteSetupIntent(normalized) !== null;
}

/**
 * #2830 P4: start (or join) the brand's one Website setup run and present its
 * first open part. A teammate's live run is shown view-only by the runner;
 * the owner's own run in another chat is never forked.
 */
async function startWebsiteSetup(
  args: FlowTurnArgs,
  store: FlowStore,
  deps: { store: FlowStore; probes: FlowProbeDeps },
): Promise<FlowTurnDecision> {
  const def = WEBSITE_SETUP_FLOW;
  const started = await store.start({
    brandId: args.brand!.id,
    flowKey: def.key,
    flowVersion: def.version,
    concurrency: def.concurrency,
    conversationId: args.conversationId,
    answers: {},
  });
  const run = started.run;
  if (
    !started.created && !started.owned_by_other &&
    run.conversation_id && run.conversation_id !== args.conversationId
  ) {
    return {
      kind: "reply",
      text:
        "You already have Website setup open in another Ari chat. Pick it up there so your answers stay in one place — nothing was changed.",
      artefact: null,
      state: null,
      classification: "flow_engine",
    };
  }
  const decision = decisionFromOutcome(
    await runFlowStep(deps, {
      run,
      trigger: "turn",
      brandName: args.brand!.name,
    }),
  );
  if (decision.kind === "reply" && started.created) {
    return {
      ...decision,
      text: `Let's set up your Website for ${
        args.brand!.name
      }. I'll go through the plan one part at a time, ask one thing at a time, and save each change only after you approve it.\n\n${decision.text}`,
    };
  }
  if (decision.kind === "none") {
    return resumeWebsiteReply(run);
  }
  return decision;
}

/**
 * #2830 P4 — "start / continue Website setup" on a run that is already open:
 * the current step comes back at the bottom of the chat, with the SAME card
 * (same artefact id), so the owner never has to scroll up for it and an
 * older copy can never be answered twice. No card open (a proposal is
 * waiting for approval, which is already at the bottom): words only.
 */
export function resumeWebsiteReply(run: FlowRun): FlowTurnDecision {
  const live = LIVE_FLOW_STATUSES.has(run.status);
  const artefact = live ? run.current_artefact : null;
  return {
    kind: "reply",
    text: artefact
      ? `Picking up Website setup where we left off.\n\n${artefact.text}`
      : "Picking up Website setup where we left off.",
    artefact,
    state: flowStateOf(run),
    classification: "flow_engine",
  };
}

/** Pre-claim check: a structured answer to a card that is no longer current. */
export async function staleFlowAnswer(args: {
  store: FlowStore;
  conversationId: string;
  answer: FlowAnswer;
}): Promise<{ next: FlowArtefact | null; state: FlowStateView | null } | null> {
  try {
    const run = await args.store.getForConversation(args.conversationId);
    if (
      run && LIVE_FLOW_STATUSES.has(run.status) &&
      run.id === args.answer.run_id &&
      run.current_question_id === args.answer.question_id &&
      run.current_step_key === args.answer.step_key
    ) return null;
    return {
      next: run && LIVE_FLOW_STATUSES.has(run.status)
        ? run.current_artefact
        : null,
      state: flowStateOf(run),
    };
  } catch (error) {
    if (error instanceof FlowEngineUnavailable) {
      return { next: null, state: null };
    }
    throw error;
  }
}

/**
 * After a confirmed write (agent-confirm-action) or on resume
 * (agent-turn-control flow_resume): run the chat's live run once.
 */
export async function runFlowForConversation(args: {
  service: SupabaseClient;
  userClient: SupabaseClient;
  userId: string;
  brand: { id: string; name: string };
  conversationId: string;
  trigger: Exclude<RunnerTrigger, "answer" | "turn">;
  confirmed?: { tool_name: string; result: unknown };
  store?: FlowStore;
  /** Test seam: the canonical reads. */
  probes?: FlowProbeDeps;
}): Promise<{ outcome: RunnerOutcome | null; run: FlowRun | null }> {
  const store = args.store ?? createFlowStore(args.service, args.userId);
  try {
    const run = await store.getForConversation(args.conversationId);
    if (!run || !LIVE_FLOW_STATUSES.has(run.status)) {
      return { outcome: null, run };
    }
    const outcome = await runFlowStep({
      store,
      probes: args.probes ?? buildFlowProbeDeps(
        args.userClient,
        args.brand.id,
        args.userId,
        args.conversationId,
      ),
    }, {
      run,
      trigger: args.trigger,
      ...(args.confirmed ? { confirmed: args.confirmed } : {}),
      brandName: args.brand.name,
    });
    return { outcome, run: outcome.run };
  } catch (error) {
    if (
      error instanceof FlowEngineUnavailable || error instanceof FlowConflict
    ) {
      return { outcome: null, run: null };
    }
    throw error;
  }
}

/** Insert one engine-authored assistant row (never a user turn). */
export async function persistFlowRow(args: {
  service: SupabaseClient;
  userId: string;
  conversationId: string;
  text: string;
  artefact: FlowArtefact | null;
  state: FlowStateView | null;
  promptVersion: string;
  modelVersion: string;
}): Promise<string | null> {
  const id = crypto.randomUUID();
  const { error } = await args.service.from("agent_messages").insert({
    id,
    conversation_id: args.conversationId,
    user_id: args.userId,
    role: "assistant",
    content: flowMessageContent(args.text, args.artefact, args.state),
    prompt_version: args.promptVersion,
    model_version: args.modelVersion,
  });
  return error ? null : id;
}

/**
 * #2830 P4 — an engine-generated turn (opening Website setup) is not an
 * owner message: its attempt is stamped `origin = 'engine'` so the daily cap
 * never counts it (migration 20280224003355). Best effort: before that
 * migration the column is missing and the turn simply counts as before.
 */
export async function markEngineOriginTurn(
  service: SupabaseClient,
  userId: string,
  attemptId: string,
): Promise<boolean> {
  try {
    const { error } = await service.from("agent_turn_attempts")
      .update({ origin: "engine" })
      .eq("id", attemptId)
      .eq("user_id", userId);
    return !error;
  } catch (_error) {
    return false;
  }
}

/**
 * #3355 — a side question's answer failed (the model could not finish).
 * The flow is never stranded on an error: the owner gets plain words and
 * the card they were on, at the bottom of the chat.
 */
export function flowSideFailureText(artefact: FlowArtefact | null): string {
  return artefact
    ? `I couldn't answer that just now, and nothing was changed. We're still on ${artefact.title}:\n\n${artefact.text}`
    : "I couldn't answer that just now, and nothing was changed. Your setup is still where we left it.";
}
