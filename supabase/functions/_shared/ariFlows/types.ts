/**
 * Issue #3355 P3 — Ari flow engine: the shapes every flow shares.
 *
 * A flow is data: an ordered list of steps, each with a canonical "done?"
 * probe, a policy (blocking / skippable / deferrable) and owner copy. A run of
 * that flow is a durable row in `public.ari_flow_runs` (migration
 * 20280226003355). Only the server runner (`runner.ts`) moves a run; the model
 * fills content and never decides progress.
 */

import type {
  BrandReadiness,
  BrandReadinessItem,
} from "../agentReadinessTools.ts";
import type { ReadinessAction } from "../readinessCatalog.ts";

export type FlowStepState =
  | "pending"
  | "asked"
  | "proposed"
  | "awaiting_approval"
  | "done"
  | "skipped"
  | "deferred"
  | "blocked"
  | "human_action"
  | "delegated";

export type FlowRunStatus =
  | "active"
  | "awaiting_owner"
  | "awaiting_approval"
  | "awaiting_handoff"
  | "blocked"
  | "completed"
  | "cancelled"
  | "expired";

export const LIVE_FLOW_STATUSES: ReadonlySet<FlowRunStatus> = new Set([
  "active",
  "awaiting_owner",
  "awaiting_approval",
  "awaiting_handoff",
  "blocked",
]);

/** What a probe saw. `done` is only ever written with one of these. */
export interface FlowEvidence {
  probe: string;
  observed: unknown;
  action?: string | null;
  context_revision?: string | null;
}

export interface FlowStepRecord {
  state: FlowStepState;
  evidence?: FlowEvidence;
  question_id?: string;
  /** The checklist item a handoff is waiting on. */
  item_key?: string;
  /** Items the owner set aside at this step (owner words come from labels). */
  set_aside?: string[];
  reason?: string;
  updated_at?: string;
}

export interface FlowAnswerValue {
  value: unknown;
  source: "owner" | "engine";
}

export interface FlowChoiceOption {
  id: string;
  label: string;
  /** Host route to open after the server records the choice. */
  route?: string;
}

export type FlowArtefactKind =
  | "question"
  | "handoff"
  | "summary"
  | "busy"
  | "notice";

/**
 * The one thing the owner is looking at. Persisted on the run
 * (`current_artefact`) and in the assistant row's `structured.flow`.
 */
export interface FlowArtefact {
  schema_version: 1;
  /** `q:<run>:<question>` / `h:<run>:<question>` / `s:<run>` / `b:<run>` */
  artefact_id: string;
  run_id: string;
  step_key: string;
  question_id: string | null;
  kind: FlowArtefactKind;
  /** Same reuse key = the same card; never shown to the owner. */
  reuse_key: string;
  title: string;
  text: string;
  options: FlowChoiceOption[];
  handoff?: {
    item_key: string;
    item_label: string;
    route: string | null;
    route_label: string;
    can_caller_fix: boolean;
    who_can_fix: string;
  };
  items?: { key: string; label: string; blocks: boolean }[];
}

export interface FlowRun {
  id: string;
  brand_id: string;
  flow_key: string;
  flow_version: number;
  concurrency: "one_per_brand" | "one_per_subject";
  subject_id: string | null;
  conversation_id: string | null;
  status: FlowRunStatus;
  current_step_key: string | null;
  current_question_id: string | null;
  current_pending_action_id: string | null;
  current_artefact: FlowArtefact | null;
  step_states: Record<string, FlowStepRecord>;
  answers: Record<string, FlowAnswerValue>;
  session_skips: string[];
  revision: number;
  started_by_me: boolean;
  started_by_name: string;
  lease_held: boolean;
  lease_held_by_me: boolean;
  lease_owner_name: string | null;
}

/** The structured answer a Host card submits (I-ARI-BOUND-ANSWERS). */
export interface FlowAnswer {
  run_id: string;
  step_key: string;
  question_id: string;
  choice_id: string;
  display_text: string;
}

/** Reads the runner may make. Every probe goes through these. */
export interface FlowProbeDeps {
  readiness(action: ReadinessAction | null): Promise<BrandReadiness>;
  /** Canonical existence read for a created record (event, experience…). */
  subjectExists(table: string, id: string): Promise<boolean>;
  /**
   * Brand-wide "not now" for one item (P2 brand_readiness_defer). Returns
   * "session_only" when the caller may not set it aside for the brand.
   */
  setAside(itemKey: string): Promise<"brand" | "session_only">;
}

export interface FlowContext {
  run: FlowRun;
  def: FlowDefinition;
  deps: FlowProbeDeps;
  brandName: string;
  state: FlowStepRecord | undefined;
}

export type AskSpec = {
  kind: "question" | "handoff";
  /** Same key on two reads = the same card; the runner never re-issues it. */
  reuse_key: string;
  title: string;
  text: string;
  options: FlowChoiceOption[];
  handoff?: FlowArtefact["handoff"];
  items?: FlowArtefact["items"];
  record: Omit<FlowStepRecord, "state" | "question_id">;
};

export type ProbeResult =
  | { done: true; evidence: FlowEvidence; note?: string }
  | { done: false; ask: AskSpec; note?: string }
  | { done: false; delegate: true };

export interface AnswerOutcome {
  record: FlowStepRecord;
  /** Plain words said before the next artefact ("Done — I've set those aside."). */
  ack?: string;
  /** Host route to open now; the current card stays current. */
  open_route?: string;
  session_skips?: string[];
  cancel_run?: boolean;
}

export interface StepDefinition {
  key: string;
  title: string;
  kind:
    | "readiness_gate"
    | "question"
    | "proposal"
    | "handoff"
    | "check"
    | "subflow"
    | "summary";
  depends_on: string[];
  policy: "blocking" | "skippable" | "deferrable";
  probe(ctx: FlowContext): Promise<ProbeResult>;
  onAnswer?(
    ctx: FlowContext,
    choiceId: string,
  ): Promise<AnswerOutcome | null>;
}

export interface FlowDefinition {
  key: string;
  version: number;
  title: string;
  subject: "brand" | "offering";
  concurrency: "one_per_brand" | "one_per_subject";
  /** Owner noun ("event", "trip"). */
  noun: string;
  readiness: {
    /** Gates the draft itself (role, an approved venue for a stay…). */
    draft: ReadinessAction;
    publish: ReadinessAction;
    publish_paid: ReadinessAction | null;
  };
  /** Tools whose confirmed result creates this flow's subject. */
  subject_tools: string[];
  /** Table read to verify the created subject; null = verified by the delegated lane later (P7–P9). */
  subject_table: string | null;
  steps: StepDefinition[];
}

export type { BrandReadiness, BrandReadinessItem };
