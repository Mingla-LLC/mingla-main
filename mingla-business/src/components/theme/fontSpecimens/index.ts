import type { TextStyle } from "react-native";

import { THEME_FONT_SLUGS } from "../../../../../packages/offering-rendering/designTokens";

/**
 * #1022 — font specimens for the Theme sheet's font tab.
 *
 * THE HARD CONSTRAINT (ORCH-1083): browsing the font list must load ZERO
 * typefaces. `useThemeFont` deliberately loads only the SELECTED family on
 * demand; a list that rendered all 14 names in their own typeface would
 * regress that and drag ~14 webfont downloads into the sheet open.
 *
 * So a specimen is NEVER a real font. Each entry describes the family in
 * system-font-safe terms — weight, letter spacing, casing, and a short
 * descriptor — so a sighted user can tell a geometric sans from a display
 * serif from a script without a single byte of font being fetched. The
 * SELECTED family still loads, once, on the preview band only.
 *
 * DEVIATION FROM SPEC, STATED PLAINLY: the SPEC specified build-time SVG
 * specimens (the family name as outlined vector paths). Authoring true
 * outlines for 14 families is a design-asset deliverable that does not exist
 * yet, and hand-writing approximate path data would be fabricated content
 * (Constitution #9). These style-based specimens satisfy the load-bearing
 * invariant exactly — zero fonts load while browsing — and the registry shape
 * is identical, so swapping in real outlines later is a drop-in replacement
 * behind the same parity gate.
 *
 * PARITY GATE: `FONT_SPECIMENS` keys must equal `THEME_FONT_SLUGS` in BOTH
 * directions. A font added to the design tokens without a specimen would
 * render a blank row; a specimen without a token would be dead weight.
 */

export interface FontSpecimen {
  /** The family name, shown as the row's primary label. */
  label: string;
  /** One-word category, shown as the row's secondary label. */
  descriptor: string;
  /**
   * System-font-safe styling that evokes the family's character. NEVER sets
   * `fontFamily` — that is what would trigger a load.
   */
  style: TextStyle;
  /** Screen-reader label, e.g. "Poppins, sans serif". */
  accessibilityLabel: string;
}

const specimen = (
  label: string,
  descriptor: string,
  style: TextStyle,
): FontSpecimen => ({
  label,
  descriptor,
  style,
  accessibilityLabel: `${label}, ${descriptor}`,
});

export const FONT_SPECIMENS: Readonly<Record<string, FontSpecimen>> = {
  // Sans serif — differentiated by weight and tracking.
  inter: specimen("Inter", "sans serif", { fontWeight: "500", letterSpacing: 0 }),
  poppins: specimen("Poppins", "geometric sans", {
    fontWeight: "600",
    letterSpacing: 0.3,
  }),
  space_grotesk: specimen("Space Grotesk", "technical sans", {
    fontWeight: "500",
    letterSpacing: 0.6,
  }),
  plus_jakarta_sans: specimen("Plus Jakarta Sans", "humanist sans", {
    fontWeight: "600",
    letterSpacing: 0.1,
  }),
  manrope: specimen("Manrope", "rounded sans", {
    fontWeight: "700",
    letterSpacing: -0.2,
  }),

  // Serif — italic/soft styling reads as editorial against the sans rows.
  playfair_display: specimen("Playfair Display", "display serif", {
    fontWeight: "700",
    letterSpacing: 0.2,
    fontStyle: "italic",
  }),
  dm_serif_display: specimen("DM Serif Display", "display serif", {
    fontWeight: "600",
    letterSpacing: 0.2,
  }),
  fraunces: specimen("Fraunces", "soft serif", {
    fontWeight: "600",
    letterSpacing: 0,
    fontStyle: "italic",
  }),
  lora: specimen("Lora", "text serif", { fontWeight: "500", letterSpacing: 0.1 }),

  // Display — heavy, tight, uppercase-leaning.
  bebas_neue: specimen("Bebas Neue", "condensed display", {
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
  }),
  anton: specimen("Anton", "heavy display", {
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  }),
  unbounded: specimen("Unbounded", "wide display", {
    fontWeight: "800",
    letterSpacing: 1.4,
  }),

  // Handwriting — italic + loose tracking.
  caveat: specimen("Caveat", "handwriting", {
    fontWeight: "500",
    letterSpacing: 0.8,
    fontStyle: "italic",
  }),
  dancing_script: specimen("Dancing Script", "script", {
    fontWeight: "600",
    letterSpacing: 0.6,
    fontStyle: "italic",
  }),
};

/** Every token slug, for the parity gate and the tab's render order. */
export const SPECIMEN_SLUGS = Object.keys(FONT_SPECIMENS);
export { THEME_FONT_SLUGS };
