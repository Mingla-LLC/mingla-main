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
  /**
   * #2830 P4 — step-owned working data the runner carries but never reads
   * (the Website field being asked, the exact draft digests a publish
   * question was prepared against, a created offering's id).
   */
  data?: Record<string, unknown>;
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
  /**
   * #2830 P4 — "form": the card is answered with the real form control on
   * its rendition (phone chip + number, choices, text), submitted as a bound
   * flow answer with `values`. Absent = answered with the option chips.
   */
  answer_mode?: "form";
  /** #2830 P4 — the form-shaped card (an Ari rendition) for a form answer. */
  rendition?: Record<string, unknown>;
  /**
   * #3355 P7 — the record this card is about (the event a cover upload
   * goes to). Never shown; the Host reads it to open the right picker.
   */
  subject_id?: string;
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
  /**
   * #2830 P4 — a form answer (choice_id "answer"): the values the card's
   * control produced, never free text dressed as a choice.
   */
  values?: FlowAnswerValues;
}

/** #2830 P4 — what a form-shaped card submits. */
export interface FlowAnswerValues {
  /** Labels of the chosen options, as shown on the card. */
  choices: string[];
  /** The phone chip's country (ISO 3166-1 alpha-2), when the card has one. */
  country: string | null;
  /** What the owner typed or pasted. */
  response: string;
  /** #3355 P7 — a place picked from the address search on the card. */
  place?: FlowPlaceValue;
}

/** #3355 P7 — what the address picker on an Ari card submits. */
export interface FlowPlaceValue {
  venue_name: string;
  address: string;
  city: string;
  country_code: string | null;
  lat: number;
  lng: number;
  feature_type: string | null;
  /**
   * #3355 P9 — the address search's own id for the pick (Mapbox), the same
   * id the experience wizard stores as a stop's place_id. Absent on older
   * Host builds.
   */
  place_id?: string | null;
}

/** #3355 P7 — the event row an event flow reads back (canonical state). */
export interface FlowEventRow {
  id: string;
  title: string;
  status: string;
  timezone: string | null;
  description: string | null;
  party_types: string[];
  city: string | null;
  cover_media_url: string | null;
  online_url: string | null;
  created_at: string | null;
  /** theme.business_draft (draft facts, tickets, when). */
  draft: Record<string, unknown>;
}

/** #3355 P8 — a trip place as stored (the wizard's theme keys). */
export interface FlowTripPlace {
  label: string;
  lat: number | null;
  lng: number | null;
}

/** #3355 P8 — the trip row a trip flow reads back (canonical state). */
export interface FlowTripRow {
  id: string;
  title: string;
  status: string;
  timezone: string | null;
  /** The compare-and-swap revision every trip write needs. */
  updated_at: string;
  /** The master event_dates row (Host calendar-day encoding). */
  start_at: string | null;
  end_at: string | null;
  departure: FlowTripPlace | null;
  destination: FlowTripPlace | null;
  refund_policy: Record<string, unknown> | null;
  day_count: number;
  packages: {
    ticket_type_id: string;
    name: string;
    price_cents: number;
    capacity: number | null;
    installments: boolean;
  }[];
}

/** #3355 P9 — the experience row an experience flow reads back. */
export interface FlowExperienceRow {
  id: string;
  title: string;
  status: string;
  /** The compare-and-swap revision every experience write needs. */
  updated_at: string;
  timezone: string | null;
  description: string | null;
  intents: string[];
  stops: {
    name: string;
    description: string;
    address: string;
    has_point: boolean;
    has_place_id: boolean;
  }[];
  is_free: boolean;
  whole_price_cents: number | null;
  /** theme.experience_meta.when_draft.when ({ date, doorsOpen, endsAt }). */
  when: Record<string, unknown> | null;
}

/** #3355 P9 — one of the brand's venue listings (never contact details). */
export interface FlowVenueRow {
  id: string;
  name: string;
  slug: string;
  venue_category: string;
  claim_status: string;
  city: string | null;
  /** #3355 — the venue's own country; a stay's clock follows the venue. */
  country_code?: string | null;
  cover_media_url: string | null;
  created_at: string | null;
}

/** #3355 P9 — the Stay a stay flow reads back (manage-stay-inventory get). */
export interface FlowStayInventory {
  venue_id: string;
  /** The settings version every Stay write needs (null = no settings yet). */
  settings_version: number | null;
  settings: {
    summary: string;
    timezone: string | null;
    check_in_time: string | null;
    check_out_time: string | null;
  } | null;
  /** The stored settings row, so a settings save keeps what is there. */
  settings_raw: Record<string, unknown> | null;
  offerings: {
    id: string;
    name: string;
    kind: string;
    status: string;
    version: number;
    has_price: boolean;
    has_policy: boolean;
  }[];
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
  /**
   * #2830 P4 — one read-only Ari tool as the caller (Website plan, site,
   * draft validation, design checks). Memoised per request; never a write.
   */
  readTool?(name: string, args: Record<string, unknown>): Promise<unknown>;
  /**
   * #2830 P4 — does this chat still have a protected proposal the owner has
   * not confirmed or cancelled? (A step waiting on it issues no new card.)
   */
  hasOpenProposal?(): Promise<boolean>;
  /** #3355 P7 — the brand's own time zone, country and currency. */
  brandFacts?(): Promise<{
    default_timezone: string | null;
    country_code: string | null;
    default_currency: string | null;
    /** #3355 P9 — the brand's own contact, offered for a venue. */
    contact_email?: string | null;
    contact_phone?: string | null;
  } | null>;
  /** #3355 P7 — one event of this brand, read back (null when gone). */
  eventRow?(id: string): Promise<FlowEventRow | null>;
  /** #3355 P7 — this brand's live drafts / scheduled events with this title. */
  eventsTitled?(title: string): Promise<FlowEventRow[]>;
  /** #3355 P8 — one trip of this brand, read back (null when gone). */
  tripRow?(id: string): Promise<FlowTripRow | null>;
  /** #3355 P9 — one experience of this brand, read back (null when gone). */
  experienceRow?(id: string): Promise<FlowExperienceRow | null>;
  /** #3355 P9 — this brand's venue listings, oldest first. */
  venues?(): Promise<FlowVenueRow[]>;
  /** #3355 P9 — one venue's Stay, read as the caller (null when unreadable). */
  stayInventory?(venueId: string): Promise<FlowStayInventory | null>;
  /** #3355 P9 — one server feature flag (false when unreadable). */
  featureFlag?(key: string): Promise<boolean>;
}

export interface FlowContext {
  run: FlowRun;
  def: FlowDefinition;
  deps: FlowProbeDeps;
  brandName: string;
  state: FlowStepRecord | undefined;
  /** #2830 P4 — why the runner is running (a confirm, an answer, a turn…). */
  trigger?: "turn" | "answer" | "confirm" | "resume" | "handoff_return";
  /**
   * #3355 P7 — the owner answered a card in this same request, so a step
   * may put its protected proposal straight in front of them.
   */
  answered?: boolean;
  /**
   * #3355 P7 — the owner confirmed this run's protected proposal and the
   * write was refused (nothing saved). `message` is the plain reason.
   */
  failed?: { tool_name: string; message: string };
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
  /** #2830 P4 — a form-shaped card (see FlowArtefact.answer_mode). */
  answer_mode?: "form";
  rendition?: Record<string, unknown>;
  /** #3355 P7 — see FlowArtefact.subject_id. */
  subject_id?: string;
  /**
   * #2830 P4 — what to say when the owner says a handoff is done but the
   * re-read disagrees, when the probe knows more than "not there yet" (a
   * logo that is there but can't be used).
   */
  not_ready_text?: string;
  record: Omit<FlowStepRecord, "state" | "question_id">;
};

export type ProbeResult =
  | { done: true; evidence: FlowEvidence; note?: string }
  | { done: false; ask: AskSpec; note?: string }
  | {
    done: false;
    delegate: true;
    /**
     * #2830 P4 — a step that hands ONE request to another lane while the
     * run stays open (Website setup's first offering → the event planner).
     * Absent = the offering flow's own request (P3 behaviour).
     */
    semantic?: string;
  }
  /**
   * #2830 P4 — waiting on something already in front of the owner (a
   * protected proposal they have not confirmed or cancelled yet): no new
   * card; the turn goes on to the normal lanes.
   */
  | { done: false; wait: true }
  /**
   * #3355 P7 — the step's protected proposal. Put in front of the owner
   * only right after they answered a card (`ctx.answered`); on any other
   * trigger the runner shows `ask` instead (a "Create it" card), so a
   * reload or a side question never springs a confirmation on anyone.
   */
  | {
    done: false;
    propose: NonNullable<AnswerOutcome["propose"]>;
    ask: AskSpec;
    record: Omit<FlowStepRecord, "state">;
    note?: string;
  };

export interface AnswerOutcome {
  record: FlowStepRecord;
  /** Plain words said before the next artefact ("Done — I've set those aside."). */
  ack?: string;
  /** Host route to open now; the current card stays current. */
  open_route?: string;
  session_skips?: string[];
  cancel_run?: boolean;
  /** #3355 P7 — owner-provided facts, merged into the run's answers. */
  answers?: Record<string, FlowAnswerValue>;
  /** #3355 P7 — the owner chose an existing record to continue. */
  subject_id?: string;
  /**
   * #2830 P4 — the answer becomes ONE protected proposal (the owner confirms
   * it on the card; nothing is written before that). The run waits for the
   * confirm, then re-reads canonical state.
   */
  propose?: {
    tool_name: string;
    tool_args: Record<string, unknown>;
    /** Extra plain-words rows for the confirmation card. */
    rows?: { label: string; value: string }[];
    /**
     * #3355 P7 — the card shows ONLY these rows (the engine wrote every row
     * in plain words; raw arguments such as coordinates never show).
     */
    rows_only?: boolean;
  };
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
    answer?: FlowAnswer,
  ): Promise<AnswerOutcome | null>;
  /**
   * #2830 P4 — read a typed reply as this step's form answer (an older
   * Host's card submission, or a plain value typed into the composer).
   */
  textAnswer?(ctx: FlowContext, text: string): FlowAnswerValues | null;
  /** #2830 P4 — confirmed tools whose result is this step's created record. */
  subject_tools?: string[];
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
  /**
   * #2830 P4 — a brand flow's closing card, built only from step evidence.
   * Offering flows use the runner's offering summary instead.
   */
  summarize?(run: FlowRun): {
    title: string;
    text: string;
    evidence: FlowEvidence;
  } | null;
}

export type { BrandReadiness, BrandReadinessItem };
