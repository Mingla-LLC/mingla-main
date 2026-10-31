/**
 * #2829 W9a — the website plan as Core answers it (brand_site_plan_get),
 * normalized once, and the Home to-do row it implies.
 *
 * Server truth: every tick, the next part, the lock and the role come from
 * Core. Nothing here marks anything done.
 *
 * Used by the plan screens only (never the boot path). Home's to-do row has
 * its own self-contained reader (websiteTodo.ts) so nothing here is shared
 * with — and hoisted into — the boot payload (#3493).
 */
import { PLAN_PARTS, type PlanPartKey } from "../../../packages/site-contracts/src/sitePlan.ts";

export type SitePlanPart = { key: PlanPartKey; done: boolean; skipped: boolean; optional: boolean };

export type SitePlanStory = { who?: string; why?: string; main_action?: string };

export type BrandContextFieldState =
  | "missing"
  | "invalid"
  | "stale"
  | "conflict"
  | "verified"
  | "not_applicable";

export type BrandContextField = {
  key: string;
  label: string;
  group: string;
  requirement: "required" | "recommended" | "optional";
  state: BrandContextFieldState;
  value: unknown;
  sourceType: "mingla" | "owner" | "public_research" | "imported" | null;
  sourceRef: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
  ownerConfirmedAt: string | null;
  exceptionReason: string | null;
  humanActionRequired: boolean;
};

export type BrandContextCompleteness = {
  revision: number;
  designKey: string | null;
  fields: BrandContextField[];
  requiredGapCount: number;
  recommendedGapCount: number;
  gapCount: number;
  verifiedCount: number;
  exceptionCount: number;
  minimumComplete: boolean;
  contextComplete: boolean;
  checkedAt: string | null;
};

export type SitePlanState = {
  brandId: string;
  entitled: boolean;
  rank: number;
  canManage: boolean;
  site: { id: string; status: string; designKey: string | null; published: boolean; paused: boolean } | null;
  plan: {
    revision: number;
    designKey: string | null;
    offeringsSelected: string[] | null;
    venueDescriptor: string | null;
    story: SitePlanStory | null;
    approvedPlan: Record<string, string> | null;
    approvedAt: string | null;
    skippedParts: string[];
    activePart: PlanPartKey | null;
    builtPages: string[] | null;
    startedAt: string | null;
    startedByMe: boolean;
    startedByName: string | null;
  } | null;
  parts: SitePlanPart[];
  doneCount: number;
  nextPart: PlanPartKey | null;
  prefillOfferings: string[] | null;
  liveCounts: { trips: number; events: number; experiences: number };
  lock: { active: boolean; heldByMe: boolean; holderName: string | null; expiresAt: string | null };
  completeness: BrandContextCompleteness | null;
};

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw => (value && typeof value === "object" && !Array.isArray(value) ? value as Raw : {});
const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const strings = (value: unknown): string[] | null =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const isPart = (value: unknown): value is PlanPartKey => PLAN_PARTS.some((part) => part.key === value);

export function normalizeSitePlan(brandId: string, value: unknown): SitePlanState {
  const raw = obj(value);
  const site = raw.site ? obj(raw.site) : null;
  const plan = raw.plan ? obj(raw.plan) : null;
  const status = obj(raw.status);
  const lock = obj(raw.lock);
  const counts = obj(raw.live_counts);
  const completeness = raw.completeness ? obj(raw.completeness) : null;
  const parts: SitePlanPart[] = (Array.isArray(status.parts) ? status.parts : [])
    .map(obj)
    .filter((part) => isPart(part.key))
    .map((part) => ({ key: part.key as PlanPartKey, done: part.done === true, skipped: part.skipped === true, optional: part.optional === true }));
  const story = plan && plan.story ? obj(plan.story) : null;
  return {
    brandId,
    entitled: raw.entitled === true,
    rank: num(raw.rank),
    canManage: raw.can_manage === true,
    site: site && str(site.id)
      ? { id: String(site.id), status: String(site.status ?? ""), designKey: str(site.design_key), published: site.published === true, paused: site.paused === true }
      : null,
    plan: plan
      ? {
        revision: num(plan.revision),
        designKey: str(plan.design_key),
        offeringsSelected: strings(plan.offerings_selected),
        venueDescriptor: str(plan.venue_descriptor),
        story: story
          ? { who: str(story.who) ?? undefined, why: str(story.why) ?? undefined, main_action: str(story.main_action) ?? undefined }
          : null,
        approvedPlan: plan.approved_plan ? Object.fromEntries(Object.entries(obj(plan.approved_plan)).filter(([, v]) => typeof v === "string")) as Record<string, string> : null,
        approvedAt: str(plan.approved_at),
        skippedParts: strings(plan.skipped_parts) ?? [],
        activePart: isPart(plan.active_part) ? plan.active_part : null,
        builtPages: strings(plan.built_pages),
        startedAt: str(plan.started_at),
        startedByMe: plan.started_by_me === true,
        startedByName: str(plan.started_by_name),
      }
      : null,
    parts,
    doneCount: num(status.done_count),
    nextPart: isPart(status.next_part) ? status.next_part : null,
    prefillOfferings: strings(raw.prefill_offerings),
    liveCounts: { trips: num(counts.trips), events: num(counts.events), experiences: num(counts.experiences) },
    lock: {
      active: lock.active === true,
      heldByMe: lock.held_by_me === true,
      holderName: str(lock.holder_name),
      expiresAt: str(lock.expires_at),
    },
    completeness: completeness
      ? {
        revision: num(completeness.revision),
        designKey: str(completeness.design_key),
        fields: (Array.isArray(completeness.fields) ? completeness.fields : [])
          .map(obj)
          .filter((field) => typeof field.key === "string")
          .map((field) => ({
            key: String(field.key),
            label: String(field.label ?? field.key),
            group: String(field.group ?? "Brand"),
            requirement: field.requirement === "required" || field.requirement === "optional"
              ? field.requirement
              : "recommended",
            state: ["missing", "invalid", "stale", "conflict", "verified", "not_applicable"].includes(String(field.state))
              ? field.state as BrandContextFieldState
              : "missing",
            value: field.value,
            sourceType: ["mingla", "owner", "public_research", "imported"].includes(String(field.source_type))
              ? field.source_type as BrandContextField["sourceType"]
              : null,
            sourceRef: str(field.source_ref),
            sourceUrl: str(field.source_url),
            observedAt: str(field.observed_at),
            ownerConfirmedAt: str(field.owner_confirmed_at),
            exceptionReason: str(field.exception_reason),
            humanActionRequired: field.human_action_required === true,
          })),
        requiredGapCount: num(completeness.required_gap_count),
        recommendedGapCount: num(completeness.recommended_gap_count),
        gapCount: num(completeness.gap_count),
        verifiedCount: num(completeness.verified_count),
        exceptionCount: num(completeness.exception_count),
        minimumComplete: completeness.minimum_complete === true,
        contextComplete: completeness.context_complete === true,
        checkedAt: str(completeness.checked_at),
      }
      : null,
  };
}

export function partLabel(key: PlanPartKey): string {
  return PLAN_PARTS.find((part) => part.key === key)?.label ?? key;
}
