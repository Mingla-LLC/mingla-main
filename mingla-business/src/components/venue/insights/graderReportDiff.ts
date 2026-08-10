/**
 * Issue #1735 G-12 — deterministic competitor "what changed" chips
 * (I-PROPOSED-1735-COMPETITOR-DIFF-DETERMINISTIC, DRAFT — flips ACTIVE at
 * CLOSE).
 *
 * PURE client function over the two newest PERSISTED reports (P-43
 * `include_previous`; P-49: the backend guarantees shape stability per
 * `meta.schema_version`, same-subject input consistency, and dated ordering —
 * NOTHING more). The diffed field list is BINDING and COMPLETE:
 *
 *   1. `scores.grade`   — chip "Grade {old} → {new}" when the strings differ.
 *   2. `scores.overall` — appended to the grade chip as "({±n})" when both
 *                         are finite numbers; NEVER its own chip.
 *   3. `site_signals.checks[]` STATUS FLIPS — matched by `key` over the 11
 *      deterministic keys; keys present in only one report are SKIPPED
 *      (never inferred).
 *
 * EXCLUDED, deliberately: the 5 sub-scores (model-generated — diffing them
 * fabricates precision), fixes / competition / hero (prose). Adding any of
 * those flips T-G7 red (the invariant's regression anchor).
 *
 * Guards: both reports' `meta.schema_version` (absent ⇒ 1) must be EQUAL,
 * else degrade to the grade chip only (P-11/P-49); either report with
 * `meta.fetch_failed === true` or empty `checks` ⇒ grade-only + the honest
 * unreadable line. Chip order: grade first, then signal chips in the LATEST
 * report's checks-array declaration order. Cap 6 chips + "+{n} more in the
 * report".
 */

import type { GraderReport } from "../../../services/growthToolsService";

/** The 11 deterministic site-signal keys (verified vs the DEPLOYED engine). */
export const GRADER_SIGNAL_KEYS = [
  "https",
  "title_tag",
  "meta_description",
  "mobile_viewport",
  "social_preview",
  "structured_data",
  "menu_reachable",
  "booking_or_order",
  "phone_clickable",
  "prices_visible",
  "social_links",
] as const;

export const DIFF_CHIP_CAP = 6;

export interface GraderDiffChip {
  kind: "grade" | "signal";
  /** Verbatim chip copy, generated from the diff table (design §1.3). */
  label: string;
}

export interface GraderReportDiffInput {
  report: GraderReport;
  /** The run row's created_at — the chips' dated footer. */
  createdAt: string;
}

export interface GraderReportDiff {
  /** Capped at DIFF_CHIP_CAP, grade chip first. */
  chips: GraderDiffChip[];
  /** Signal chips beyond the cap — "+{n} more in the report". */
  overflowCount: number;
  /** ISO created_at pair for the footer "{prev:date} → {latest:date}". */
  prevCreatedAt: string;
  latestCreatedAt: string;
  /** Cross-version pairs degrade to grade-only (P-11/P-49). */
  degradedToGradeOnly: boolean;
  /**
   * Non-null when either report was unreadable (`meta.fetch_failed` or empty
   * checks): the honest line "Their site couldn't be read on {date}." —
   * carries the unreadable run's ISO date.
   */
  unreadableOnIso: string | null;
}

const VALID_STATUSES = new Set(["pass", "warn", "fail"]);

function schemaVersionOf(report: GraderReport): number {
  const v = report.meta?.schema_version;
  // P-11: absence ⇒ legacy row ⇒ version 1.
  return typeof v === "number" && Number.isFinite(v) ? v : 1;
}

function checksOf(report: GraderReport): { key: string; label: string; status: string }[] {
  const checks = report.site_signals?.checks;
  if (!Array.isArray(checks)) return [];
  const out: { key: string; label: string; status: string }[] = [];
  for (const c of checks) {
    if (
      c !== null &&
      typeof c === "object" &&
      typeof c.key === "string" &&
      typeof c.status === "string" &&
      VALID_STATUSES.has(c.status)
    ) {
      out.push({
        key: c.key,
        label: typeof c.label === "string" && c.label.trim().length > 0
          ? c.label.trim()
          : c.key,
        status: c.status,
      });
    }
  }
  return out;
}

function unreadable(report: GraderReport): boolean {
  if (report.meta?.fetch_failed === true) return true;
  return checksOf(report).length === 0;
}

function gradeChipOrNull(
  prev: GraderReport,
  latest: GraderReport,
): GraderDiffChip | null {
  const oldGrade = typeof prev.scores?.grade === "string"
    ? prev.scores.grade.trim()
    : "";
  const newGrade = typeof latest.scores?.grade === "string"
    ? latest.scores.grade.trim()
    : "";
  if (oldGrade.length === 0 || newGrade.length === 0) return null;
  if (oldGrade === newGrade) return null;
  const oldOverall = prev.scores?.overall;
  const newOverall = latest.scores?.overall;
  let suffix = "";
  if (
    typeof oldOverall === "number" &&
    Number.isFinite(oldOverall) &&
    typeof newOverall === "number" &&
    Number.isFinite(newOverall)
  ) {
    const delta = Math.round(newOverall - oldOverall);
    suffix = ` (${delta >= 0 ? "+" : "−"}${Math.abs(delta)})`;
  }
  return { kind: "grade", label: `Grade ${oldGrade} → ${newGrade}${suffix}` };
}

/**
 * The single diff implementation (invariant: no second one may exist). NO
 * fabricated narrative — every chip is a mechanical field comparison.
 */
export function diffGraderReports(
  prev: GraderReportDiffInput,
  latest: GraderReportDiffInput,
): GraderReportDiff {
  const base: Omit<
    GraderReportDiff,
    "chips" | "overflowCount" | "degradedToGradeOnly" | "unreadableOnIso"
  > = {
    prevCreatedAt: prev.createdAt,
    latestCreatedAt: latest.createdAt,
  };

  const gradeChip = gradeChipOrNull(prev.report, latest.report);
  const gradeOnlyChips = gradeChip !== null ? [gradeChip] : [];

  // Guard 1 — fetch-failed / empty checks on EITHER side ⇒ grade-only + the
  // honest line naming the unreadable run's date.
  if (unreadable(latest.report) || unreadable(prev.report)) {
    const unreadableOnIso = unreadable(latest.report)
      ? latest.createdAt
      : prev.createdAt;
    return {
      ...base,
      chips: gradeOnlyChips,
      overflowCount: 0,
      degradedToGradeOnly: true,
      unreadableOnIso,
    };
  }

  // Guard 2 — cross-schema_version pairs degrade to grade-only (P-11/P-49).
  if (schemaVersionOf(prev.report) !== schemaVersionOf(latest.report)) {
    return {
      ...base,
      chips: gradeOnlyChips,
      overflowCount: 0,
      degradedToGradeOnly: true,
      unreadableOnIso: null,
    };
  }

  // Signal flips — matched by key over the 11 deterministic keys, in the
  // LATEST report's declaration order. Keys on only one side are SKIPPED.
  const prevByKey = new Map(checksOf(prev.report).map((c) => [c.key, c]));
  const signalChips: GraderDiffChip[] = [];
  for (const latestCheck of checksOf(latest.report)) {
    if (!(GRADER_SIGNAL_KEYS as readonly string[]).includes(latestCheck.key)) {
      continue;
    }
    const prevCheck = prevByKey.get(latestCheck.key);
    if (prevCheck === undefined) continue; // present on one side only — skip.
    if (prevCheck.status === latestCheck.status) continue;
    signalChips.push({
      kind: "signal",
      label: `${latestCheck.label}: ${prevCheck.status} → ${latestCheck.status}`,
    });
  }

  const allChips = [...gradeOnlyChips, ...signalChips];
  const chips = allChips.slice(0, DIFF_CHIP_CAP);
  return {
    ...base,
    chips,
    overflowCount: Math.max(0, allChips.length - DIFF_CHIP_CAP),
    degradedToGradeOnly: false,
    unreadableOnIso: null,
  };
}
