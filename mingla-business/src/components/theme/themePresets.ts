/**
 * #1022 — the 12 colour presets for the Theme sheet's swatch strip.
 *
 * Pure module (no React, no React Native) so the contrast contract is
 * unit-testable without a render.
 *
 * WHY EACH PRESET IS NAMED: a swatch is an unlabelled coloured dot, but the
 * page palette derived from it can flip the WHOLE public page from a dark
 * canvas to a light one. `Ink` doing that from a black dot is astonishing
 * behaviour; a name makes it legible. Screen readers announce the name plus a
 * colour word, never a hex.
 *
 * THE CONTRAST CONTRACT (amended 2026-07-21, orchestrator-accepted):
 * The SPEC originally required presets 7-12 to clear WCAG AA 4.5:1 for
 * accent-on-page. A 16.7M-seed sweep (independently reproduced) proved that
 * is mathematically unreachable on DARK pages: `contrastAdjustedForWhiteText`
 * caps accent luminance at 0.183333, putting the dark-page ceiling at 4.2624.
 * The rule is therefore "best achievable in its page class":
 *   - light-page presets MUST clear 4.5:1
 *   - dark-page presets sit at 97.7-99.3% of the proven 4.2624 ceiling, and
 *     every new preset beats the best GRANDFATHERED preset of its own class.
 * Do NOT "fix" the dark presets by lightening them — they are at the ceiling
 * by construction. Raising the platform floor is #1024's job.
 */

/** A preset's page class, determined by `createThemePalette`'s dark/light fork. */
export type PresetPageClass = "light" | "dark";

export interface ThemePreset {
  /** The seed hex the user picks. The RENDERED accent is derived from it. */
  hex: string;
  /** Human name — announced by screen readers and shown on long-press. */
  name: string;
  /** Colour word for the accessibility label ("Sunset, orange"). */
  colorWord: string;
  /** Which canvas `createThemePalette` derives from this seed. */
  pageClass: PresetPageClass;
  /**
   * True for the six presets that shipped before #1022. Preset 1 (#eb7825,
   * the platform default) measures 3.70:1 and is GRANDFATHERED BY NAME — it
   * cannot clear 4.5 without moving the platform accent floor, which is
   * squarely inside #1024's blast radius, not this build's.
   */
  grandfathered: boolean;
}

/**
 * Presets 1-6 — the original `THEME_COLORS`, preserved exactly, now named.
 * Their hexes must not change: existing offerings reference them.
 */
export const GRANDFATHERED_PRESETS: readonly ThemePreset[] = [
  { hex: "#eb7825", name: "Sunset", colorWord: "orange", pageClass: "dark", grandfathered: true },
  { hex: "#2563eb", name: "Ocean", colorWord: "blue", pageClass: "dark", grandfathered: true },
  { hex: "#16a34a", name: "Forest", colorWord: "green", pageClass: "light", grandfathered: true },
  { hex: "#dc2626", name: "Ruby", colorWord: "red", pageClass: "dark", grandfathered: true },
  { hex: "#9333ea", name: "Violet", colorWord: "purple", pageClass: "dark", grandfathered: true },
  { hex: "#111827", name: "Ink", colorWord: "near-black", pageClass: "light", grandfathered: true },
] as const;

/**
 * Presets 7-12 — chosen by mingla-designer, verified, and accepted as FINAL
 * by the orchestrator (issue #1022 comments 5029451717 / 5029460215).
 * Three light-page and three dark-page outcomes, balancing the strip.
 *
 * Measured accent-on-page contrast at selection time:
 *   Claret  10.78:1 (light)   Peacock 4.23:1 (dark)
 *   Walnut   9.09:1 (light)   Neon    4.16:1 (dark)
 *   Olive    7.51:1 (light)   Brass   4.18:1 (dark)
 */
export const NEW_PRESETS: readonly ThemePreset[] = [
  { hex: "#6b1420", name: "Claret", colorWord: "deep red", pageClass: "light", grandfathered: false },
  { hex: "#02697e", name: "Peacock", colorWord: "teal", pageClass: "dark", grandfathered: false },
  { hex: "#5c3a21", name: "Walnut", colorWord: "brown", pageClass: "light", grandfathered: false },
  { hex: "#e0157b", name: "Neon", colorWord: "magenta", pageClass: "dark", grandfathered: false },
  { hex: "#44541f", name: "Olive", colorWord: "olive", pageClass: "light", grandfathered: false },
  { hex: "#665e00", name: "Brass", colorWord: "gold", pageClass: "dark", grandfathered: false },
] as const;

/** The full strip, in display order: the six familiar ones first. */
export const THEME_PRESETS: readonly ThemePreset[] = [
  ...GRANDFATHERED_PRESETS,
  ...NEW_PRESETS,
] as const;

/**
 * The proven dark-page contrast ceiling. `contrastAdjustedForWhiteText` caps
 * accent relative luminance at 0.183333; against the darkest reachable page
 * that yields (0.183333 + 0.05) / (0 + 0.05) = 4.2624... Asserting anything
 * above this for a dark-page preset is asserting an impossibility.
 */
export const DARK_PAGE_CONTRAST_CEILING = 4.2624;

/** WCAG AA for normal text — the bar light-page presets must clear. */
export const WCAG_AA_NORMAL_TEXT = 4.5;

/** Lookup a preset by hex, case-insensitively (matching the old behaviour). */
export const presetForHex = (hex: string | null | undefined): ThemePreset | null => {
  if (hex === null || hex === undefined) return null;
  const needle = hex.trim().toLowerCase();
  return THEME_PRESETS.find((p) => p.hex.toLowerCase() === needle) ?? null;
};
