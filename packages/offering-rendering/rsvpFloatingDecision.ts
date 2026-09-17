/**
 * rsvpFloatingDecision — when the phone's floating Going / Maybe / Can't go bar
 * may show. Pure and dependency-free.
 *
 * WHY: the public RSVP page rendered the decision twice at once — inline under
 * the "N going" card AND as a floating copy pinned to the bottom of the screen —
 * so both rows were visible together, and on first load the floating copy sat
 * on top of the date card and the vibe chips. The floating bar is now a
 * shortcut back to a decision the guest has scrolled PAST:
 *
 *   inline row on screen            → no bar (never two copies at once)
 *   inline row above the viewport    → bar (the guest scrolled past it)
 *   inline row not reached yet       → no bar on a fresh page, so nothing covers
 *                                      the date card, the chips or the form; the
 *                                      exception is right after a blocked Going /
 *                                      Maybe tap scrolled the guest UP to a field,
 *                                      when the bar carries the "add your name…"
 *                                      hint beside the control they tapped.
 */

export type RsvpInlineDecisionPosition = "above" | "visible" | "below" | "unmeasured";

export interface RsvpWindowRect {
  /** Top edge in window coordinates. */
  y: number;
  height: number;
}

/**
 * True when at least half of the inline decision row (or 48px of it, whichever
 * is smaller) is inside the visible scroll viewport. An unmeasured row (height
 * 0) counts as NOT visible so the guest always has a way to reply.
 */
export const isInlineRsvpDecisionVisible = (
  row: RsvpWindowRect | null,
  viewport: RsvpWindowRect | null,
): boolean => rsvpInlineDecisionPosition(row, viewport) === "visible";

/** Where the inline decision row is relative to the visible scroll viewport. */
export const rsvpInlineDecisionPosition = (
  row: RsvpWindowRect | null,
  viewport: RsvpWindowRect | null,
): RsvpInlineDecisionPosition => {
  if (row === null || viewport === null) return "unmeasured";
  if (!(row.height > 0) || !(viewport.height > 0)) return "unmeasured";
  const top = Math.max(row.y, viewport.y);
  const bottom = Math.min(row.y + row.height, viewport.y + viewport.height);
  if (bottom - top >= Math.min(row.height / 2, 48)) return "visible";
  const rowCenter = row.y + row.height / 2;
  return rowCenter < viewport.y + viewport.height / 2 ? "above" : "below";
};

export interface RsvpFloatingBarVisibilityInput {
  /** Phone layout (desktop hosts the decision in its sticky panel instead). */
  isPhoneLayout: boolean;
  /** The event can still take replies (not ended / cancelled / unavailable). */
  acquisitionOpen: boolean;
  inlineDecisionPosition: RsvpInlineDecisionPosition;
  /** A Going / Maybe / Can't go tap was blocked by missing details. */
  decisionAttempted: boolean;
}

export const shouldShowRsvpFloatingBar = (
  input: RsvpFloatingBarVisibilityInput,
): boolean => {
  if (!input.isPhoneLayout || !input.acquisitionOpen) return false;
  switch (input.inlineDecisionPosition) {
    case "visible":
      return false;
    case "above":
      return true;
    default:
      return input.decisionAttempted;
  }
};

/**
 * The scroll offset that puts a field about a quarter of the way down the
 * viewport (clear of the top chrome and of the software keyboard), given both
 * rects in window coordinates and the current scroll offset.
 */
export const rsvpRevealScrollOffset = (
  field: RsvpWindowRect,
  viewport: RsvpWindowRect,
  currentScrollY: number,
): number => {
  const target = currentScrollY + (field.y - viewport.y) - viewport.height * 0.25;
  return Math.max(0, Math.round(target));
};
