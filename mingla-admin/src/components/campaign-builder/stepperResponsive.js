/**
 * ISSUE-980 [Campaign Builder clarity] — Stepper responsive density.
 *
 * Root cause (ISSUE-977 Lane A F-6, live in the codebase): the 10-step
 * stepper needs roughly 1,070-1,100px at full size, but common laptop
 * viewports don't have that much room once the sidebar (--sidebar-width:
 * 260px, globals.css) and AppShell's `px-16` (128px total, AppShell.jsx) are
 * subtracted — a 1366x768 laptop leaves ~978px, a 1440x900 laptop leaves
 * ~1052px. Below that, the container's `overflow-x-auto` silently kicks in
 * and steps toward the end ("Policy check", "Review") sit off-screen at
 * first paint — "crammed at the top" (Seth, issue #977 finding #1).
 *
 * Fix: below COMPACT_BREAKPOINT_PX, Stepper renders in "compact" density —
 * tighter pill padding, a narrower connector, a smaller step-number chip,
 * and abbreviated labels for the two longest steps ("Channel health" →
 * "Health", "Policy check" → "Policy" — every other label is already short).
 * That drops the required width comfortably under what 1366-1440px laptops
 * have. Above the breakpoint the roomier "full" density renders (unchanged
 * from before this fix). `overflow-x-auto` stays on the container as a
 * last-resort safety net (e.g. a manually narrowed browser window), but
 * compaction means it should never be needed at ordinary laptop widths.
 */

// Tailwind's own `2xl` value — the first width where even the WORST-case
// 1440px-laptop math (1052px available < ~1070-1100px full requirement) is
// comfortably behind us (at 1536px: 1536 - 260 - 128 = 1148px available).
export const COMPACT_BREAKPOINT_PX = 1536;

/**
 * @param {number} viewportWidthPx
 * @returns {boolean} true when the stepper should render in compact density.
 *   An unknown/non-numeric width (e.g. before the first client-side
 *   measurement) fails toward the SAFER density — compact never overflows;
 *   full might.
 */
export function isCompactStepper(viewportWidthPx) {
  if (typeof viewportWidthPx !== "number" || Number.isNaN(viewportWidthPx)) return true;
  return viewportWidthPx < COMPACT_BREAKPOINT_PX;
}

/** The only two step labels long enough to matter for the overflow math. */
const SHORT_LABELS = {
  preflight: "Health",
  policy: "Policy",
};

/**
 * @param {{id: string, label: string}} step
 * @param {{compact: boolean}} density
 * @returns {string} the label to render — abbreviated only in compact
 *   density, and only for the two steps that have a shorter alternative.
 */
export function stepLabel(step, { compact }) {
  if (!compact) return step.label;
  return SHORT_LABELS[step.id] ?? step.label;
}
