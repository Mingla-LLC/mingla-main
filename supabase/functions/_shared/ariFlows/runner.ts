/**
 * Issue #3355 P3 — THE step runner. One function, invoked on every turn of a
 * chat with a live run, after every confirm, on reload/reconnect (flow_resume)
 * and on handoff return:
 *
 *   1. lease the run (one actor at a time; database clock);
 *   2. apply a bound answer, if any (stale ids are refused, never applied);
 *   3. re-read canonical state through each step's probe (read before act);
 *   4. advance to the first open step and produce exactly ONE thing: a
 *      question, a handoff, an evidence-backed summary, or a hand-over of the
 *      owner's request to the offering lane;
 *   5. persist progress with compare-and-swap, then release the lease.
 *
 * The model never calls this and never marks a step done
 * (I-ARI-FLOW-ENGINE-OWNS-PROGRESS). A card the owner is already looking at is
 * never issued twice: the same probe result reuses the current card
 * (reload-resume without duplicates), and "I've done it" with nothing done is
 * answered "I checked; … isn't there yet" while the handoff stays open.
 */

import { assertOwnerCopy } from "../ariOwnerCopy.ts";
import { readinessItemLabel } from "../readinessCatalog.ts";
import { listWords, ownerItemNoun } from "./brandGate.ts";
import { findFlowDefinition } from "./index.ts";
import { FlowConflict, type FlowStore } from "./store.ts";
import type {
  AskSpec,
  FlowAnswer,
  FlowArtefact,
  FlowContext,
  FlowDefinition,
  FlowProbeDeps,
  FlowRun,
  FlowStepRecord,
} from "./types.ts";
import { LIVE_FLOW_STATUSES } from "./types.ts";

export type RunnerTrigger =
  | "turn"
  | "answer"
  | "confirm"
  | "resume"
  | "handoff_return";

export interface RunnerInput {
  run: FlowRun;
  trigger: RunnerTrigger;
  answer?: FlowAnswer;
  ownerText?: string;
  confirmed?: { tool_name: string; result: unknown };
  brandName: string;
}

export interface RunnerDeps {
  store: FlowStore;
  probes: FlowProbeDeps;
  newId?: () => string;
  leaseSeconds?: number;
}

export type RunnerOutcome =
  /** A new card the caller persists as one assistant row. */
  | {
    kind: "artefact";
    artefact: FlowArtefact;
    text: string;
    open_route?: string;
    run: FlowRun;
  }
  /** Plain words, no new card; the current card (if any) stays current. */
  | {
    kind: "notice";
    text: string;
    artefact: FlowArtefact | null;
    open_route?: string;
    run: FlowRun;
  }
  /** Nothing new (resume / reload): the current card is the answer. */
  | { kind: "unchanged"; artefact: FlowArtefact | null; run: FlowRun }
  /** Gates passed: the offering lane takes the owner's original request. */
  | { kind: "delegate"; semantic_message: string; ack?: string; run: FlowRun }
  /** Not the engine's turn (a side question, or the offering lane's turn). */
  | { kind: "pass"; run: FlowRun }
  | {
    kind: "busy";
    text: string;
    view_only: boolean;
    artefact: FlowArtefact | null;
    run: FlowRun;
  }
  | { kind: "stale"; artefact: FlowArtefact | null; run: FlowRun }
  | {
    kind: "completed";
    artefact: FlowArtefact;
    text: string;
    run: FlowRun;
  }
  | { kind: "cancelled"; text: string; run: FlowRun };

const SETTLED = new Set(["done", "skipped", "deferred"]);

const DONE_CLAIM =
  /^(?:(?:ok(?:ay)?|great|thanks|right|so)[,.!]?\s+)?(?:(?:i[’']?ve|i have|i)\s+)?(?:just\s+)?(?:uploaded|added|approved|saved|finished|done|fixed|connected|accepted|sorted|set\s+(?:it|that|them)\s+up)\b|^(?:all\s+)?(?:done|finished|ready|sorted)\b|^it[’']?s\s+(?:there|done|up|in)\b/i;
const NOT_NOW_TEXT =
  /^(?:not\s+now|skip(?:\s+(?:it|them|this|that|those))?|later|maybe later|keep going|carry on|go ahead|no thanks)\b/i;
const STOP_TEXT = /^(?:stop|cancel|never\s?mind|forget\s+it)\b/i;

/** Map a typed reply onto the open card's choices, when it is plainly one. */
export function textChoiceFor(
  artefact: FlowArtefact | null,
  text: string | undefined,
): string | null {
  if (!artefact || !text) return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  const has = (id: string) => artefact.options.some((o) => o.id === id);
  if (DONE_CLAIM.test(normalized) && has("check")) return "check";
  if (NOT_NOW_TEXT.test(normalized)) {
    if (has("not_now")) return "not_now";
    if (has("continue")) return "continue";
  }
  if (STOP_TEXT.test(normalized) && has("cancel")) return "cancel";
  const exact = artefact.options.find((option) =>
    option.label.toLowerCase() === normalized.toLowerCase()
  );
  return exact?.id ?? null;
}

function stepIndex(def: FlowDefinition, key: string | null): number {
  return key ? def.steps.findIndex((step) => step.key === key) : -1;
}

function ownerSafe(text: string, fallback: string, surface: string): string {
  return assertOwnerCopy(text, { fallback, surface, mode: "prose" });
}

function buildArtefact(
  run: FlowRun,
  stepKey: string,
  questionId: string,
  ask: AskSpec,
  fallbackTitle: string,
): FlowArtefact {
  const prefix = ask.kind === "handoff" ? "h" : "q";
  return {
    schema_version: 1,
    artefact_id: `${prefix}:${run.id}:${questionId}`,
    run_id: run.id,
    step_key: stepKey,
    question_id: questionId,
    kind: ask.kind,
    reuse_key: ask.reuse_key,
    title: assertOwnerCopy(ask.title, {
      fallback: fallbackTitle,
      surface: "flow_title",
      mode: "label",
    }),
    text: ownerSafe(ask.text, fallbackTitle, "flow_text"),
    options: ask.options.map((option) => ({
      ...option,
      label: assertOwnerCopy(option.label, {
        fallback: "Choose this",
        surface: "flow_option",
        mode: "label",
      }),
    })),
    ...(ask.handoff ? { handoff: ask.handoff } : {}),
    ...(ask.items ? { items: ask.items } : {}),
  };
}

function setAsideLabels(run: FlowRun): string[] {
  const keys = new Set<string>();
  for (const key of ["brand_can_wait"]) {
    for (const item of run.step_states[key]?.set_aside ?? []) {
      if (run.step_states[key]?.state === "deferred") keys.add(item);
    }
  }
  return [...keys].flatMap((key) => {
    const label = readinessItemLabel(key);
    return label ? [label.charAt(0).toLowerCase() + label.slice(1)] : [];
  });
}

/** Built only from what the probes saw. */
export function summaryText(def: FlowDefinition, run: FlowRun): string {
  const later = setAsideLabels(run);
  const moneyLater = run.step_states.money_gate?.state === "deferred";
  return [
    `Your ${def.noun} draft is saved and I've checked it's there. Nobody can see it until you publish.`,
    later.length > 0
      ? `Still on your Home to-do list: ${listWords(later)}.`
      : "",
    moneyLater ? "Tickets can go on sale once payments are ready." : "",
  ].filter(Boolean).join(" ");
}

export function subjectIdFromResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const root = result as Record<string, unknown>;
  for (const key of ["event", "experience", "trip", "venue", "stay"]) {
    const nested = root[key];
    if (nested && typeof nested === "object") {
      const id = (nested as { id?: unknown }).id;
      if (typeof id === "string") return id;
    }
  }
  for (const key of ["event_id", "experience_id", "trip_id", "id"]) {
    if (typeof root[key] === "string") return root[key] as string;
  }
  return null;
}

function busyText(viewOnly: boolean, name: string | null): string {
  return viewOnly
    ? `${
      name ?? "A teammate"
    } is working on this right now. You can follow along here, but only they can answer these steps.`
    : "I'm already working on this in another window. I'll pick up here in a moment.";
}

/**
 * Run one step of a flow. Always releases its lease. Never throws for an
 * ordinary conflict: a concurrent winner's state is returned instead.
 */
export async function runFlowStep(
  deps: RunnerDeps,
  input: RunnerInput,
): Promise<RunnerOutcome> {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  let run = input.run;
  if (!LIVE_FLOW_STATUSES.has(run.status)) return { kind: "pass", run };
  const def = findFlowDefinition(run.flow_key, run.flow_version);
  if (!def) return { kind: "pass", run };

  // Fast path: the offering lane owns ordinary turns once gates have passed.
  const currentRecord = run.current_step_key
    ? run.step_states[run.current_step_key]
    : undefined;
  if (
    input.trigger === "turn" && !run.current_artefact &&
    run.current_step_key === "offering" &&
    currentRecord?.state === "delegated" && !run.subject_id
  ) {
    return { kind: "pass", run };
  }

  const token = newId();
  const lease = await deps.store.lease(run.id, token, deps.leaseSeconds ?? 30);
  if (!lease.ok) {
    if (lease.reason === "terminal") return { kind: "pass", run: lease.run };
    const viewOnly = lease.reason === "owned_by_other";
    return {
      kind: "busy",
      view_only: viewOnly,
      text: busyText(viewOnly, lease.owner_display_name),
      artefact: lease.run.current_artefact,
      run: lease.run,
    };
  }
  run = lease.run;
  try {
    return await advanceUnderLease(deps, def, run, token, input, newId);
  } finally {
    try {
      await deps.store.release(run.id, token);
    } catch (_error) {
      // The lease expires on its own within its TTL; nothing else to undo.
    }
  }
}

async function advanceUnderLease(
  deps: RunnerDeps,
  def: FlowDefinition,
  startRun: FlowRun,
  token: string,
  input: RunnerInput,
  newId: () => string,
): Promise<RunnerOutcome> {
  let run = startRun;
  const open = run.current_artefact;
  const states: Record<string, FlowStepRecord> = { ...run.step_states };
  const patchStates: Record<string, FlowStepRecord> = {};
  const patch: Record<string, unknown> = {};
  const lines: string[] = [];
  let openRoute: string | undefined;
  let checking = false;
  let answered = false;
  const nowIso = new Date().toISOString();
  const setState = (key: string, value: FlowStepRecord) => {
    const stamped = { ...value, updated_at: nowIso };
    states[key] = stamped;
    patchStates[key] = stamped;
  };
  const ctxFor = (stepKey: string): FlowContext => ({
    run: { ...run, step_states: states },
    def,
    deps: deps.probes,
    brandName: input.brandName,
    state: states[stepKey],
  });

  const commit = async (extra: Record<string, unknown>): Promise<FlowRun> => {
    const body = {
      ...patch,
      ...extra,
      ...(Object.keys(patchStates).length > 0
        ? { step_states: patchStates }
        : {}),
    };
    if (Object.keys(body).length === 0) return run;
    return await deps.store.advance(run.id, token, run.revision, body);
  };

  // ── 1. A bound answer (structured, or typed text that plainly is one) ────
  let choiceId: string | null = null;
  if (input.trigger === "answer") {
    const answer = input.answer;
    if (
      !answer || !open || answer.run_id !== run.id ||
      answer.question_id !== run.current_question_id ||
      answer.step_key !== run.current_step_key
    ) {
      return { kind: "stale", artefact: open, run };
    }
    choiceId = answer.choice_id;
  } else if (input.trigger === "turn") {
    choiceId = textChoiceFor(open, input.ownerText);
  }
  if (choiceId && open) {
    const option = open.options.find((candidate) => candidate.id === choiceId);
    const step = def.steps.find((candidate) =>
      candidate.key === run.current_step_key
    );
    if (!option || !step) return { kind: "stale", artefact: open, run };
    if (choiceId === "open") {
      return {
        kind: "notice",
        text: `Opening ${
          open.handoff?.route_label ?? "that page"
        }. Tell me when it's done and I'll check.`,
        artefact: open,
        open_route: option.route,
        run,
      };
    }
    if (choiceId === "check") {
      checking = true;
    } else {
      const outcome = await step.onAnswer?.(ctxFor(step.key), choiceId);
      if (!outcome) return { kind: "stale", artefact: open, run };
      answered = true;
      setState(step.key, outcome.record);
      if (outcome.session_skips) patch.session_skips = outcome.session_skips;
      if (outcome.ack) lines.push(outcome.ack);
      if (option.route) openRoute = option.route;
      if (outcome.cancel_run) {
        patch.status = "cancelled";
        patch.current_artefact = null;
        patch.current_question_id = null;
        run = await commit({});
        return {
          kind: "cancelled",
          text: outcome.ack ?? "Okay, I've stopped here. Nothing was changed.",
          run,
        };
      }
    }
  }

  // ── 2. A confirmed write that may have created the subject ───────────────
  if (
    input.confirmed && def.subject_tools.includes(input.confirmed.tool_name) &&
    !run.subject_id
  ) {
    const subjectId = subjectIdFromResult(input.confirmed.result);
    if (subjectId) {
      patch.subject_id = subjectId;
      run = { ...run, subject_id: subjectId };
    }
  }

  // ── 3. Re-read canonical state, first open step wins ─────────────────────
  for (const step of def.steps) {
    const rec = states[step.key];
    if (rec && (rec.state === "skipped" || rec.state === "deferred")) continue;
    if (
      step.depends_on.some((dep) =>
        !SETTLED.has(states[dep]?.state ?? "pending")
      )
    ) {
      break;
    }
    const probe = await step.probe(ctxFor(step.key));
    if ("note" in probe && probe.note) lines.push(probe.note);
    if (probe.done) {
      if (rec?.state !== "done") {
        setState(step.key, { state: "done", evidence: probe.evidence });
      }
      continue;
    }
    if ("delegate" in probe) {
      if (rec?.state === "delegated") {
        run = await commit({});
        return input.trigger === "turn"
          ? { kind: "pass", run }
          : { kind: "unchanged", artefact: null, run };
      }
      const intent = run.answers.intent_text?.value;
      const semantic = typeof intent === "string" && intent.trim()
        ? intent
        : (input.ownerText ?? "");
      if (!def.subject_table) {
        // P3: this offering's own lane creates and verifies it (P7–P9 bring
        // it onto the engine). The run's job — the preamble — is complete.
        const evidence = {
          probe: "handed_to_offering_lane",
          observed: Object.fromEntries(
            Object.entries(states).map(([key, value]) => [key, value.state]),
          ),
        };
        setState(step.key, { state: "done", evidence });
        setState("summary", {
          state: "done",
          evidence: { probe: "summary", observed: "handed_over" },
        });
        run = await commit({
          status: "completed",
          completion_evidence: evidence,
          current_step_key: step.key,
          current_question_id: null,
          current_artefact: null,
        });
      } else {
        setState(step.key, { state: "delegated" });
        run = await commit({
          status: "active",
          current_step_key: step.key,
          current_question_id: null,
          current_artefact: null,
        });
      }
      return {
        kind: "delegate",
        semantic_message: semantic,
        ...(lines.length > 0 ? { ack: lines.join(" ") } : {}),
        run,
      };
    }

    const ask = probe.ask;
    const sameCard = !!open && run.current_step_key === step.key &&
      open.reuse_key === ask.reuse_key && !answered;
    if (sameCard) {
      // Never re-issue the card the owner is already looking at.
      run = await commit({});
      const claimedDone = checking ||
        (input.trigger === "turn" && DONE_CLAIM.test(input.ownerText ?? ""));
      if (claimedDone && open?.handoff) {
        return {
          kind: "notice",
          text: `I checked; ${
            ownerItemNoun(open.handoff.item_label)
          } isn't there yet. The card above is still open whenever you're ready.`,
          artefact: open,
          run,
        };
      }
      if (input.trigger === "turn") return { kind: "pass", run };
      return lines.length > 0
        ? { kind: "notice", text: lines.join(" "), artefact: open, run }
        : { kind: "unchanged", artefact: open, run };
    }

    const questionId = newId();
    const artefact = buildArtefact(run, step.key, questionId, ask, step.title);
    setState(step.key, {
      ...ask.record,
      state: ask.kind === "handoff" ? "human_action" : "asked",
      question_id: questionId,
    });
    run = await commit({
      status: ask.kind === "handoff" ? "awaiting_handoff" : "awaiting_owner",
      current_step_key: step.key,
      current_question_id: questionId,
      current_artefact: artefact,
    });
    return {
      kind: "artefact",
      artefact,
      text: [...lines, artefact.text].join("\n\n"),
      ...(openRoute ? { open_route: openRoute } : {}),
      run,
    };
  }

  // ── 4. Every step settled: an evidence-backed summary ────────────────────
  const settledOffering = states.offering;
  if (settledOffering?.state === "done" && settledOffering.evidence) {
    const artefact: FlowArtefact = {
      schema_version: 1,
      artefact_id: `s:${run.id}`,
      run_id: run.id,
      step_key: "summary",
      question_id: null,
      kind: "summary",
      reuse_key: "summary",
      title: `Your ${def.noun} draft`,
      text: summaryText(def, { ...run, step_states: states }),
      options: [],
    };
    run = await commit({
      status: "completed",
      completion_evidence: settledOffering.evidence,
      current_step_key: "summary",
      current_question_id: null,
      current_artefact: artefact,
    });
    return {
      kind: "completed",
      artefact,
      text: [...lines, artefact.text].join("\n\n"),
      run,
    };
  }
  run = await commit({});
  return { kind: "unchanged", artefact: run.current_artefact, run };
}

/** Exported for tests: a conflict means another request moved the run. */
export function isFlowConflict(error: unknown): boolean {
  return error instanceof FlowConflict;
}

export { stepIndex };
