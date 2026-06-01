import type { SubStep } from '../../types/onboarding'

// [ORCH-1028 REWORK F-1/F-2] Responsive scroll-enablement policy for OnboardingShell.
//
// The onboarding shell renders a fixed bottom CTA bar over a ScrollView. Several
// steps are intentionally non-scrollable so their content sits fit-at-a-glance and
// centered: `welcome`, `celebration`, `collaborations`, `categories` (which auto-fits
// its grid), plus — on tall screens — `gender_identity` and `intents`.
//
// On the smallest in-matrix device (iPhone SE 3, 667pt) the `gender_identity` step
// (8 options) and `intents` step (6 cards with subtitles) overflow the viewport, so
// with scroll disabled the last option / subtitle clips behind the fixed bottom bar
// and becomes unreachable (QA ORCH-1028 F-1 P2 / F-2 P3). We therefore re-enable
// scroll for THOSE TWO steps only when the viewport is too short to fit them.
//
// On iPhone 12-mini-and-up (>=740pt) and Android targets the content already fits,
// so `isShortViewport` is false and these steps stay non-scrollable exactly as before
// — a pure no-op on larger screens (no visual regression).

// Steps that are ALWAYS non-scrollable regardless of viewport height.
const ALWAYS_FIXED_SUBSTEPS: ReadonlySet<SubStep> = new Set<SubStep>([
  'welcome',
  'celebration',
  'collaborations',
  'categories',
])

// Steps that are non-scrollable on tall screens but MUST become scrollable on short
// viewports so their full option list / subtitles clear the fixed bottom bar.
const FIXED_ON_TALL_ONLY_SUBSTEPS: ReadonlySet<SubStep> = new Set<SubStep>([
  'gender_identity',
  'intents',
])

/**
 * Resolve whether OnboardingShell's ScrollView should be scroll-enabled for the
 * current substep, given whether the viewport is too short for fit-at-a-glance steps.
 *
 * - Always-fixed steps return `false` (never scroll).
 * - `gender_identity` / `intents` return `false` on tall screens (fit, centered) but
 *   `true` on short viewports (content overflows → must scroll to reach all options).
 * - Every other step returns `true` (scrollable by default).
 */
export function resolveScrollEnabled(subStep: SubStep, isShortViewport: boolean): boolean {
  if (ALWAYS_FIXED_SUBSTEPS.has(subStep)) return false
  if (FIXED_ON_TALL_ONLY_SUBSTEPS.has(subStep)) return isShortViewport
  return true
}
