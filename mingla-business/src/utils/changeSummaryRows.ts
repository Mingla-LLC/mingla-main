/**
 * issue #3827 — the rows the "Review changes" sheet actually shows.
 *
 * Pure (no React, no RN) so it is unit-testable and shared by every editor
 * that opens ChangeSummaryModal (live event, live RSVP, live trip).
 *
 *   1. A host never reads raw data. A value that is serialized JSON (an object
 *      or a list, whole or truncated) is replaced by a one-word summary, so a
 *      future field that falls through a formatter still cannot paint
 *      `{"lng":-73.96,"lat":40.71}`.
 *   2. When the address changed, the map pin moving with it is the same
 *      change: the "Map pin" row is dropped and the address row says it.
 */

// No imports: liveEventAdapter imports DIFF_CHANGED_SUMMARY from here, and the
// trip editor opens this sheet too without needing the live-event adapter.

/** The part of a Review changes row this guard reads (FieldDiff fits it). */
export interface ChangeSummaryRow {
  fieldKey: string;
  oldValue: string;
  newValue: string;
  summary?: string;
}

/** The one-word row for a value that is not readable text. */
export const DIFF_CHANGED_SUMMARY = "Changed";

/** The diff key of the map pin row (live events and RSVPs). */
const MAP_PIN_KEY = "locationGeo";
/** The address row that already describes a pin move. */
const ADDRESS_KEY = "address";

/**
 * True when `value` is serialized data rather than words: it parses as a JSON
 * object or array, or it is one cut short (the diff formatter truncates long
 * values with "…", which no longer parses). Plain text that merely starts with
 * a bracket ("[Updated] Rooftop night") is left alone.
 */
export const looksLikeSerializedData = (value: string): boolean => {
  const text = value.trim();
  if (text.length === 0) return false;
  const first = text[0];
  if (first !== "{" && first !== "[") return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object";
  } catch {
    // Not complete JSON: data only if it opens like data does.
    return /^(\{\s*("|\})|\[\s*("|\{|\[|\]|-?\d|true\b|false\b|null\b))/.test(text);
  }
};

/** The rows to render, in order. Never mutates `diffs`. */
export const changeSummaryRows = <Row extends ChangeSummaryRow>(
  diffs: readonly Row[],
): Row[] => {
  const addressChanged = diffs.some((diff) => diff.fieldKey === ADDRESS_KEY);
  return diffs
    .filter((diff) => !(addressChanged && diff.fieldKey === MAP_PIN_KEY))
    .map((diff) => {
      if (diff.summary !== undefined && diff.summary.length > 0) return diff;
      if (
        looksLikeSerializedData(diff.oldValue) ||
        looksLikeSerializedData(diff.newValue)
      ) {
        return { ...diff, summary: DIFF_CHANGED_SUMMARY };
      }
      return diff;
    });
};
