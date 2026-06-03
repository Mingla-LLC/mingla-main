/**
 * experienceListSubline — META-ORCH-1059 (Hub experiences list polish).
 *
 * Derives the one-line date/venue subline for an experience LIST row from the
 * raw `theme.experience_meta.when_draft` blob the wizard persists on every save.
 *
 * Why this exists separately from `formatExperienceDateSubline`:
 *   - The dashboard renders from MATERIALISED `event_dates` rows (publish-only),
 *     so it already has ISO `startAt` strings to hand to `formatExperienceDateSubline`.
 *   - A list row must avoid an N+1 fetch of every experience's stops/dates. The
 *     lightweight list query (`getExperiencesByBrand`) only has the events-row +
 *     its `theme`, so this helper converts `when_draft` → the same ISO inputs and
 *     reuses the ONE subline formatter. Drafts (no materialised dates) still get a
 *     correct subline because `when_draft` is written on every save.
 *
 * Pure + deterministic given a `nowMs` injection point (defaults to Date.now()).
 */

import {
  formatExperienceDateSubline,
  type ExperienceWhenMode,
} from "./experienceDateSubline";
import type { RecurrenceRule } from "../store/draftEventStore";

export interface ExperienceListWhenDraft {
  venueText: string | null;
  whenMode: ExperienceWhenMode;
  /** Raw `theme.experience_meta.when_draft` object, or null when none persisted. */
  whenDraft: Record<string, unknown> | null;
}

/** Combine a "YYYY-MM-DD" date and an "HH:MM" time into an ISO string. */
function isoFromDateTime(date: string, time: string | null): string | null {
  if (date.length === 0) return null;
  const t = time !== null && time.length >= 4 ? time : "00:00";
  const composed = `${date}T${t.length === 5 ? t : `${t}:00`}`;
  const d = new Date(composed);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function firstRecurrenceRule(raw: unknown): RecurrenceRule | null {
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object") {
    return raw[0] as RecurrenceRule;
  }
  if (raw !== null && typeof raw === "object" && "preset" in (raw as object)) {
    return raw as RecurrenceRule;
  }
  return null;
}

/**
 * Derive the ISO start strings + recurrence rule from a `when_draft` blob.
 * Tolerant: missing/malformed fields degrade to empty rather than throwing.
 */
function isosFromWhenDraft(
  whenDraft: Record<string, unknown> | null,
  whenMode: ExperienceWhenMode,
): { isos: string[]; rule: RecurrenceRule | null } {
  if (whenDraft === null) return { isos: [], rule: null };

  if (whenMode === "multi_date") {
    const raw = whenDraft.multiDates;
    if (!Array.isArray(raw)) return { isos: [], rule: null };
    const isos = raw
      .filter((e): e is Record<string, unknown> => e !== null && typeof e === "object")
      .map((e) =>
        isoFromDateTime(
          typeof e.date === "string" ? e.date : "",
          typeof e.startTime === "string" ? e.startTime : null,
        ),
      )
      .filter((iso): iso is string => iso !== null);
    return { isos, rule: null };
  }

  // single + recurring both carry a `when.date` (+ `when.doorsOpen` time). For
  // recurring, that's the series anchor; the formatter shows the recurrence label.
  const rule =
    whenMode === "recurring"
      ? firstRecurrenceRule(whenDraft.recurrence_rules ?? whenDraft.recurrenceRule)
      : null;
  const when =
    whenDraft.when !== null && typeof whenDraft.when === "object"
      ? (whenDraft.when as Record<string, unknown>)
      : null;
  if (when === null) return { isos: [], rule };
  const iso = isoFromDateTime(
    typeof when.date === "string" ? when.date : "",
    typeof when.doorsOpen === "string" ? when.doorsOpen : null,
  );
  return { isos: iso !== null ? [iso] : [], rule };
}

export function experienceListSubline(
  input: ExperienceListWhenDraft,
  nowMs: number = Date.now(),
): string {
  const { isos, rule } = isosFromWhenDraft(input.whenDraft, input.whenMode);
  return formatExperienceDateSubline(
    {
      venueText: input.venueText,
      dateStartIsos: isos,
      whenMode: input.whenMode,
      recurrenceRule: rule,
    },
    nowMs,
  );
}
