/**
 * #4522 — the pure rules behind the 4-step trip builder (flag `tripBuilderV2`).
 *
 * No React, no react-native, no network: the step map, the publish checklist,
 * the autosave pill, the inclusion chips, the traveler question library and the
 * dated-itinerary helpers. The refund chips live in `tripBuilderV2RefundChips.ts`
 * and the earnings numbers in `tripEarnings.ts`: each imports a module that a lazy
 * chunk also owns (the refund presets, the fee preview), so keeping them out of
 * this file keeps those modules out of the business-web boot payload (ORCH-1083).
 * The screens in `TripBuilderV2Parts.tsx` only draw what is decided here, so
 * every rule is testable without a renderer.
 *
 * I-4522-BUILDER-V2-STEPS: the builder has exactly the four steps below and
 * every publish blocker is a checklist item that names the step to fix it in.
 */

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
// Peek sheet + preview freshness
// ---------------------------------------------------------------------------

/** Preview pane shows from this web width (spec §9.4). */
export const PREVIEW_PANE_MIN_WIDTH = 1180;
export const PREVIEW_PEEK_COLLAPSED_HEIGHT = 88;
/** The preview follows the draft within this many milliseconds (spec §9.4). */
export const PREVIEW_UPDATE_DELAY_MS = 300;

// ---------------------------------------------------------------------------
// Trip dates, the dated itinerary and the booking deadline (slice 11)
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` of a stored trip date. Trip dates are calendar dates stored at UTC. */
export function tripDayOf(iso: string | null): string {
  if (iso === null) return "";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "";
}

const dayMs = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);

/** Nights between two `YYYY-MM-DD` days (end after start); null when either is unset or the order is wrong. */
export function nightsBetweenDays(start: string, end: string): number | null {
  const a = dayMs(start);
  const b = dayMs(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

/** "5 days · 4 nights" (the itinerary has nights + 1 days), or null when the range is not set. */
export function describeTripLength(start: string, end: string): string | null {
  const nights = nightsBetweenDays(start, end);
  if (nights === null) return null;
  const days = nights + 1;
  return `${days} ${days === 1 ? "day" : "days"} · ${nights} ${nights === 1 ? "night" : "nights"}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Day 1 · Fri 12 Mar": the date a day falls on, from the trip's first day. */
export function dayDateLabel(ordinal: number, startAt: string | null): string {
  const start = dayMs(tripDayOf(startAt));
  if (!Number.isFinite(start) || ordinal < 1) return `Day ${ordinal}`;
  const d = new Date(start + (ordinal - 1) * MS_PER_DAY);
  return `Day ${ordinal} · ${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * Moves one day's content to another slot. The slots (Day 1, Day 2 ... and the
 * dates behind them) stay where they are; a seeded "Day N" title follows its
 * slot, a title the host wrote travels with its content.
 */
export function reorderDays<T extends { ordinal: number; title: string }>(
  days: ReadonlyArray<T>,
  from: number,
  to: number,
): T[] {
  if (from === to || from < 0 || to < 0 || from >= days.length || to >= days.length) {
    return [...days];
  }
  const next = [...days];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((d, i) => {
    const ordinal = i + 1;
    const seeded = d.title === `Day ${d.ordinal}`;
    return { ...d, ordinal, title: seeded ? `Day ${ordinal}` : d.title };
  });
}

/** Where a dragged card lands, from the heights of the cards and how far it was dragged. */
export function dragTargetIndex(
  heights: ReadonlyArray<number>,
  gap: number,
  from: number,
  dy: number,
): number {
  let index = from;
  let remaining = dy;
  if (dy > 0) {
    while (index < heights.length - 1 && remaining > heights[index + 1] / 2) {
      remaining -= heights[index + 1] + gap;
      index += 1;
    }
  } else if (dy < 0) {
    while (index > 0 && -remaining > heights[index - 1] / 2) {
      remaining += heights[index - 1] + gap;
      index -= 1;
    }
  }
  return index;
}

// -- booking deadline in the trip's time zone --------------------------------

const wallParts = (ms: number, timeZone: string): Record<string, string> => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(ms));
  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
};

/** The wall clock an instant shows in a zone: `{ date: "YYYY-MM-DD", time: "HH:mm" }`. */
export function wallInZone(iso: string, timeZone: string): { date: string; time: string } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    const p = wallParts(ms, timeZone);
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  } catch {
    return null;
  }
}

/**
 * The instant a wall clock is in a zone. The zone's offset is read a day before
 * and a day after, so a wall time next to a clock change resolves correctly: a
 * time that happens twice (clocks go back) is the first one; a time that never
 * happens (clocks go forward) lands just after the gap.
 */
export function instantFromWall(date: string, time: string, timeZone: string): string | null {
  const base = Date.parse(`${date}T${time}:00.000Z`);
  if (!Number.isFinite(base)) return null;
  try {
    const offsetAt = (ms: number): number => {
      const p = wallParts(ms, timeZone);
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60_000) * 60_000;
    };
    const candidates = Array.from(
      new Set([base - offsetAt(base - MS_PER_DAY), base - offsetAt(base + MS_PER_DAY)]),
    );
    const showsWall = (ms: number): boolean => {
      const p = wallParts(ms, timeZone);
      return `${p.year}-${p.month}-${p.day}` === date && `${p.hour}:${p.minute}` === time;
    };
    const exact = candidates.filter(showsWall);
    const chosen = exact.length > 0 ? Math.min(...exact) : Math.max(...candidates);
    return new Date(chosen).toISOString();
  } catch {
    return null;
  }
}

/**
 * Today's date in a zone, `YYYY-MM-DD`. Here and not `@mingla/calendar`'s
 * `todayInZone`: the wizard's chunk must not import the calendar package, whose
 * helpers the lazy calendar chunk shares (a module two chunks import is hoisted
 * into the business-web boot payload; ORCH-1083).
 */
export function todayInZoneDay(timeZone: string, now: Date = new Date()): string {
  return wallInZone(now.toISOString(), timeZone)?.date ?? now.toISOString().slice(0, 10);
}

/** Why a deadline cannot be saved, or null. `now` is the real current time. */
export function deadlineProblem(
  deadlineIso: string,
  tripStartIso: string | null,
  now: number,
): string | null {
  const ms = Date.parse(deadlineIso);
  if (!Number.isFinite(ms)) return "That deadline is not a real date and time.";
  if (ms <= now) return "Deadline must be in the future.";
  if (tripStartIso !== null) {
    const start = Date.parse(tripStartIso);
    if (Number.isFinite(start) && ms >= start) return "Deadline must be before trip starts.";
  }
  return null;
}
