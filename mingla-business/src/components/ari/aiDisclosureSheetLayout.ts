/**
 * ORCH-1246 (Apple 2.1a) — pure layout math for the "Meet Ari" disclosure sheet.
 *
 * The disclosure's ONLY dismiss path is the "Got it — let's start" CTA in the
 * footer. On a tall iPad viewport the bottom-anchored sheet (maxHeight "88%")
 * stretches and can push the footer CTA off-screen / under the home-indicator.
 * SHEET_MAX_HEIGHT is a hard POINT cap; the effective height is the SMALLER of
 * 88% of the viewport and that cap, so the footer (and CTA) always stays in view.
 *
 * Kept in its own dependency-free module so it is unit-testable without the RN
 * runtime (the component .tsx imports react-native, which jest's default project
 * does not transform).
 */
export const SHEET_MAX_HEIGHT = 640;

export function resolveSheetMaxHeight(windowHeight: number): number {
  return Math.min(windowHeight * 0.88, SHEET_MAX_HEIGHT);
}
