/** Issue #1008 — defensive app-side contract for growth-tools-events. */

export type TurnoutConfidence = "low" | "medium" | "high";
export type TurnoutFactorStatus = "help" | "watch" | "hurt";

export interface TurnoutForecast {
  total_low?: number;
  total_high?: number;
  baseline_low?: number;
  baseline_high?: number;
  capacity?: number;
  pct_capacity_low?: number;
  pct_capacity_high?: number;
  confidence?: TurnoutConfidence;
  headline_read?: string;
}

export interface TurnoutFactor {
  key?: string;
  label?: string;
  status?: TurnoutFactorStatus;
  detail?: string;
}

export interface TurnoutCompetitor {
  name?: string;
  platform?: string;
  date_note?: string;
  scale_note?: string;
}

export interface TurnoutComparable {
  name?: string;
  city?: string;
  turnout_note?: string;
  source_note?: string;
}

export interface TurnoutWeather {
  summary?: string;
  impact?: string;
  kind?: "forecast" | "climate_normal" | "seasonal";
}

export interface TurnoutFix {
  title?: string;
  why?: string;
  change?: string;
  lift_note?: string;
  effort?: string;
}

export interface TurnoutPlanScenario {
  label?: string;
  budget?: number;
  ad_tickets?: number;
  revenue?: number;
  profit?: number;
  roas?: number;
  cost_per_ticket?: number;
  total_attendees?: number;
  pct_capacity?: number;
  recommended?: boolean;
}

export interface TurnoutFreePlan {
  kind?: "free_budget";
  budget?: number;
  cpc?: number;
  cpc_source?: string;
  benchmarks?: unknown;
  clicks_low?: number;
  clicks_high?: number;
  attendees_low?: number;
  attendees_high?: number;
  cost_per_attendee_low?: number;
  cost_per_attendee_high?: number;
  read?: string;
}

export interface TurnoutPaidPlan {
  kind?: "paid_optimized";
  ticket_price?: number;
  cpc?: number;
  cpc_source?: string;
  benchmarks?: unknown;
  recommended_budget?: number;
  ad_tickets_low?: number;
  ad_tickets_high?: number;
  ad_attendees_low?: number;
  ad_attendees_high?: number;
  cost_per_ticket?: number;
  cost_pct_of_ticket?: number;
  ad_revenue?: number;
  ad_profit?: number;
  roas?: number;
  ads_worth_it?: boolean;
  scenarios?: TurnoutPlanScenario[];
  read?: string;
}

export interface TurnoutReport {
  event?: Record<string, unknown>;
  forecast?: TurnoutForecast;
  plan?: TurnoutFreePlan | TurnoutPaidPlan;
  factors?: TurnoutFactor[];
  competitors?: TurnoutCompetitor[];
  comparables?: TurnoutComparable[];
  weather?: TurnoutWeather | null;
  demand_read?: string;
  fixes?: TurnoutFix[];
  listing_preview?: {
    title?: string;
    tagline?: string;
    vibe_tags?: string[];
    why_go?: string;
    best_for?: string;
    cover_url?: string | null;
  };
  /** Marketing-funnel CTA. Deliberately never rendered in-app. */
  offer?: { per_person_from?: number };
  narrative?: string;
  meta?: {
    generated_at?: string;
    model?: string;
    research_source?: "grounded" | "fallback";
    schema_version?: number;
  };
}

// Issue #2725 — server-owned competitor intelligence v2. Unknown enum/schema
// values are rejected by the service mapper; clients never invent freshness.
export type CompetitorSourceKind = "website" | "instagram" | "tiktok";
export type CompetitorCapability = "analyzed_weekly" | "link_only" | "disabled";
export type CompetitorSourceHealth =
  | "pending"
  | "current"
  | "private"
  | "removed"
  | "invalid"
  | "rate_limited"
  | "unreachable"
  | "unsupported"
  | "disabled";
export type CompetitorFreshness =
  | "current"
  | "refreshing"
  | "partial"
  | "stale"
  | "needs_attention"
  | "link_only"
  | "budget_delayed";
export type CompetitorManualRefreshState =
  | "available"
  | "joined"
  | "cached"
  | "quota_limited"
  | "edit_required"
  | "exhausted"
  | "not_applicable";

export interface CompetitorSourceInput {
  kind: CompetitorSourceKind;
  url: string;
}

export interface CompetitorSourceState {
  id?: string;
  kind: CompetitorSourceKind;
  url: string;
  capability: CompetitorCapability;
  availability: "enabled" | "paused";
  availabilityGeneration: number;
  health: CompetitorSourceHealth;
  lastCheckedAt: string | null;
  safeReason: string | null;
}

export interface CompetitorActiveJob {
  id: string;
  state: "due" | "leased" | "retry_wait" | "budget_deferred";
  fundingLane: "scheduled" | "manual";
  memberRetryCount: number;
}

export interface CompetitorWatchRow {
  /** Legacy one-release structural adapter; service reads always return v2. */
  schemaVersion?: 2;
  id: string;
  name: string;
  city: string | null;
  website: string | null;
  placePoolId: string | null;
  createdAt: string;
  updatedAt?: string;
  freshness?: CompetitorFreshness;
  lastBriefUpdatedAt?: string | null;
  checkedAt?: string | null;
  nextRefreshAt?: string | null;
  noMeaningfulChange?: boolean;
  manualRefreshState?: CompetitorManualRefreshState;
  sources?: CompetitorSourceState[];
  summary?: { whatChanged: string | null; primaryAction: string | null };
  activeJob?: CompetitorActiveJob | null;
  /** One-release compatibility evidence only; never the row hierarchy. */
  latest: { runId: string; grade: string | null; overall: number | null; checkedAt: string; schemaVersion: number | null } | null;
}

export interface CompetitorWatchV2Row extends CompetitorWatchRow {
  schemaVersion: 2;
  updatedAt: string;
  freshness: CompetitorFreshness;
  lastBriefUpdatedAt: string | null;
  checkedAt: string | null;
  nextRefreshAt: string | null;
  noMeaningfulChange: boolean;
  manualRefreshState: CompetitorManualRefreshState;
  sources: CompetitorSourceState[];
  summary: { whatChanged: string | null; primaryAction: string | null };
  activeJob: CompetitorActiveJob | null;
}

export interface CompetitorBriefFact {
  id: string;
  text: string;
  sourceId: string;
  evidenceId: string;
  confidence: "observed";
}
export interface CompetitorBriefInterpretation {
  text: string;
  evidenceIds: string[];
  confidence: "interpretation";
}
export interface CompetitorBriefAction {
  id: string;
  text: string;
  kind: string;
  targetId?: string;
  confidence: "suggested_action";
  isPrimary: boolean;
}
export interface CompetitorBriefEvidence {
  id: string;
  sourceId: string;
  publicUrl: string;
  observedAt?: string;
  checkedAt: string;
  observation: string;
}
export type CompetitorDecisionClass = "watch" | "opportunity" | "act";
export type CompetitorDecisionConfidence = "high" | "medium" | "low";
export type CompetitorSignalType = "threat" | "opportunity" | "neutral";
export type CompetitorDecisionDimension =
  | "category"
  | "positioning"
  | "event_theme"
  | "offer"
  | "content_cadence"
  | "source_presence";

export interface CompetitorDecisionSignalEvidence {
  id: string;
  sourceId: string;
  sourceUrl: string;
  observation: string;
  checkedAt: string;
  observedAt: string | null;
}

export interface CompetitorDecisionSignal {
  id: string;
  kind: "profile" | "website" | "content" | "theme" | "cadence" | "format" | "delta";
  derivation: "deterministic" | "synthesis";
  dimension: CompetitorDecisionDimension;
  label: string;
  summary: string;
  sourceId: string;
  evidenceIds: string[];
  metrics: {
    posts7d: number | null;
    posts28d: number | null;
    images28d: number | null;
    videos28d: number | null;
  };
  changedPaths: string[];
}

export interface CompetitorOwnerFact {
  id: string;
  kind: "listing_category" | "event_title" | "event_description";
  entityId: string;
  dimension: CompetitorDecisionDimension;
  text: string;
}

export interface CompetitorInterpretationMeta {
  index: number;
  signalType: CompetitorSignalType;
  confidence: CompetitorDecisionConfidence;
  priority: "high" | "medium";
  signalIds: string[];
  ownerFactIds: string[];
}

export interface CompetitorComparison {
  id: string;
  dimension: CompetitorDecisionDimension;
  ownerText: string;
  competitorText: string;
  outcome: "owner_advantage" | "competitor_pressure" | "different" | "not_comparable";
  confidence: CompetitorDecisionConfidence;
  signalIds: string[];
  ownerFactIds: string[];
}

export interface CompetitorActionMeta {
  index: number;
  actionId: string;
  timeframe: "this_week" | "this_month" | "bigger_project";
  impact: "high" | "medium";
  confidence: CompetitorDecisionConfidence;
  order: number;
  isPrimary: boolean;
  signalIds: string[];
  ownerFactIds: string[];
}

export interface CompetitorDecisionReport {
  decision: {
    class: CompetitorDecisionClass;
    confidence: CompetitorDecisionConfidence;
    headline: string;
    rationale: string;
    signalIds: string[];
    ownerFactIds: string[];
  };
  signals: CompetitorDecisionSignal[];
  signalEvidence: CompetitorDecisionSignalEvidence[];
  interpretationMeta: CompetitorInterpretationMeta[];
  comparisons: CompetitorComparison[];
  actionPlan: CompetitorActionMeta[];
  ownerFacts: CompetitorOwnerFact[];
}

interface CompetitorBriefResultBase {
  schemaVersion: 2;
  watchId: string;
  freshness: CompetitorFreshness;
  updatedAt: string | null;
  checkedAt: string | null;
  nextRefreshAt: string | null;
  noMeaningfulChange: boolean;
  manualRefreshState: CompetitorManualRefreshState;
  sources: CompetitorSourceState[];
  brief: {
    status: "current" | "partial";
    whatChanged: CompetitorBriefFact[];
    whyItMatters: CompetitorBriefInterpretation[];
    worthDoing: CompetitorBriefAction[];
    evidence: CompetitorBriefEvidence[];
    websiteHealth?: { grade: string | null; changes: unknown[] };
  } | null;
}

export interface CompetitorBriefV2 extends CompetitorBriefResultBase {
  schemaVersion: 2;
}

export interface CompetitorBriefV3 extends Omit<CompetitorBriefResultBase, "schemaVersion"> {
  schemaVersion: 3;
  decisionReport: CompetitorDecisionReport;
}

export type CompetitorBriefResult = CompetitorBriefV2 | CompetitorBriefV3;
