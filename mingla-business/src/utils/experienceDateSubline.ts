/**
 * formatExperienceDateSubline — META-ORCH-1059 Sub-B.
 *
 * The ONE owner of how an experience's date model is rendered as a one-line
 * subline, used by the dashboard hero, the hub list rows, and (later) the
 * public page + MiniCard. Expresses the three date modes the wizard produces:
 *
 *   one-time   → "{venue} · Sat 14 Jun · 7:00 PM"
 *   recurring  → "{venue} · Every Friday · Next: Fri 20 Jun"
 *   multi-date → "{venue} · 5 dates · Next: Sat 14 Jun"
 *
 * If all dates are in the past → "{venue} · Ended".
 * A draft (no dates yet) → just "{venue}" (or "Draft" when no venue either).
 *
 * Pure + deterministic given a `nowMs` injection point (defaults to Date.now()).
 */

import { formatRecurrenceLabel } from "./recurrenceRule";
import type { RecurrenceRule } from "../store/draftEventStore";

export type ExperienceWhenMode = "single" | "recurring" | "multi_date";

export interface ExperienceDateSublineInput {
  /** Resolved venue / first-stop address text (may be empty). */
  venueText: string | null;
  /** ISO start_at strings for every materialised event_dates row. */
  dateStartIsos: string[];
  /** 'single' | 'recurring' | 'multi_date' (derived from events row flags). */
  whenMode: ExperienceWhenMode;
  /** Recurrence rule (recurring mode only); null otherwise. */
  recurrenceRule: RecurrenceRule | null;
}

function formatDayLine(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatTimeLine(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })
    .toUpperCase();
}

/** Earliest future start, or null when none remain. */
function nextOccurrenceIso(isos: string[], nowMs: number): string | null {
  const futures = isos
    .map((iso) => ({ iso, ms: new Date(iso).getTime() }))
    .filter((x) => Number.isFinite(x.ms) && x.ms > nowMs)
    .sort((a, b) => a.ms - b.ms);
  return futures.length > 0 ? futures[0].iso : null;
}

/** Earliest of all dates (past or future). */
function earliestIso(isos: string[]): string | null {
  const all = isos
    .map((iso) => ({ iso, ms: new Date(iso).getTime() }))
    .filter((x) => Number.isFinite(x.ms))
    .sort((a, b) => a.ms - b.ms);
  return all.length > 0 ? all[0].iso : null;
}

export function formatExperienceDateSubline(
  input: ExperienceDateSublineInput,
  nowMs: number = Date.now(),
): string {
  const venue = (input.venueText ?? "").trim();
  const validIsos = input.dateStartIsos.filter(
    (iso) => Number.isFinite(new Date(iso).getTime()),
  );

  // Draft / no dates materialised yet.
  if (validIsos.length === 0) {
    return venue.length > 0 ? venue : "Draft";
  }

  const next = nextOccurrenceIso(validIsos, nowMs);
  const head = venue.length > 0 ? `${venue} · ` : "";

  // All dates past → Ended.
  if (next === null) {
    return `${head}Ended`.trim();
  }

  if (input.whenMode === "single") {
    const earliest = earliestIso(validIsos) ?? validIsos[0];
    const day = formatDayLine(earliest);
    const time = formatTimeLine(earliest);
    const body = time.length > 0 ? `${day} · ${time}` : day;
    return `${head}${body}`.trim();
  }

  if (input.whenMode === "recurring") {
    const label =
      input.recurrenceRule !== null
        ? formatRecurrenceLabel(input.recurrenceRule, validIsos[0])
        : "Recurring";
    return `${head}${label} · Next: ${formatDayLine(next)}`.trim();
  }

  // multi_date
  const n = validIsos.length;
  return `${head}${n} ${n === 1 ? "date" : "dates"} · Next: ${formatDayLine(next)}`.trim();
}
