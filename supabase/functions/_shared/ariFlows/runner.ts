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
  /** #3355 P7 — a confirmed write that was refused; nothing was saved. */
  failed?: { tool_name: string; message: string };
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
    /**
     * #2830 P4 — show the current card again under these words (the same
     * artefact id, so it stays the one answerable card).
     */
    represent?: boolean;
    /**
     * #3355 — the owner's typed words were not an answer to the open card;
     * the words restate what Ari is waiting for.
     */
    unmatched?: boolean;
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
  /**
   * #2830 P4 — the owner's answer becomes one protected proposal. The caller
   * stores it as a pending action the owner confirms; nothing is written yet.
   */
  | {
    kind: "propose";
    tool_name: string;
    tool_args: Record<string, unknown>;
    rows: { label: string; value: string }[];
    rows_only?: boolean;
    /** #3355 — the card's heading, in plain words. */
    card_title?: string;
    ack?: string;
    run: FlowRun;
  }
  | {
    kind: "completed";
    artefact: FlowArtefact;
    text: string;
    run: FlowRun;
  }
  | { kind: "cancelled"; text: string; run: FlowRun };

const SETTLED = new Set(["done", "skipped", "deferred"]);

/** #2830 P4 — the choice id of a form-shaped card's answer. */
export const FORM_ANSWER = "answer";

const DONE_CLAIM =
  /^(?:(?:ok(?:ay)?|great|thanks|right|so)[,.!]?\s+)?(?:(?:i[’']?ve|i have|i)\s+)?(?:just\s+)?(?:uploaded|added|approved|saved|finished|done|fixed|connected|accepted|sorted|set\s+(?:it|that|them)\s+up)\b|^(?:all\s+)?(?:done|finished|ready|sorted)\b|^it[’']?s\s+(?:there|done|up|in)\b/i;
const NOT_NOW_TEXT =
  /^(?:not\s+now|skip(?:\s+(?:it|them|this|that|those))?|later|maybe later|keep going|carry on|go ahead|no thanks)\b/i;
const STOP_TEXT = /^(?:stop|cancel|never\s?mind|forget\s+it)\b/i;

/**
 * A real question asked aside ("what's a good description?"). Only these
 * may leave the flow for the model while a card is open.
 */
const SIDE_QUESTION =
  /\?\s*$|^(?:how|what|what[’']?s|why|where|when|which|who|can|could|should|do|does|is|are|will|would)\b/i;
// Obvious intents said in passing, in a short reply ("ok I've approved it
// now", "please skip this one", "can we stop here").
const SHORT_REPLY = 80;
const DONE_IN_PASSING =
  /\b(?:i[’']?ve|i have|i)\s+(?:just\s+|now\s+|already\s+)?(?:uploaded|added|approved|saved|finished|done|fixed|connected|accepted)\b/i;
const SKIP_IN_PASSING = /\b(?:skip|not now|later)\b/i;
const STOP_IN_PASSING =
  /\b(?:stop|cancel)(?:\s+(?:this|that|it|here|now|setup|website setup|for now|please))*\s*[.!]*$/i;
const NEGATED = /\b(?:don[’']?t|do not|never|no need to)\b/i;

export type FlowTextIntent = "done" | "not_now" | "stop" | "question" | "other";

/**
 * #3355 — what a typed reply means while a card is open. Intents come before
 * the question test: "can we skip this?" is a skip, not a side question.
 */
export function classifyFlowText(text: string | undefined): FlowTextIntent {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "other";
  const short = normalized.length <= SHORT_REPLY &&
    !NEGATED.test(normalized);
  if (
    STOP_TEXT.test(normalized) || (short && STOP_IN_PASSING.test(normalized))
  ) return "stop";
  if (
    NOT_NOW_TEXT.test(normalized) ||
    (short && SKIP_IN_PASSING.test(normalized))
  ) return "not_now";
  if (
    DONE_CLAIM.test(normalized) || (short && DONE_IN_PASSING.test(normalized))
  ) return "done";
  if (SIDE_QUESTION.test(normalized)) return "question";
  return "other";
}

/** Map a typed reply onto the open card's choices, when it is plainly one. */
export function textChoiceFor(
  artefact: FlowArtefact | null,
  text: string | undefined,
): string | null {
  if (!artefact || !text) return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  const has = (id: string) => artefact.options.some((o) => o.id === id);
  const exact = artefact.options.find((option) =>
    option.label.toLowerCase() === normalized.toLowerCase()
  );
  if (exact) return exact.id;
  switch (classifyFlowText(normalized)) {
    case "done":
      return has("check") ? "check" : null;
    case "not_now":
      if (has("not_now")) return "not_now";
      if (has("continue")) return "continue";
      return null;
    case "stop":
      return has("cancel") ? "cancel" : null;
    default:
      return null;
  }
}

/**
 * #3355 — typed words that are not an answer to the open card: say plainly
 * what Ari is waiting for; the same card comes back under the words.
 */
export function waitingText(
  artefact: FlowArtefact,
  intent: FlowTextIntent,
): string {
  const lead = intent === "not_now"
    ? "This step can't be skipped, so I've kept it here."
    : intent === "done"
    ? "There's nothing for me to check on this step — it's answered right here in the chat."
    : "I didn't catch that as an answer to this step, so nothing was changed.";
  return `${lead} We're on ${artefact.title}:\n\n${artefact.text}`;
}

/** #3355 — a protected change is waiting on its confirmation card. */
export const WAITING_ON_PROPOSAL_TEXT =
  "Your change is waiting on the confirmation card above. Approve it there to save it, or cancel it — nothing is saved until you do.";

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
    ...(ask.answer_mode ? { answer_mode: ask.answer_mode } : {}),
    ...(ask.subject_id ? { subject_id: ask.subject_id } : {}),
    // The form card is bound to this exact question: its id is unique per
    // question (never per tool), so an older card can never pass for it.
    ...(ask.rendition
      ? {
        rendition: {
          ...ask.rendition,
          rendition_id: `q:${run.id}:${questionId}`,
        },
      }
      : {}),
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

const UUID_RESULT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function subjectIdFromResult(result: unknown): string | null {
  // #3355 P9: biz_create_venue_listing returns the new venue's id itself.
  if (typeof result === "string") {
    return UUID_RESULT.test(result) ? result : null;
  }
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

  // Fast path: the delegated lane owns ordinary turns once gates have
  // passed (the offering lane for an offering flow; the event planner for
  // Website setup's first offering).
  const currentRecord = run.current_step_key
    ? run.step_states[run.current_step_key]
    : undefined;
  if (
    input.trigger === "turn" && !run.current_artefact &&
    currentRecord?.state === "delegated" &&
    (def.subject !== "offering" ||
      (run.current_step_key === "offering" && !run.subject_id))
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
    trigger: input.trigger,
    answered,
    ...(input.failed ? { failed: input.failed } : {}),
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
  let formAnswer: FlowAnswer | undefined;
  const openStep = def.steps.find((candidate) =>
    candidate.key === run.current_step_key
  );
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
    if (choiceId === FORM_ANSWER) {
      // A form answer carries the card control's values, and only a form
      // card accepts one.
      if (open.answer_mode !== "form" || !answer.values) {
        return { kind: "stale", artefact: open, run };
      }
      formAnswer = answer;
    }
  } else if (input.trigger === "turn") {
    choiceId = textChoiceFor(open, input.ownerText);
    if (
      !choiceId && open?.answer_mode === "form" && open.question_id &&
      openStep?.textAnswer && input.ownerText
    ) {
      const values = openStep.textAnswer(ctxFor(openStep.key), input.ownerText);
      if (values) {
        choiceId = FORM_ANSWER;
        formAnswer = {
          run_id: run.id,
          step_key: openStep.key,
          question_id: open.question_id,
          choice_id: FORM_ANSWER,
          display_text: input.ownerText.slice(0, 200),
          values,
        };
      }
    }
  }
  if (choiceId && open) {
    const option = choiceId === FORM_ANSWER
      ? { id: FORM_ANSWER, label: "", route: undefined }
      : open.options.find((candidate) => candidate.id === choiceId);
    const step = openStep;
    if (!option || !step) return { kind: "stale", artefact: open, run };
    // `open:<kind>` — one of several route buttons on the same card (#3355).
    if (choiceId === "open" || choiceId.startsWith("open:")) {
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
      const outcome = await step.onAnswer?.(
        ctxFor(step.key),
        choiceId,
        formAnswer,
      );
      if (!outcome) return { kind: "stale", artefact: open, run };
      answered = true;
      setState(step.key, outcome.record);
      if (outcome.answers) {
        // #3355 P7 — the owner's own facts (provenance "owner"), merged.
        patch.answers = {
          ...(patch.answers as Record<string, unknown> | undefined ?? {}),
          ...outcome.answers,
        };
        run = { ...run, answers: { ...run.answers, ...outcome.answers } };
      }
      if (outcome.subject_id && !run.subject_id) {
        patch.subject_id = outcome.subject_id;
        run = { ...run, subject_id: outcome.subject_id };
      }
      if (outcome.session_skips) {
        patch.session_skips = outcome.session_skips;
        // The probes below must see what the owner just set aside.
        run = { ...run, session_skips: outcome.session_skips };
      }
      if (outcome.ack) lines.push(outcome.ack);
      if (option.route) openRoute = option.route;
      if (outcome.propose) {
        // One protected proposal; the open card is answered. The confirm
        // (agent-confirm-action) re-runs the probes and says what's next.
        run = await commit({
          status: "awaiting_approval",
          current_step_key: step.key,
          current_question_id: null,
          current_artefact: null,
        });
        return {
          kind: "propose",
          tool_name: outcome.propose.tool_name,
          tool_args: outcome.propose.tool_args,
          rows: outcome.propose.rows ?? [],
          ...(outcome.propose.rows_only ? { rows_only: true } : {}),
          ...(outcome.propose.card_title
            ? { card_title: outcome.propose.card_title }
            : {}),
          ...(lines.length > 0 ? { ack: lines.join(" ") } : {}),
          run,
        };
      }
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
  // #2830 P4: a step that handed one request to another lane (Website setup's
  // first offering) records the record that lane created, on the step.
  if (input.confirmed && run.current_step_key) {
    const waiting = def.steps.find((candidate) =>
      candidate.key === run.current_step_key
    );
    const rec = states[run.current_step_key];
    if (
      waiting?.subject_tools?.includes(input.confirmed.tool_name) &&
      rec?.state === "delegated" && !rec.data?.subject_id
    ) {
      const created = subjectIdFromResult(input.confirmed.result);
      if (created) {
        setState(waiting.key, {
          ...rec,
          data: {
            ...(rec.data ?? {}),
            subject_id: created,
            subject_tool: input.confirmed.tool_name,
          },
        });
      }
    }
  }
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
    // A step's note is said when it settles, not again on every later turn
    // ("I'll add it to … venue" was repeated above each question).
    if (
      "note" in probe && probe.note &&
      !(probe.done && rec?.state === "done")
    ) {
      lines.push(probe.note);
    }
    if (probe.done) {
      if (rec?.state !== "done") {
        setState(step.key, { state: "done", evidence: probe.evidence });
      }
      continue;
    }
    if ("wait" in probe) {
      run = await commit({});
      // #3355 — typed words while a protected change waits on its card:
      // a side question may go to the model; anything else is told where
      // the change is waiting (no model round-trip, nothing saved).
      if (
        input.trigger === "turn" && input.ownerText?.trim() &&
        classifyFlowText(input.ownerText) !== "question"
      ) {
        return {
          kind: "notice",
          text: WAITING_ON_PROPOSAL_TEXT,
          artefact: null,
          unmatched: true,
          run,
        };
      }
      return input.trigger === "turn"
        ? { kind: "pass", run }
        : lines.length > 0
        ? { kind: "notice", text: lines.join(" "), artefact: null, run }
        : { kind: "unchanged", artefact: null, run };
    }
    if ("propose" in probe) {
      if (answered) {
        // #3355 P7 — straight after the owner's answer: ONE protected
        // proposal. Nothing is written before they confirm it.
        setState(step.key, { ...probe.record, state: "awaiting_approval" });
        run = await commit({
          status: "awaiting_approval",
          current_step_key: step.key,
          current_question_id: null,
          current_artefact: null,
        });
        return {
          kind: "propose",
          tool_name: probe.propose.tool_name,
          tool_args: probe.propose.tool_args,
          rows: probe.propose.rows ?? [],
          ...(probe.propose.rows_only ? { rows_only: true } : {}),
          ...(probe.propose.card_title
            ? { card_title: probe.propose.card_title }
            : {}),
          ...(lines.length > 0 ? { ack: lines.join(" ") } : {}),
          run,
        };
      }
    }
    const askOf = "propose" in probe ? probe.ask : null;
    if ("delegate" in probe) {
      if (states[step.key]?.state === "delegated") {
        run = await commit({});
        return input.trigger === "turn"
          ? { kind: "pass", run }
          : { kind: "unchanged", artefact: null, run };
      }
      const intent = run.answers.intent_text?.value;
      const semantic = probe.semantic ??
        (typeof intent === "string" && intent.trim()
          ? intent
          : (input.ownerText ?? ""));
      if (probe.semantic) {
        // #2830 P4: one request handed to another lane; the run stays open
        // and re-reads canonical state when that lane's write is confirmed.
        setState(step.key, {
          ...(states[step.key] ?? { state: "pending" }),
          state: "delegated",
        });
        run = await commit({
          status: "active",
          current_step_key: step.key,
          current_question_id: null,
          current_artefact: null,
        });
      } else if (!def.subject_table) {
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

    const ask = askOf ?? (probe as { ask: AskSpec }).ask;
    const sameCard = !!open && run.current_step_key === step.key &&
      open.reuse_key === ask.reuse_key && !answered;
    if (sameCard) {
      // Never re-issue the card the owner is already looking at.
      run = await commit({});
      const claimedDone = checking ||
        (input.trigger === "turn" && DONE_CLAIM.test(input.ownerText ?? ""));
      // The same card comes back at the bottom (same id: still the one
      // current card, never a second answerable copy).
      if (checking && !open?.handoff) {
        return {
          kind: "notice",
          text:
            "I checked again and nothing has changed yet. Here's the same step whenever you're ready.",
          artefact: open,
          represent: true,
          run,
        };
      }
      if (claimedDone && open?.handoff) {
        return {
          kind: "notice",
          text: ask.not_ready_text ??
            `I checked; ${
              ownerItemNoun(open.handoff.item_label)
            } isn't there yet. Here's the same step whenever you're ready.`,
          artefact: open,
          represent: true,
          run,
        };
      }
      if (input.trigger === "turn" && open && input.ownerText?.trim()) {
        // #3355 — the flow owns this chat. Only a genuine side question
        // goes to the model; anything else gets plain words and the same
        // card back at the bottom, never a model round-trip.
        const intent = classifyFlowText(input.ownerText);
        if (intent === "question") return { kind: "pass", run };
        if (intent === "stop") {
          patch.status = "cancelled";
          patch.current_artefact = null;
          patch.current_question_id = null;
          run = await commit({});
          return {
            kind: "cancelled",
            text:
              "Okay, I've stopped here. Nothing was changed, and everything you already saved stays saved. You can pick this up again anytime.",
            run,
          };
        }
        return {
          kind: "notice",
          text: ownerSafe(
            waitingText(open, intent),
            open.text,
            "flow_waiting",
          ),
          artefact: open,
          represent: true,
          unmatched: true,
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
  if (def.summarize) {
    const summary = def.summarize({ ...run, step_states: states });
    if (summary) {
      const artefact: FlowArtefact = {
        schema_version: 1,
        artefact_id: `s:${run.id}`,
        run_id: run.id,
        step_key: "summary",
        question_id: null,
        kind: "summary",
        reuse_key: "summary",
        title: assertOwnerCopy(summary.title, {
          fallback: def.title,
          surface: "flow_title",
          mode: "label",
        }),
        text: ownerSafe(summary.text, def.title, "flow_text"),
        options: [],
      };
      run = await commit({
        status: "completed",
        completion_evidence: summary.evidence,
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
  }
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
