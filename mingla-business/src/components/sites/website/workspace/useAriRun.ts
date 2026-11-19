import { useCallback, useEffect, useRef, useState } from "react";
import type { AriRuntime } from "./ariRuntime";
import type { AgentChatResponse, AgentChoicesV2 } from "../../../../services/agentChatService";
import { followAriRun } from "../../../../sites/ariRunActivity";
import {
  planFromProposal,
  questionFrom,
  runResultFrom,
  SITE_FOCUS_LABEL_MAX,
  teamRequestEditedArgs,
  teamRequestFromProposal,
  TEAM_REQUEST_TOOL,
  WORKSPACE_CONTEXT,
  type AriPlan,
  type AriQuestion,
  type AriRunResult,
  type AriSiteFocus,
  type StepEvent,
  type TeamRequestDraft,
} from "../../../../sites/ariWorkspace";

/*
 * #4453 — Ari in the Website workspace: one request becomes one visible
 * plan, applied to the DRAFT step by step while the owner watches. This is
 * its own light controller on the shared chat hook (the full Ari chat screen
 * is never loaded here). A change set is confirmed on the owner's behalf in
 * this surface only: it is draft-only, lands as "read me" and can be undone
 * as one. Anything else Ari proposes is never run from here.
 */
export type AriTurn = {
  id: string;
  request: string;
  focus: AriSiteFocus | null;
  phase: "thinking" | "running" | "asking" | "done" | "failed" | "reply" | "error" | "other";
  plan: AriPlan | null;
  events: StepEvent[];
  result: AriRunResult | null;
  reply: string | null;
  choices: AgentChoicesV2 | null;
  /** Ari's one question with answers to tap; an answer goes back as an ordinary message. */
  question: AriQuestion | null;
  error: string | null;
  /** The owner chose "Looks good" or "Undo this": the card's buttons are spent. */
  settled: null | "kept" | "undone";
};

export type AriTeamDraft = {
  turnId: string | null;
  draft: TeamRequestDraft;
  pendingActionId: string | null;
  /** Ari's whole proposal: the server takes edited words as the COMPLETE request, never a patch. */
  toolArgs: Record<string, unknown> | null;
};

const blank = (id: string, request: string, focus: AriSiteFocus | null): AriTurn => ({
  id, request, focus, phase: "thinking", plan: null, events: [], result: null, reply: null, choices: null, question: null, error: null, settled: null,
});

let counter = 0;
const nextId = () => `ari-${Date.now()}-${(counter += 1)}`;

export function useAriRun(input: {
  brandId: string;
  blockedReason: string | null;
  pageTitleOf: (pagePath: string) => string | null;
  /** The section Ari is changing right now (null: none), for the page's "Ari is changing this" mark. */
  onActiveSection: (sectionId: string | null) => void;
  /** A step landed, or the run ended: re-read the draft and refresh the page. */
  onDraftChanged: (result: AriRunResult | null) => void;
}, runtime: AriRuntime) {
  // Ari's hooks arrive through the AriChatScreen chunk (ariRuntime.ts); the
  // same runtime object is passed for the life of the component.
  const { buildChoiceSubmission, fetchAriTurnStatus } = runtime;
  const chat = runtime.useAgentChat(null, input.brandId);
  const confirmer = runtime.useConfirmPendingAction(chat.conversationId, input.brandId);
  const [turns, setTurns] = useState<AriTurn[]>([]);
  const [teamDraft, setTeamDraft] = useState<AriTeamDraft | null>(null);
  const busy = useRef(false);
  const live = useRef(input);
  live.current = input;
  const stopFollowing = useRef<(() => void) | null>(null);

  const { setSurface, setWorkflowContext, setSiteFocus, clearPendingAction } = chat;
  useEffect(() => {
    setSurface("website");
    setWorkflowContext(WORKSPACE_CONTEXT);
  }, [setSurface, setWorkflowContext]);
  useEffect(() => () => {
    stopFollowing.current?.();
  }, []);

  const patch = useCallback((id: string, change: Partial<AriTurn> | ((turn: AriTurn) => Partial<AriTurn>)) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, ...(typeof change === "function" ? change(turn) : change) } : turn)));
  }, []);

  const runPlan = useCallback(async (id: string, plan: AriPlan, pendingActionId: string, clientTurnId: string | null) => {
    patch(id, { phase: "running", plan, events: [] });
    let lastDone = 0;
    if (clientTurnId) {
      stopFollowing.current?.();
      stopFollowing.current = followAriRun(clientTurnId, (events) => {
        patch(id, { events });
        const steps = events.filter((event) => event.event_type.startsWith("site_step_"));
        const started = steps.filter((event) => event.event_type === "site_step_started").length;
        const done = steps.filter((event) => event.event_type === "site_step_done").length;
        live.current.onActiveSection(started > done ? plan.steps[Math.min(started, plan.steps.length) - 1]?.sectionId ?? null : null);
        if (done > lastDone) {
          lastDone = done;
          live.current.onDraftChanged(null);
        }
      }, fetchAriTurnStatus);
    }
    let result: AriRunResult;
    try {
      result = runResultFrom(await confirmer.confirm(pendingActionId, undefined, WORKSPACE_CONTEXT));
    } catch {
      result = { ok: false, groupId: null, partly: true, failedIndex: null, failedLabel: null, reason: "I lost the connection while changing your draft" };
    }
    // The change set's group IS the approval's id (the server runs the plan
    // under it), so a run whose answer never arrived, or was refused as a
    // repeat, can still be undone as that one group and nothing else.
    if (result.groupId === null) result = { ...result, groupId: pendingActionId };
    stopFollowing.current?.();
    stopFollowing.current = null;
    clearPendingAction();
    live.current.onActiveSection(null);
    patch(id, { phase: result.ok ? "done" : "failed", result });
    live.current.onDraftChanged(result);
  }, [clearPendingAction, confirmer, fetchAriTurnStatus, patch]);

  const handle = useCallback(async (id: string, response: AgentChatResponse) => {
    if (response.kind === "pending_action") {
      const plan = planFromProposal(response.tool_name, response.tool_args);
      if (plan) {
        await runPlan(id, plan, response.pending_action_id, response.client_turn_id ?? null);
        return;
      }
      if (response.tool_name === TEAM_REQUEST_TOOL) {
        const draft = teamRequestFromProposal(response.tool_name, response.tool_args, live.current.pageTitleOf);
        if (draft) {
          patch(id, { phase: "reply", reply: "I can’t do this one myself yet, but the Mingla team can. I wrote the request for you." });
          setTeamDraft({
            turnId: id,
            draft,
            pendingActionId: response.pending_action_id,
            toolArgs: response.tool_args && typeof response.tool_args === "object" ? { ...(response.tool_args as Record<string, unknown>) } : null,
          });
          return;
        }
      }
      // Not a website draft change: never run it from here.
      patch(id, { phase: "other", reply: "That needs your go-ahead in the full Ari chat, so I haven’t done it here." });
      return;
    }
    if (response.kind === "text") {
      const question = questionFrom(response.site_question);
      patch(id, question
        ? { phase: "asking", reply: response.text, question }
        : response.choices
          ? { phase: "asking", reply: response.text, choices: response.choices }
          : { phase: "reply", reply: response.text });
      return;
    }
    if (response.kind === "question_stale") {
      patch(id, { phase: "reply", reply: response.message });
      return;
    }
    patch(id, { phase: "error", error: response.message || "Ari couldn’t answer just now. Nothing on your draft changed." });
  }, [patch, runPlan]);

  const send = useCallback(async (id: string, run: () => Promise<AgentChatResponse>) => {
    busy.current = true;
    try {
      await handle(id, await run());
    } catch {
      patch(id, { phase: "error", error: "Ari couldn’t be reached. Nothing on your draft changed. Check your connection and try again." });
    } finally {
      busy.current = false;
    }
  }, [handle, patch]);

  /** A new request. Returns why it could not start (null: it started). */
  const ask = useCallback((text: string, focus: AriSiteFocus | null = null): string | null => {
    const request = text.trim();
    if (!request) return "Say what you’d like changed.";
    if (live.current.blockedReason) return live.current.blockedReason;
    if (busy.current) return "Ari is still working on your last request.";
    const id = nextId();
    setTeamDraft(null);
    setTurns((current) => [...current, blank(id, request, focus)]);
    // Exactly the five fields the server accepts; the label is cut to its limit.
    setSiteFocus(focus ? { ...focus, section_label: focus.section_label.slice(0, SITE_FOCUS_LABEL_MAX) } : null);
    void send(id, () => chat.sendMessage(request));
    return null;
  }, [chat, send, setSiteFocus]);

  /** Tap an answer: `option` is the label (site_question) or the option id (choices). */
  const answer = useCallback((turnId: string, option: string): string | null => {
    const turn = turns.find((entry) => entry.id === turnId);
    if (!turn) return "That question has moved on.";
    if (busy.current) return "Ari is still working on your last request.";
    if (turn.question) {
      if (!turn.question.options.includes(option)) return "That question has moved on.";
      patch(turnId, { phase: "reply", question: null, reply: [turn.reply, turn.question.prompt].filter(Boolean).join("\n") });
      return ask(option, turn.focus);
    }
    const choice = turn.choices?.options.find((entry) => entry.id === option);
    if (!turn.choices || !choice) return "That question has moved on.";
    const submission = buildChoiceSubmission(turn.choices, [option]);
    if (!submission) return "That answer couldn’t be sent.";
    patch(turnId, { phase: "reply", choices: null });
    const id = nextId();
    setTurns((current) => [...current, blank(id, choice.label, turn.focus)]);
    setSiteFocus(turn.focus);
    void send(id, () => chat.sendChoice(submission, choice.label));
    return null;
  }, [ask, buildChoiceSubmission, chat, patch, send, setSiteFocus, turns]);

  const retry = useCallback((turnId: string) => {
    const turn = turns.find((entry) => entry.id === turnId);
    if (!turn) return;
    setTurns((current) => current.filter((entry) => entry.id !== turnId));
    ask(turn.request, turn.focus);
  }, [ask, turns]);

  const settle = useCallback((turnId: string, how: "kept" | "undone") => patch(turnId, { settled: how }), [patch]);

  /** "Not now" on a request Ari proposed: tell the server it was declined. */
  const dropTeamDraft = useCallback(() => {
    const current = teamDraft;
    setTeamDraft(null);
    if (current?.pendingActionId) {
      void confirmer.cancel(current.pendingActionId).catch(() => undefined);
      clearPendingAction();
    }
  }, [clearPendingAction, confirmer, teamDraft]);

  /** Send a request Ari proposed, with the owner's edited words. */
  const confirmTeamDraft = useCallback(async (what: string): Promise<{ ok: boolean; message: string | null }> => {
    const pendingActionId = teamDraft?.pendingActionId;
    if (!pendingActionId) return { ok: false, message: "That request is no longer waiting." };
    const response = await confirmer.confirm(pendingActionId, teamRequestEditedArgs(teamDraft?.toolArgs ?? null, what), WORKSPACE_CONTEXT);
    clearPendingAction();
    if (response.kind === "executed") return { ok: true, message: null };
    return { ok: false, message: response.kind === "error" && response.message ? response.message : "The request wasn’t sent. Try again." };
  }, [clearPendingAction, confirmer, teamDraft]);

  const working = turns.some((turn) => turn.phase === "thinking" || turn.phase === "running");
  return {
    turns,
    working,
    ask,
    answer,
    retry,
    settle,
    teamDraft,
    openTeamDraft: (draft: TeamRequestDraft, turnId: string | null = null) => setTeamDraft({ turnId, draft, pendingActionId: null, toolArgs: null }),
    closeTeamDraft: () => setTeamDraft(null),
    dropTeamDraft,
    confirmTeamDraft,
    clear: () => { if (!busy.current) setTurns([]); },
  };
}

export type AriRun = ReturnType<typeof useAriRun>;
