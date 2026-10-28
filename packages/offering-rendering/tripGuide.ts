/**
 * Issue #2829 W4 — the trip guide: highlights, what to prepare, good to know,
 * FAQs, group size and activity level, stored on the trip in Mingla
 * (`public.trip_guides`, read publicly through `pg_public_trip_guide`, written
 * through `biz_upsert_trip_guide`).
 *
 * Pure (no React, no app src — I-MOR-0827). One owner for:
 *  - the shape the shared trip body renders (`TripOfferingGuide`) and the
 *    mapping from the RPC's snake_case JSON to it (`toTripOfferingGuide`) —
 *    used by every surface's adapter so all of them show the same thing;
 *  - the editor's draft, its limits (mirroring the SQL CHECKs) and the save
 *    payload.
 *
 * Constitution 9: a missing section is absent. Nothing here invents a
 * highlight, an answer or a group size.
 */

export const TRIP_GUIDE_ACTIVITY_LEVELS = ["easy", "moderate", "active", "challenging"] as const;
export type TripGuideActivityLevel = (typeof TRIP_GUIDE_ACTIVITY_LEVELS)[number];

export const TRIP_GUIDE_ACTIVITY_LABEL: Readonly<Record<TripGuideActivityLevel, string>> = {
  easy: "Easy",
  moderate: "Moderate",
  active: "Active",
  challenging: "Challenging",
};

export const TRIP_GUIDE_LIMITS = {
  highlights: 12,
  highlightLength: 140,
  textLength: 4000,
  faqs: 20,
  questionLength: 200,
  answerLength: 2000,
  groupMinimum: { min: 1, max: 1000 },
} as const;

export interface TripGuideFaq {
  question: string;
  answer: string;
}

/** What the shared trip body renders. */
export interface TripOfferingGuide {
  highlights: string[];
  whatToPrepare: string | null;
  goodToKnow: string | null;
  faqs: TripGuideFaq[];
  activityLevel: TripGuideActivityLevel | null;
  /** "Group size 6–16" / "Up to 16 travellers" / "Groups from 6 travellers" / null. */
  groupSizeLabel: string | null;
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
};

const isActivityLevel = (value: unknown): value is TripGuideActivityLevel =>
  typeof value === "string" && (TRIP_GUIDE_ACTIVITY_LEVELS as readonly string[]).includes(value);

/**
 * The group-size line. Shown only when the host set a group minimum or the
 * trip has a capacity; never a guessed number.
 */
export function tripGuideGroupSizeLabel(groupMinimum: number | null, capacity: number | null): string | null {
  const min = typeof groupMinimum === "number" && Number.isInteger(groupMinimum) && groupMinimum >= 1 ? groupMinimum : null;
  const cap = typeof capacity === "number" && Number.isInteger(capacity) && capacity >= 1 ? capacity : null;
  if (min !== null && cap !== null && min < cap) return `Group size ${min}–${cap}`;
  if (cap !== null) return `Up to ${cap} travellers`;
  if (min !== null) return `Groups from ${min} travellers`;
  return null;
}

/**
 * `pg_public_trip_guide` JSON (or null) → what the body renders, or null when
 * there is nothing to show. `capacity` is the trip's total places (null when
 * unlimited or unknown). With no guide at all the result is null, so a trip
 * without a guide renders exactly as before — even the group line is part of
 * the guide.
 */
export function toTripOfferingGuide(raw: unknown, capacity: number | null): TripOfferingGuide | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const highlights = Array.isArray(row.highlights)
    ? row.highlights
      .map((item) => text(item, TRIP_GUIDE_LIMITS.highlightLength))
      .filter((item): item is string => item !== null)
      .slice(0, TRIP_GUIDE_LIMITS.highlights)
    : [];
  const faqs = Array.isArray(row.faqs)
    ? row.faqs
      .map((faq) => {
        if (faq === null || typeof faq !== "object") return null;
        const question = text((faq as Record<string, unknown>).question, TRIP_GUIDE_LIMITS.questionLength);
        const answer = text((faq as Record<string, unknown>).answer, TRIP_GUIDE_LIMITS.answerLength);
        return question !== null && answer !== null ? { question, answer } : null;
      })
      .filter((faq): faq is TripGuideFaq => faq !== null)
      .slice(0, TRIP_GUIDE_LIMITS.faqs)
    : [];
  const groupMinimum = typeof row.group_minimum === "number" ? row.group_minimum : null;
  const guide: TripOfferingGuide = {
    highlights,
    whatToPrepare: text(row.what_to_prepare, TRIP_GUIDE_LIMITS.textLength),
    goodToKnow: text(row.good_to_know, TRIP_GUIDE_LIMITS.textLength),
    faqs,
    activityLevel: isActivityLevel(row.activity_level) ? row.activity_level : null,
    groupSizeLabel: tripGuideGroupSizeLabel(groupMinimum, capacity),
  };
  const hasContent = guide.highlights.length > 0 || guide.whatToPrepare !== null || guide.goodToKnow !== null ||
    guide.faqs.length > 0 || guide.activityLevel !== null || groupMinimum !== null;
  return hasContent ? guide : null;
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export interface TripGuideDraft {
  highlights: string[];
  whatToPrepare: string;
  goodToKnow: string;
  faqs: TripGuideFaq[];
  /** Kept as typed so a half-typed number is never silently changed. */
  groupMinimum: string;
  activityLevel: TripGuideActivityLevel | null;
}

export const EMPTY_TRIP_GUIDE_DRAFT: TripGuideDraft = {
  highlights: [],
  whatToPrepare: "",
  goodToKnow: "",
  faqs: [],
  groupMinimum: "",
  activityLevel: null,
};

/** The stored guide (biz_get_trip_guide JSON, or null) → the editor's draft. */
export function tripGuideDraftFrom(raw: unknown): TripGuideDraft {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_TRIP_GUIDE_DRAFT };
  const row = raw as Record<string, unknown>;
  return {
    highlights: Array.isArray(row.highlights) ? row.highlights.filter((item): item is string => typeof item === "string") : [],
    whatToPrepare: typeof row.what_to_prepare === "string" ? row.what_to_prepare : "",
    goodToKnow: typeof row.good_to_know === "string" ? row.good_to_know : "",
    faqs: Array.isArray(row.faqs)
      ? row.faqs
        .filter((faq): faq is Record<string, unknown> => faq !== null && typeof faq === "object")
        .map((faq) => ({
          question: typeof faq.question === "string" ? faq.question : "",
          answer: typeof faq.answer === "string" ? faq.answer : "",
        }))
      : [],
    groupMinimum: typeof row.group_minimum === "number" ? String(row.group_minimum) : "",
    activityLevel: isActivityLevel(row.activity_level) ? row.activity_level : null,
  };
}

/** Plain-English problems that would make the save be refused (same limits as the database). */
export function tripGuideDraftProblems(draft: TripGuideDraft): string[] {
  const problems: string[] = [];
  const highlights = draft.highlights.map((item) => item.trim()).filter((item) => item.length > 0);
  if (highlights.length > TRIP_GUIDE_LIMITS.highlights) problems.push(`Keep highlights to ${TRIP_GUIDE_LIMITS.highlights} or fewer.`);
  if (highlights.some((item) => item.length > TRIP_GUIDE_LIMITS.highlightLength)) {
    problems.push(`Each highlight can be up to ${TRIP_GUIDE_LIMITS.highlightLength} characters.`);
  }
  if (draft.whatToPrepare.trim().length > TRIP_GUIDE_LIMITS.textLength) problems.push(`"What to prepare" can be up to ${TRIP_GUIDE_LIMITS.textLength} characters.`);
  if (draft.goodToKnow.trim().length > TRIP_GUIDE_LIMITS.textLength) problems.push(`"Good to know" can be up to ${TRIP_GUIDE_LIMITS.textLength} characters.`);
  const faqs = draft.faqs.filter((faq) => faq.question.trim().length > 0 || faq.answer.trim().length > 0);
  if (faqs.length > TRIP_GUIDE_LIMITS.faqs) problems.push(`Keep questions to ${TRIP_GUIDE_LIMITS.faqs} or fewer.`);
  if (faqs.some((faq) => faq.question.trim().length === 0 || faq.answer.trim().length === 0)) {
    problems.push("Every question needs an answer, and every answer a question.");
  }
  if (faqs.some((faq) => faq.question.trim().length > TRIP_GUIDE_LIMITS.questionLength || faq.answer.trim().length > TRIP_GUIDE_LIMITS.answerLength)) {
    problems.push(`Questions can be up to ${TRIP_GUIDE_LIMITS.questionLength} characters and answers up to ${TRIP_GUIDE_LIMITS.answerLength}.`);
  }
  const min = draft.groupMinimum.trim();
  if (min.length > 0) {
    const value = Number(min);
    if (!/^\d+$/.test(min) || value < TRIP_GUIDE_LIMITS.groupMinimum.min || value > TRIP_GUIDE_LIMITS.groupMinimum.max) {
      problems.push(`The group minimum must be a whole number from ${TRIP_GUIDE_LIMITS.groupMinimum.min} to ${TRIP_GUIDE_LIMITS.groupMinimum.max}.`);
    }
  }
  return problems;
}

/** The draft → the `biz_upsert_trip_guide` payload (blanks dropped; a blank guide clears it). */
export function tripGuidePayload(draft: TripGuideDraft): Record<string, unknown> {
  const min = draft.groupMinimum.trim();
  return {
    highlights: draft.highlights.map((item) => item.trim()).filter((item) => item.length > 0),
    what_to_prepare: draft.whatToPrepare.trim() || null,
    good_to_know: draft.goodToKnow.trim() || null,
    faqs: draft.faqs
      .map((faq) => ({ question: faq.question.trim(), answer: faq.answer.trim() }))
      .filter((faq) => faq.question.length > 0 || faq.answer.length > 0),
    group_minimum: min.length > 0 ? Number(min) : null,
    activity_level: draft.activityLevel,
  };
}
