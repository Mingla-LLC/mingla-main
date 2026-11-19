/**
 * #4453 (spec v1 §3.2, spec v2 §6.7) — the setup part "What guests say and
 * where you've been": the forms' fields, limits and checks, kept pure so the
 * rules are tested without rendering. Every value is the owner's own words,
 * trimmed and saved verbatim; nothing here writes or improves copy, and a
 * review cannot be saved without the "real review" tick (Constitution rule 9).
 */
import {
  PROOF_LIMITS,
  faqProblem,
  processStepsProblem,
  quickFactsProblem,
  valuePointsProblem,
  type FaqItem,
  type ProcessStep,
  type QuickFacts,
  type ValuePoint,
} from "../../../packages/site-contracts/src/sitePlan.ts";

export type StagedKind = "review" | "destination" | "story";

export type FormField = {
  key: string;
  label: string;
  max: number;
  required: boolean;
  multiline?: boolean;
  placeholder?: string;
  help?: string;
};

/** The fields of each staged entry (Q1, Q3, Q4), in form order. */
export const STAGED_FIELDS: Readonly<Record<StagedKind, readonly FormField[]>> = {
  review: [
    { key: "reviewer", label: "Reviewer", max: PROOF_LIMITS.review.reviewer, required: true, help: "Exactly as they are shown where they left the review." },
    { key: "quote", label: "Review, word for word", max: PROOF_LIMITS.review.quote, required: true, multiline: true, help: "Paste it exactly as they wrote it, typos included." },
    { key: "trip_name", label: "Trip (optional)", max: PROOF_LIMITS.review.trip_name, required: false },
    { key: "review_date", label: "Month written", max: 7, required: true, placeholder: "2026-03", help: "Year and month, like 2026-03." },
    { key: "source", label: "Where it's from", max: PROOF_LIMITS.review.source, required: true, help: "For your records only, never shown. For example: Google, March 2026." },
  ],
  destination: [
    { key: "name", label: "Place", max: PROOF_LIMITS.destination.name, required: true },
    { key: "country", label: "Country (optional)", max: PROOF_LIMITS.destination.country, required: false },
    { key: "short_line", label: "Short line (optional)", max: PROOF_LIMITS.destination.short_line, required: false },
    { key: "summary", label: "Summary (optional)", max: PROOF_LIMITS.destination.summary, required: false, multiline: true },
  ],
  story: [
    { key: "title", label: "Title", max: PROOF_LIMITS.story.title, required: true },
    { key: "summary", label: "Short summary (optional)", max: PROOF_LIMITS.story.summary, required: false, multiline: true },
    { key: "story", label: "Your story", max: PROOF_LIMITS.story.story, required: true, multiline: true },
  ],
};

export const PAST_TRIP_FIELDS: readonly FormField[] = [
  { key: "title", label: "Trip name", max: PROOF_LIMITS.past_trip.title, required: true },
  { key: "where", label: "Where", max: PROOF_LIMITS.past_trip.where, required: true },
  { key: "start_date", label: "First day", max: 10, required: true, placeholder: "2025-06-01", help: "Year, month and day, like 2025-06-01." },
  { key: "end_date", label: "Last day", max: 10, required: true, placeholder: "2025-06-07" },
  { key: "description", label: "Short description (optional)", max: PROOF_LIMITS.past_trip.description, required: false, multiline: true },
];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function fieldProblem(field: FormField, value: string): string | null {
  const trimmed = value.trim();
  if (field.required && !trimmed) return `Add ${field.label.replace(/ \(optional\)$/, "").toLowerCase()}.`;
  if (value.length > field.max) return `Keep it to ${field.max} characters.`;
  if (/[<>]/.test(value)) return "Take the < and > out.";
  return null;
}

/** The owner's values, trimmed; empty optional fields dropped. */
export function cleanValues(fields: readonly FormField[], values: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = (values[field.key] ?? "").trim();
    if (value) out[field.key] = value;
  }
  return out;
}

/** Field-by-field problems for a staged entry; empty when it can be saved. */
export function stagedProblems(kind: StagedKind, values: Readonly<Record<string, string>>, confirmedReal: boolean): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const field of STAGED_FIELDS[kind]) {
    const problem = fieldProblem(field, values[field.key] ?? "");
    if (problem) problems[field.key] = problem;
  }
  if (kind === "review") {
    const month = (values.review_date ?? "").trim();
    if (!problems.review_date && !MONTH.test(month)) problems.review_date = "Use year and month, like 2026-03.";
    if (!problems.review_date && month > new Date().toISOString().slice(0, 7)) problems.review_date = "That month hasn't happened yet.";
    if (!confirmedReal) problems.confirmed = "Tick this to save the review. Only real reviews from real guests go on your site.";
  }
  return problems;
}

/** Problems for a past trip; it must have ended (Core checks it again, in the trip's timezone). */
export function pastTripProblems(values: Readonly<Record<string, string>>, today: string): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const field of PAST_TRIP_FIELDS) {
    const problem = fieldProblem(field, values[field.key] ?? "");
    if (problem) problems[field.key] = problem;
  }
  const start = (values.start_date ?? "").trim();
  const end = (values.end_date ?? "").trim();
  if (!problems.start_date && !DAY.test(start)) problems.start_date = "Use year, month and day, like 2025-06-01.";
  if (!problems.end_date && !DAY.test(end)) problems.end_date = "Use year, month and day, like 2025-06-07.";
  if (!problems.start_date && !problems.end_date && end < start) problems.end_date = "The last day comes after the first.";
  if (!problems.end_date && end >= today) problems.end_date = "Past trips must have ended. Add upcoming trips from Create.";
  return problems;
}

/** One line for a staged entry in its list. */
export function stagedTitle(kind: StagedKind, payload: Readonly<Record<string, string>>): { title: string; line: string | null } {
  if (kind === "review") return { title: payload.reviewer ?? "Review", line: payload.quote ? `“${payload.quote.slice(0, 90)}${payload.quote.length > 90 ? "…" : ""}”` : null };
  if (kind === "destination") return { title: payload.name ?? "Place", line: payload.country ?? null };
  return { title: payload.title ?? "Story", line: payload.summary ?? null };
}

/** The Q5-Q8 answers as Core stores them: empty rows dropped, an empty answer is null. */
export function answersPatch(input: {
  valuePoints: ValuePoint[];
  faq: FaqItem[];
  processSteps: ProcessStep[] | null;
  quickFacts: QuickFacts;
}): { patch: Record<string, unknown>; problem: string | null } {
  const filled = <T extends Record<string, unknown>>(rows: T[]) =>
    rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]).filter(([, v]) => v !== "")) as T)
      .filter((row) => Object.values(row).some((v) => typeof v === "string" && v !== ""));
  const points = filled(input.valuePoints);
  const faq = filled(input.faq);
  const steps = input.processSteps ? filled(input.processSteps) : null;
  const facts = filled(input.quickFacts.facts);
  const ticker = input.quickFacts.ticker.map((phrase) => phrase.trim()).filter(Boolean);
  const quick: QuickFacts | null = facts.length || ticker.length ? { facts, use_in_ticker: input.quickFacts.use_in_ticker, ticker } : null;
  const problem = (points.length ? valuePointsProblem(points) : null)
    ?? (faq.length ? faqProblem(faq) : null)
    ?? (steps && steps.length ? processStepsProblem(steps) : null)
    ?? (quick ? quickFactsProblem(quick) : null);
  const patch: Record<string, unknown> = {
    value_points: points.length ? points : null,
    faq: faq.length ? faq : null,
    quick_facts: quick,
  };
  if (steps !== null) patch.process_steps = steps.length ? steps : null;
  return { patch, problem };
}

/** The device's timezone for a past trip (the owner can change it). */
export function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
