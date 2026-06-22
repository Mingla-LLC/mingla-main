/**
 * sheetSnapHeight — single owner of the bottom-sheet panel-height math
 * shared by BOTH the native (`Sheet`/`SheetMobile`) and web (`SheetWeb`)
 * variants in `SheetMobile.tsx`.
 *
 * Pure (no React / React Native / Reanimated imports) so it is unit-testable
 * under `mingla-business/jest.config.cjs` (`testEnvironment: "node"`).
 *
 * Numeric snapPoint semantics (ORCH-1206):
 *   - `0 < n <= 1`  → RATIO of screen height (e.g. `0.9` = 90% of screen).
 *   - `n > 1`       → ABSOLUTE PIXELS, clamped to [MIN_SNAP_PX, MAX_SNAP_RATIO * screen].
 *   - string preset → `SNAP_RATIOS[preset] * screen`.
 *
 * Before ORCH-1206 a fractional numeric (e.g. `0.9`) was clamped UP to
 * MIN_SNAP_PX = 120 px, collapsing the panel and clipping its form/CTA.
 */

export type SheetSnapPoint = "peek" | "half" | "full";
export type SheetSnapValue = SheetSnapPoint | number;

export const SNAP_RATIOS: Record<SheetSnapPoint, number> = {
  peek: 0.25,
  half: 0.5,
  full: 0.9,
};

export const MIN_SNAP_PX = 120;
export const MAX_SNAP_RATIO = 0.95;

/**
 * Resolve the rendered panel height (px) for a snapPoint at a given screen
 * height. Always capped at `MAX_SNAP_RATIO * screenHeight`.
 */
export function computeSheetHeight(
  snapPoint: SheetSnapValue,
  screenHeight: number,
): number {
  const requested =
    typeof snapPoint === "number"
      ? snapPoint > 0 && snapPoint <= 1
        ? screenHeight * snapPoint
        : Math.min(
            Math.max(snapPoint, MIN_SNAP_PX),
            screenHeight * MAX_SNAP_RATIO,
          )
      : screenHeight * SNAP_RATIOS[snapPoint];

  return Math.min(requested, screenHeight * MAX_SNAP_RATIO);
}
