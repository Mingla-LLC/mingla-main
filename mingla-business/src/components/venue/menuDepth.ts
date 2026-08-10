/**
 * Issue #1789 (#1767 Phase 1) — pure menu-depth logic (SPEC #1788 P-11, P-12).
 *
 * The rules the DATABASE enforces, mirrored on the client so an operator gets a
 * sentence instead of a 400. The database remains the authority: every function
 * here is a courtesy, never a substitute for the CHECK it mirrors.
 *
 * No React, no react-native, no network — provable under the default
 * node/ts-jest config.
 */

export type ModifierSelectionMode = "single" | "multi";

export interface ModifierGroupDraft {
  name: string;
  selectionMode: ModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
  optionCount: number;
}

/**
 * Mirrors `menu_modifier_groups_select_shape` + the name CHECK. Returns the
 * operator-facing sentence, or null when the draft is savable.
 */
export function validateModifierGroup(
  draft: ModifierGroupDraft,
): string | null {
  const name = draft.name.trim();
  if (name.length === 0) return "Give this group a name.";
  if (name.length > 80) return "That name is too long.";
  if (draft.optionCount === 0) return "Add at least one option.";
  if (draft.minSelect < 0 || draft.minSelect > 20) {
    return "The minimum must be between 0 and 20.";
  }
  if (
    draft.maxSelect !== null &&
    (draft.maxSelect < 1 || draft.maxSelect > 20)
  ) {
    return "The maximum must be between 1 and 20.";
  }
  if (draft.selectionMode === "single") {
    if (draft.minSelect > 1) return "A single choice can ask for at most one.";
    if (draft.maxSelect !== null && draft.maxSelect !== 1) {
      return "A single choice allows exactly one option.";
    }
    return null;
  }
  if (draft.maxSelect !== null && draft.maxSelect < draft.minSelect) {
    return "The maximum cannot be lower than the minimum.";
  }
  if (draft.minSelect > draft.optionCount) {
    return "You are asking for more choices than there are options.";
  }
  return null;
}

/** The one-line summary shown on the group row in the builder. */
export function modifierGroupSummary(group: {
  selectionMode: ModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
  optionCount: number;
}): string {
  const options = `${group.optionCount} ${group.optionCount === 1 ? "option" : "options"}`;
  if (group.selectionMode === "single") {
    return group.minSelect >= 1
      ? `Pick one · required · ${options}`
      : `Pick one · optional · ${options}`;
  }
  if (group.maxSelect !== null) {
    return group.minSelect > 0
      ? `Pick ${group.minSelect}–${group.maxSelect} · ${options}`
      : `Pick up to ${group.maxSelect} · ${options}`;
  }
  return group.minSelect > 0
    ? `Pick at least ${group.minSelect} · ${options}`
    : `Pick any · ${options}`;
}

// ---------------------------------------------------------------------------
// Service windows (P-12). Stored as `time` + an ISO day array; ALWAYS evaluated
// in venue-local time SERVER-SIDE. Nothing here decides whether a menu is open
// — it only formats and validates what the operator typed.
// ---------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "7:5" → null; "07:05" → "07:05"; "07:05:00" → "07:05". */
export function normalizeTimeInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const hhmm = trimmed.length > 5 ? trimmed.slice(0, 5) : trimmed;
  return TIME_RE.test(hhmm) ? hhmm : null;
}

export const DAY_LABELS: readonly string[] = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];

/** ISO day 1..7 → "Mon".."Sun". */
export function dayLabel(isoDay: number): string {
  return DAY_LABELS[isoDay - 1] ?? String(isoDay);
}

export interface ServiceWindowDraft {
  start: string | null;
  end: string | null;
  days: number[] | null;
}

/** Mirrors `menus_service_window_shape` + `menus_service_days_shape`. */
export function validateServiceWindow(draft: ServiceWindowDraft): string | null {
  const hasStart = draft.start !== null && draft.start.length > 0;
  const hasEnd = draft.end !== null && draft.end.length > 0;
  if (hasStart !== hasEnd) {
    return "Set both a start and an end time, or leave both blank.";
  }
  if (hasStart && normalizeTimeInput(draft.start as string) === null) {
    return "Start time must look like 07:00.";
  }
  if (hasEnd && normalizeTimeInput(draft.end as string) === null) {
    return "End time must look like 11:00.";
  }
  if (draft.days !== null) {
    if (draft.days.length === 0) {
      return "Pick at least one day, or leave every day selected.";
    }
    if (draft.days.some((d) => d < 1 || d > 7)) return "Unknown day.";
  }
  return null;
}

/**
 * The human sentence under a category. Says "Wraps past midnight" out loud,
 * because a late-night menu whose end is before its start is the exact case a
 * naive reader gets wrong.
 */
export function serviceWindowSummary(draft: ServiceWindowDraft): string {
  const start = draft.start === null ? null : normalizeTimeInput(draft.start);
  const end = draft.end === null ? null : normalizeTimeInput(draft.end);
  if (start === null || end === null) {
    return draft.days === null || draft.days.length === 7
      ? "Available all day, every day"
      : `Available all day on ${draft.days.map(dayLabel).join(", ")}`;
  }
  const wraps = end < start;
  const days =
    draft.days === null || draft.days.length === 7
      ? "every day"
      : draft.days.map(dayLabel).join(", ");
  return wraps
    ? `${start}–${end} (wraps past midnight) · ${days}`
    : `${start}–${end} · ${days}`;
}
