/**
 * #4522 — the pure rules behind the 4-step trip builder (flag `tripBuilderV2`).
 *
 * No React, no react-native, no network: the step map, the publish checklist,
 * the autosave pill, the inclusion chips, the refund chips, the traveler
 * question library, the earnings card's numbers and the dated-itinerary helpers.
 * The screens in `TripBuilderV2Parts.tsx` only draw what is decided here, so
 * every rule is testable without a renderer.
 *
 * I-4522-BUILDER-V2-STEPS: the builder has exactly the four steps below and
 * every publish blocker is a checklist item that names the step to fix it in.
 */

import { computePreview, type PreviewSwitches } from "../../utils/pricingPreview";
import type { RefundPolicy } from "../../services/refundPolicyModel";
import {
  NO_REFUNDS_POLICY,
} from "../../services/refundPolicyModel";
import type {
  IntakeQuestion,
  IntakeSchema,
} from "../../services/intakeSchemaService";

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type BuilderStep = 1 | 2 | 3 | 4;

export const BUILDER_STEP_COUNT = 4;

export const BUILDER_STEP_TITLES: Readonly<Record<BuilderStep, string>> = {
  1: "Trip",
  2: "Itinerary & inclusions",
  3: "Pricing & policy",
  4: "Travelers & publish",
};

export function isBuilderStep(value: number): value is BuilderStep {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/** Which step a publish refusal from the server points at, in the 4-step map. */
export function builderStepForLegacyStep(legacyStep: number): BuilderStep {
  if (legacyStep <= 1) return 1;
  if (legacyStep <= 3) return 2;
  if (legacyStep <= 5) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// Publish checklist (spec §9.5)
// ---------------------------------------------------------------------------

export type ChecklistKey =
  | "title"
  | "description"
  | "cover"
  | "dates"
  | "places"
  | "itinerary"
  | "package"
  | "plan"
  | "deadline"
  | "payouts"
  | "invites";

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  done: boolean;
  /** The step that fixes it. */
  step: BuilderStep;
  /** Set on "Bank connected": the item offers "Connect bank" instead of a jump. */
  action: "jump" | "connect_bank";
}

export interface ChecklistInput {
  title: string;
  description: string;
  hasCover: boolean;
  startAt: string | null;
  endAt: string | null;
  placesValid: boolean;
  days: ReadonlyArray<{ ordinal: number; title: string; narrative: string; media?: ReadonlyArray<unknown> }>;
  packagesOk: boolean;
  hasPricedPackage: boolean;
  planOk: boolean;
  bookingDeadline: string | null;
  payoutsReady: boolean;
  invitesReady: boolean;
}

export const DESCRIPTION_MIN_CHARS = 20;

/** A day is filled when the host wrote anything beyond the seeded "Day N". */
export function dayIsFilled(day: ChecklistInput["days"][number]): boolean {
  const title = day.title.trim();
  const seeded = title.length === 0 || title === `Day ${day.ordinal}`;
  return !seeded || day.narrative.trim().length > 0 || (day.media?.length ?? 0) > 0;
}

export function buildPublishChecklist(input: ChecklistInput): ChecklistItem[] {
  const startMs = input.startAt === null ? NaN : Date.parse(input.startAt);
  const deadlineMs =
    input.bookingDeadline === null ? NaN : Date.parse(input.bookingDeadline);
  const deadlineOk =
    input.bookingDeadline === null ||
    Number.isNaN(startMs) ||
    (Number.isFinite(deadlineMs) && deadlineMs < startMs);
  return [
    { key: "title", label: "Trip title", done: input.title.trim().length > 0, step: 1, action: "jump" },
    {
      key: "description",
      label: `Description (${DESCRIPTION_MIN_CHARS}+ characters)`,
      done: input.description.trim().length >= DESCRIPTION_MIN_CHARS,
      step: 1,
      action: "jump",
    },
    { key: "cover", label: "Cover photo", done: input.hasCover, step: 1, action: "jump" },
    {
      key: "dates",
      label: "Trip dates",
      done: input.startAt !== null && input.endAt !== null,
      step: 1,
      action: "jump",
    },
    {
      key: "places",
      label: "Departure and destination",
      done: input.placesValid,
      step: 1,
      action: "jump",
    },
    {
      key: "itinerary",
      label: "Every itinerary day filled in",
      done: input.days.length > 0 && input.days.every(dayIsFilled),
      step: 2,
      action: "jump",
    },
    {
      key: "package",
      label: "A package with a price",
      done: input.packagesOk && input.hasPricedPackage,
      step: 3,
      action: "jump",
    },
    { key: "plan", label: "Payment plan", done: input.planOk, step: 3, action: "jump" },
    {
      key: "deadline",
      label: "Booking deadline before the trip starts",
      done: deadlineOk,
      step: 3,
      action: "jump",
    },
    {
      key: "payouts",
      label: "Bank connected",
      done: input.payoutsReady,
      step: 4,
      action: "connect_bank",
    },
    { key: "invites", label: "Invites ready", done: input.invitesReady, step: 4, action: "jump" },
  ];
}

export function checklistProgress(items: ReadonlyArray<ChecklistItem>): {
  done: number;
  total: number;
} {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

/** "Publish unlocks when Cover photo and Trip dates are done." (null = unlocked) */
export function publishUnlockLine(items: ReadonlyArray<ChecklistItem>): string | null {
  const open = items.filter((i) => !i.done).map((i) => i.label);
  if (open.length === 0) return null;
  const list =
    open.length === 1
      ? open[0]
      : `${open.slice(0, -1).join(", ")} and ${open[open.length - 1]}`;
  return `Publish unlocks when ${list} ${open.length === 1 ? "is" : "are"} done.`;
}

/** The first unmet item, for the top-bar Publish tap. */
export function firstOpenItem(items: ReadonlyArray<ChecklistItem>): ChecklistItem | null {
  return items.find((i) => !i.done) ?? null;
}

// ---------------------------------------------------------------------------
// Autosave pill (spec §9.9)
// ---------------------------------------------------------------------------

export type PillKind = "saving" | "saved" | "error" | "conflict" | "idle";

export interface PillState {
  kind: PillKind;
  label: string;
  /** True when a tap should retry the save now. */
  retryable: boolean;
}

export function autosavePillState(input: {
  saving: boolean;
  pending: boolean;
  failed: boolean;
  conflict: boolean;
  savedAt: string | null;
}): PillState {
  if (input.conflict) {
    return { kind: "conflict", label: "Not saved — this trip changed somewhere else", retryable: false };
  }
  if (input.saving) return { kind: "saving", label: "Saving…", retryable: false };
  if (input.failed) return { kind: "error", label: "Not saved — retrying", retryable: true };
  if (input.pending) return { kind: "saving", label: "Saving…", retryable: false };
  if (input.savedAt !== null) return { kind: "saved", label: "Saved", retryable: false };
  return { kind: "idle", label: "", retryable: false };
}

/** Debounce after the last change (spec §9.9). */
export const AUTOSAVE_DEBOUNCE_MS = 800;
/** Retry delays after a failed background save: 2s, 4s, 8s, then every 30s. */
export function autosaveRetryDelayMs(attempt: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, attempt));
}

/**
 * Which of the wizard's six save groups changed since the last save. A group is
 * saved only when its signature moved, so an edit in one place never rewrites
 * the others (and never bumps an untouched package's or form's version).
 */
export type SaveGroup = "basics" | "days" | "inclusions" | "pricing" | "policy" | "intake";

export function dirtySaveGroups(
  current: Readonly<Record<SaveGroup, string>>,
  saved: Readonly<Record<SaveGroup, string>>,
  intakeDirty: boolean,
): SaveGroup[] {
  const groups: SaveGroup[] = ["basics", "days", "inclusions", "pricing", "policy"];
  const out = groups.filter((g) => current[g] !== saved[g]);
  if (intakeDirty) out.push("intake");
  return out;
}

/** Package signature that ignores server-assigned ids, so adopting an id after a create is not an edit. */
export function pricingSignature(draft: {
  currency: string;
  pricingSwitches: unknown;
  packages: ReadonlyArray<object>;
}): string {
  return JSON.stringify({
    c: draft.currency,
    s: draft.pricingSwitches,
    p: draft.packages.map((p) => {
      const { ticketTypeId: _id, key: _key, ...rest } = p as { ticketTypeId?: unknown; key?: unknown };
      return rest;
    }),
  });
}

// ---------------------------------------------------------------------------
// Inclusions (spec §9.3 step 2)
// ---------------------------------------------------------------------------

export interface InclusionChip {
  label: string;
  icon: "send" | "home" | "sparkle" | "swap" | "compass" | "flash" | "shield" | "gift";
}

export const INCLUSION_CHIPS: ReadonlyArray<InclusionChip> = [
  { label: "Flights", icon: "send" },
  { label: "Hotel", icon: "home" },
  { label: "Breakfast", icon: "sparkle" },
  { label: "Airport transfer", icon: "swap" },
  { label: "Guide", icon: "compass" },
  { label: "Activities", icon: "flash" },
  { label: "Insurance", icon: "shield" },
  { label: "Dinners", icon: "gift" },
];

export interface InclusionItem {
  kind: "included" | "excluded";
  item: string;
  ordinal: number;
}

export function inclusionChipOn(items: ReadonlyArray<InclusionItem>, label: string): boolean {
  const want = label.trim().toLowerCase();
  return items.some((i) => i.kind === "included" && i.item.trim().toLowerCase() === want);
}

/** One tap: adds the chip as an included item, or removes it when already on. */
export function toggleInclusionChip(
  items: ReadonlyArray<InclusionItem>,
  label: string,
): InclusionItem[] {
  const want = label.trim().toLowerCase();
  if (inclusionChipOn(items, label)) {
    return items.filter(
      (i) => !(i.kind === "included" && i.item.trim().toLowerCase() === want),
    );
  }
  const included = items.filter((i) => i.kind === "included");
  const ordinal = included.length === 0 ? 0 : Math.max(...included.map((i) => i.ordinal)) + 1;
  return [...items, { kind: "included", item: label, ordinal }];
}

// ---------------------------------------------------------------------------
// Refund chips (spec §9.3 step 3; keys from the slice 1 refund policy)
// ---------------------------------------------------------------------------

export type RefundChipKey = "full_30" | "half_14" | "none" | "custom";

export const REFUND_CHIPS: ReadonlyArray<{ key: RefundChipKey; label: string }> = [
  { key: "full_30", label: "Full refund until 30 days before" },
  { key: "half_14", label: "50% until 14 days before" },
  { key: "none", label: "No refunds" },
  { key: "custom", label: "Custom…" },
];

const FULL_30: RefundPolicy = {
  kind: "custom",
  tiers: [
    { days_before_start: 30, refund_pct: 100 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};
const HALF_14: RefundPolicy = {
  kind: "custom",
  tiers: [
    { days_before_start: 14, refund_pct: 50 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};

const sameTiers = (a: RefundPolicy, b: RefundPolicy): boolean =>
  JSON.stringify(a.tiers) === JSON.stringify(b.tiers);

/** Which chip a stored policy reads as; anything else reads as Custom. */
export function refundChipOf(policy: RefundPolicy | null): RefundChipKey | null {
  if (policy === null) return null;
  if (policy.no_refunds === true || sameTiers(policy, NO_REFUNDS_POLICY)) return "none";
  if (sameTiers(policy, FULL_30)) return "full_30";
  if (sameTiers(policy, HALF_14)) return "half_14";
  return "custom";
}

/**
 * The policy a preset chip writes. "No refunds" writes the one 0% tier every
 * buyer surface already renders; the `no_refunds` flag is not written until a
 * buyer surface renders it (the offering reader holds it as unknown today).
 * The deposit rule survives a chip change.
 */
export function applyRefundChip(
  current: RefundPolicy | null,
  key: Exclude<RefundChipKey, "custom">,
): RefundPolicy {
  const base = key === "full_30" ? FULL_30 : key === "half_14" ? HALF_14 : NO_REFUNDS_POLICY;
  const base2: RefundPolicy = { kind: base.kind, tiers: base.tiers.map((t) => ({ ...t })) };
  return current?.deposit_non_refundable === true
    ? { ...base2, deposit_non_refundable: true }
    : base2;
}

/** The key is written only when on, so a policy without the rule stays byte-identical. */
export function withDepositNonRefundable(
  policy: RefundPolicy | null,
  on: boolean,
): RefundPolicy {
  const base: RefundPolicy = policy ?? { kind: "custom", tiers: [{ days_before_start: 0, refund_pct: 0 }] };
  const { deposit_non_refundable: _drop, ...rest } = base;
  return on ? { ...rest, deposit_non_refundable: true } : rest;
}

// ---------------------------------------------------------------------------
// Traveler question library (spec §9.8)
// ---------------------------------------------------------------------------

export interface LibraryQuestion {
  key: string;
  label: string;
  type: IntakeQuestion["type"];
  required: boolean;
}

export const TRAVELER_QUESTION_LIBRARY: ReadonlyArray<LibraryQuestion> = [
  { key: "passport_name", label: "Name as on passport", type: "short_text", required: true },
  { key: "dob", label: "Date of birth", type: "date", required: true },
  { key: "nationality", label: "Nationality", type: "short_text", required: true },
  { key: "passport_number", label: "Passport number", type: "short_text", required: true },
  { key: "passport_expiry", label: "Passport expiry", type: "date", required: true },
  { key: "dietary", label: "Dietary needs", type: "short_text", required: false },
  { key: "medical", label: "Medical notes", type: "long_text", required: false },
  { key: "emergency_contact", label: "Emergency contact", type: "short_text", required: true },
  { key: "tshirt", label: "T-shirt size", type: "single_choice", required: false },
];

const TSHIRT_OPTIONS = ["XS", "S", "M", "L", "XL", "XXL"];
export const MAX_INTAKE_QUESTIONS = 20;

export function libraryQuestionOn(schema: IntakeSchema | null, label: string): boolean {
  const want = label.trim().toLowerCase();
  return (schema?.questions ?? []).some((q) => q.label.trim().toLowerCase() === want);
}

/**
 * Appends a library question to a schema in the existing intake shape. The
 * caller supplies `makeId` (the service's own id minting) and `bump` (the
 * service's own version bump), so the schema stays the one the checkout form
 * reads. Returns null when the form is full or the question is already there.
 */
export function addLibraryQuestion(
  schema: IntakeSchema | null,
  q: LibraryQuestion,
  deps: {
    emptySchema: () => IntakeSchema;
    makeId: () => string;
    bump: (s: IntakeSchema) => IntakeSchema;
  },
): IntakeSchema | null {
  const base = schema ?? deps.emptySchema();
  if (libraryQuestionOn(base, q.label)) return null;
  if (base.questions.length >= MAX_INTAKE_QUESTIONS) return null;
  const question: IntakeQuestion = {
    id: deps.makeId(),
    type: q.type,
    label: q.label,
    required: q.required,
    position: base.questions.length,
    ...(q.type === "single_choice" ? { options: [...TSHIRT_OPTIONS] } : {}),
  };
  return deps.bump({ ...base, questions: [...base.questions, question] });
}

/** Removes a library question by label; null when the form is left empty (cleared). */
export function removeLibraryQuestion(
  schema: IntakeSchema | null,
  label: string,
  bump: (s: IntakeSchema) => IntakeSchema,
): IntakeSchema | null {
  if (schema === null) return null;
  const want = label.trim().toLowerCase();
  const kept = schema.questions
    .filter((q) => q.label.trim().toLowerCase() !== want)
    .map((q, i) => ({ ...q, position: i }));
  if (kept.length === schema.questions.length) return schema;
  return kept.length === 0 ? null : bump({ ...schema, questions: kept });
}

// ---------------------------------------------------------------------------
// Earnings card (spec §9.6) — the numbers come from pricingPreview, never made up
// ---------------------------------------------------------------------------

export interface EarningsInput {
  /** Package price in minor units (cents/kobo). */
  priceMinor: number;
  /** null = the brand's rate could not be read: no fee rows are invented. */
  takeRateBps: number | null;
  serviceFeeBps?: number;
  switches: PreviewSwitches;
  vatRateBps?: number | null;
}

export interface EarningsRows {
  priceMinor: number;
  /** The Mingla fee (take rate + service fee) the host pays out of the price. */
  feeMinor: number;
  /** The part of the fee added to the buyer's price instead. */
  feePassedMinor: number;
  vatMinor: number | null;
  receiveMinor: number;
}

/** null when the rate is unknown ("We'll show your earnings once your payout settings load."). */
export function computeEarningsRows(input: EarningsInput): EarningsRows | null {
  if (input.takeRateBps === null) return null;
  const r = computePreview({
    baseCents: input.priceMinor,
    switches: input.switches,
    effectiveTakeRateBps: input.takeRateBps,
    serviceFeeBps: input.serviceFeeBps,
    vatRateBps: input.vatRateBps,
  });
  const hasVat = input.vatRateBps !== null && input.vatRateBps !== undefined && input.vatRateBps > 0;
  return {
    priceMinor: r.baseCents,
    feeMinor: r.absorbed.miglaFeeCents + r.absorbed.serviceFeeCents,
    feePassedMinor: r.passed.miglaFeeCents + r.passed.serviceFeeCents,
    vatMinor: hasVat ? r.taxCents : null,
    receiveMinor: r.youKeepCents,
  };
}

/**
 * "At {spots} travelers": what the host receives if every spot on every priced
 * package sells, each package at its own price. Packages with no spots set are
 * left out (never assumed).
 */
export function earningsAtFullCapacity(
  packages: ReadonlyArray<{ priceMinor: number; spots: number | null }>,
  base: Omit<EarningsInput, "priceMinor">,
): { spots: number; receiveMinor: number } | null {
  let spots = 0;
  let receive = 0;
  for (const p of packages) {
    if (p.spots === null || p.spots <= 0 || p.priceMinor <= 0) continue;
    const rows = computeEarningsRows({ ...base, priceMinor: p.priceMinor });
    if (rows === null) return null;
    spots += p.spots;
    receive += rows.receiveMinor * p.spots;
  }
  return spots > 0 ? { spots, receiveMinor: receive } : null;
}

// ---------------------------------------------------------------------------
// Peek sheet + preview freshness
// ---------------------------------------------------------------------------

/** Preview pane shows from this web width (spec §9.4). */
export const PREVIEW_PANE_MIN_WIDTH = 1180;
export const PREVIEW_PEEK_COLLAPSED_HEIGHT = 88;
/** The preview follows the draft within this many milliseconds (spec §9.4). */
export const PREVIEW_UPDATE_DELAY_MS = 300;
