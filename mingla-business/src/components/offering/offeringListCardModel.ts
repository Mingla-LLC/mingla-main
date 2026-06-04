/**
 * offeringListCardModel — META-ORCH-1059 Pass 1.
 *
 * Pure (no-JSX) type layer for the shared OfferingListCard, so the per-kind
 * model mappers (offeringCardModels.ts) and tests can import the normalized
 * card shape without pulling in React Native.
 */

export type OfferingCardStatus =
  | "live"
  | "upcoming"
  | "draft"
  | "past"
  | "cancelled";

export interface OfferingListCardModel {
  /** Stable id (drives cover hue fallback + accessibility). */
  id: string;
  /** Display title; the card renders an "Untitled …" fallback when blank. */
  title: string;
  /** Normalized lifecycle status. */
  status: OfferingCardStatus;
  /** One-line date · venue/destination subline. */
  subline: string;
  /** Cover media URL (null → deterministic hue gradient). */
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  /** Deterministic hue (0–359) when no cover media is set. */
  coverHue: number;
  /**
   * Pre-formatted per-kind headcount metric ("3 travelers", "12 spots sold").
   * Null when the count is not available for this row (e.g. drafts).
   */
  metricLabel: string | null;
  /** Pre-formatted money/revenue label ("$1,240"). Null hides the strip. */
  revenueLabel: string | null;
  /**
   * Optional capacity progress (0–100). When provided AND status is not draft,
   * the card shows the events-style progress bar instead of the metric subtext.
   */
  capacityPct: number | null;
}
