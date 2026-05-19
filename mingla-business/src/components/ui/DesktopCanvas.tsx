/**
 * DesktopCanvas — ORCH-0885-A Tier 1 ambient gradient canvas + max-width
 * content column for the desktop web surface (viewport width ≥ 1024px).
 *
 * # What it does
 * - On `isWideDesktop === false` → renders `<>{children}</>` (passthrough
 *   Fragment, zero layout cost on mobile / narrow web).
 * - On `isWideDesktop === true` → paints the Tier-1 ambient gradient
 *   (#0c0e12 base + 3 soft radial washes per `01-tier1-container-rail.html`
 *   `.canvas-bg`) and centres the children inside a desktop-width column
 *   with horizontal padding.
 *
 * # Gradient stack (SPEC §7, values verbatim from mock 01 `.canvas-bg`)
 * Base: solid `#0c0e12`. On top of that, three CSS `radial-gradient(...)`
 * layers applied via web-only `backgroundImage` (this branch only renders
 * when `Platform.OS === "web"` — guaranteed DOM context):
 *   - 80% × 50% at (50%, 0%) — `rgba(235,120,37,0.08)` accent-warm top centre
 *   - 60% × 60% at (10%, 100%) — `rgba(120,80,200,0.06)` indigo bottom-left
 *   - 60% × 60% at (90%, 100%) — `rgba(50,180,200,0.05)` cyan bottom-right
 *
 * The rework (ORCH-0885-A rework, 2026-05-19) swapped from
 * `react-native-svg` `<RadialGradient gradientUnits="objectBoundingBox">`
 * to CSS `background-image: radial-gradient(...)` because the SVG approach
 * rendered invisibly on RN-web Chrome at 1440 (objectBoundingBox unit
 * handling on RN-web is unreliable). CSS gradients are the same renderer
 * the brainstorm mock uses, so visual parity is guaranteed.
 *
 * All colours are hex / rgba only — per I-RN-COLOR-FORMATS
 * (`feedback_rn_color_formats.md`). No `oklch`, `lab`, `lch`, `color-mix`.
 *
 * # Why a separate component (not inline in `(tabs)/_layout.tsx`)
 * - Keeps `_layout.tsx` small + readable.
 * - The desktop branch becomes unit-testable in isolation.
 * - Future routes outside `(tabs)/` can mount the canvas directly.
 *
 * # Invariants honoured
 * - I-DESKTOP-GATE-VIA-HOOK — gates exclusively via `useResponsiveLayout()`.
 * - I-RN-COLOR-FORMATS — every colour is hex or rgba (CSS rgba inside the
 *   gradient string also resolves to rgba — no oklch/lab/lch/color-mix).
 * - I-CROSS-SURFACE-IMPACT — guarded behind `isWideDesktop`; native is a
 *   Fragment passthrough (no extra `<View>`, no gradient layer). The
 *   web-only `backgroundImage` style key is unreachable on native because
 *   `isWideDesktop` requires `Platform.OS === "web"`.
 *
 * Per SPEC_ORCH-0885-A §3.
 */

import React from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";

import {
  DESKTOP_CONTENT_MAX_WIDTH,
  DESKTOP_CONTENT_PADDING_X,
} from "../../constants/desktopLayout";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";

export interface DesktopCanvasProps {
  children: React.ReactNode;
  /** Max content-column width on desktop. Default 1184. */
  maxWidth?: number;
}

/**
 * Canvas base solid fill — `--canvas` in mock 01 line 9. Hex only.
 */
export const CANVAS_BASE_COLOR = "#0c0e12";

export { DESKTOP_CONTENT_MAX_WIDTH, DESKTOP_CONTENT_PADDING_X };

/**
 * Three CSS `radial-gradient(...)` declarations, comma-separated, sourced
 * VERBATIM from `Mingla_Artifacts/design/desktop-redesign/01-tier1-container-rail.html`
 * `.canvas-bg` rule (lines 28–35). The browser's native CSS engine paints
 * these additively over the `#0c0e12` `backgroundColor` base — same
 * renderer + same syntax as the mock, so visual parity is exact.
 *
 * Layered top-to-bottom (first declaration paints on top):
 *   1. Warm accent wash from top-centre (rgba(235,120,37,0.08))
 *   2. Indigo wash from bottom-left   (rgba(120,80,200,0.06))
 *   3. Cyan wash from bottom-right    (rgba( 50,180,200,0.05))
 *
 * All colours are rgba — I-RN-COLOR-FORMATS compliant.
 */
const CANVAS_GRADIENT_BACKGROUND_IMAGE = [
  "radial-gradient(80% 50% at 50% 0%, rgba(235, 120, 37, 0.08) 0%, transparent 60%)",
  "radial-gradient(60% 60% at 10% 100%, rgba(120, 80, 200, 0.06) 0%, transparent 50%)",
  "radial-gradient(60% 60% at 90% 100%, rgba(50, 180, 200, 0.05) 0%, transparent 50%)",
].join(", ");

/**
 * Web-only `backgroundImage` style. The wide-desktop branch only runs
 * when `Platform.OS === "web"` (the `isWideDesktop` gate requires it),
 * so this never reaches the native StyleSheet validator. We still guard
 * on `Platform.OS === "web"` for defence in depth + to keep the type
 * cast honest. The cast to `ViewStyle` is required because
 * `backgroundImage` is not in the RN core `ViewStyle` type — it's a
 * react-native-web extension.
 */
const gradientBackgroundStyle: ViewStyle =
  Platform.OS === "web"
    ? ({ backgroundImage: CANVAS_GRADIENT_BACKGROUND_IMAGE } as ViewStyle)
    : ({} as ViewStyle);

export const DesktopCanvas: React.FC<DesktopCanvasProps> = ({
  children,
  maxWidth = DESKTOP_CONTENT_MAX_WIDTH,
}) => {
  // Hook is called unconditionally at the top of render — branch on the
  // returned boolean, not on whether the hook ran. Per SPEC §3.
  const { isWideDesktop } = useResponsiveLayout();

  if (!isWideDesktop) {
    return <>{children}</>;
  }

  // The canvas is a flex column whose ONLY job is to centre its child
  // horizontally and let it stretch vertically. We use `alignItems: "center"`
  // on the parent (cross-axis centring in a column-flex parent) instead of
  // `alignSelf: "center" + width: "100%"` on the child — the latter is a
  // known RN-web footgun where `width:"100%"` forces the item to take all
  // cross-axis space and `alignSelf` becomes a no-op, leaving the column
  // left-aligned against the rail. See ORCH-0885-A rework BUG 1.
  //
  // The `backgroundImage` (CSS radial-gradients) sits on the canvas View
  // itself — no separate layer, no SVG, no react-native-svg dependency.
  return (
    <View style={[styles.canvas, gradientBackgroundStyle]}>
      <View style={[styles.column, { maxWidth }]}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    backgroundColor: CANVAS_BASE_COLOR,
    // `alignItems: "center"` is what actually centres the content column
    // horizontally inside the canvas. The column has `width: "100%"`
    // (clamped by `maxWidth`) and grows vertically via `flex: 1`.
    alignItems: "center",
    position: "relative",
  },
  column: {
    flex: 1,
    width: "100%",
    paddingHorizontal: DESKTOP_CONTENT_PADDING_X,
  },
});

export default DesktopCanvas;
