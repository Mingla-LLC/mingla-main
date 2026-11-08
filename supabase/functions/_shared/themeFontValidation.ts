// issue #1023 wave 2 — Ari's theme validation for update_brand_context.
//
// A theme font is one of the 14 bundled slugs or an exact Google Fonts family
// name. The schema checks the SHAPE (the same shape as the database helper
// public.issue_1023_is_theme_font and GOOGLE_FONT_FAMILY_RE in
// packages/offering-rendering/designTokens.ts — the parity test keeps them
// equal). This module checks the NAME against the saved family list, so Ari
// cannot save a misspelt family that pages would silently draw as Inter.
//
// `googleFontFamilies.json` is written by
// packages/offering-rendering/scripts/build-google-fonts-catalog.mjs. Edge
// functions cannot import packages/, so the list is a copy here.

import GOOGLE_FONT_FAMILIES from "./googleFontFamilies.json" with { type: "json" };

export const THEME_FONT_SLUGS = [
  "inter",
  "poppins",
  "space_grotesk",
  "plus_jakarta_sans",
  "manrope",
  "playfair_display",
  "dm_serif_display",
  "fraunces",
  "lora",
  "bebas_neue",
  "anton",
  "unbounded",
  "caveat",
  "dancing_script",
] as const;

/**
 * The 29 theme motions (issue #1023 wave 1), in the picker's order. Must equal
 * THEME_ANIMATION_SLUGS in packages/offering-rendering/designTokens.ts and the
 * allow-list in public.ari_update_brand_context.
 */
export const THEME_ANIMATION_SLUGS = [
  "none",
  "confetti",
  "fireworks",
  "balloons",
  "sparkles",
  "glitter_shower",
  "snowfall",
  "falling_petals",
  "hearts",
  "shimmer_reveal",
  "streamers",
  "party_shapes",
  "bubbles",
  "champagne",
  "disco_glints",
  "bokeh",
  "golden_dust",
  "neon_pulse",
  "autumn_leaves",
  "fireflies",
  "rain",
  "sun_rays",
  "starry_sky",
  "aurora",
  "lanterns",
  "embers",
  "music_notes",
  "love_burst",
  "rose_petals",
  "love_balloons",
] as const;

/** Google's spelling of each bundled slug's family. */
export const LEGACY_FONT_FAMILY_NAMES: Readonly<Record<string, string>> = {
  inter: "Inter",
  poppins: "Poppins",
  space_grotesk: "Space Grotesk",
  plus_jakarta_sans: "Plus Jakarta Sans",
  manrope: "Manrope",
  playfair_display: "Playfair Display",
  dm_serif_display: "DM Serif Display",
  fraunces: "Fraunces",
  lora: "Lora",
  bebas_neue: "Bebas Neue",
  anton: "Anton",
  unbounded: "Unbounded",
  caveat: "Caveat",
  dancing_script: "Dancing Script",
};

/** The family-name shape (I-1023-FONT-SHAPE-PARITY). */
export const GOOGLE_FONT_FAMILY_PATTERN = "^[A-Z0-9][A-Za-z0-9]*( [A-Za-z0-9]+)*$";
export const GOOGLE_FONT_FAMILY_MAX = 40;
/** The schema pattern: a lower-case slug or a family name. */
export const ARI_THEME_FONT_PATTERN =
  "^([a-z_]+|[A-Z0-9][A-Za-z0-9]*( [A-Za-z0-9]+)*)$";

const FAMILY_SET: ReadonlySet<string> = new Set(GOOGLE_FONT_FAMILIES as string[]);
const SLUG_SET: ReadonlySet<string> = new Set(THEME_FONT_SLUGS);
const SLUG_BY_FAMILY: ReadonlyMap<string, string> = new Map(
  Object.entries(LEGACY_FONT_FAMILY_NAMES).map(([slug, family]) => [family, slug]),
);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** A bundled family name becomes its slug; anything else is unchanged. */
export const canonicalThemeFont = (font: string): string =>
  SLUG_BY_FAMILY.get(font) ?? font;

export const isKnownThemeFont = (font: string): boolean => {
  const canonical = canonicalThemeFont(font);
  return SLUG_SET.has(canonical) || FAMILY_SET.has(canonical);
};

/**
 * Checks a theme patch before it reaches the RPC. Returns the theme to send
 * (font canonicalised) or the refusal message.
 */
export const validateAriTheme = (
  theme: unknown,
): { ok: true; theme: unknown } | { ok: false; message: string } => {
  if (theme === null || typeof theme !== "object" || Array.isArray(theme)) {
    return { ok: true, theme };
  }
  const next = { ...(theme as Record<string, unknown>) };
  const font = next.font;
  if (typeof font === "string") {
    if (!isKnownThemeFont(font)) {
      return {
        ok: false,
        message: `Unknown font \`${font}\`. Use an exact Google Fonts family name.`,
      };
    }
    next.font = canonicalThemeFont(font);
  }
  const color2 = next.color2;
  if (color2 !== undefined && color2 !== null) {
    if (typeof color2 !== "string" || !HEX.test(color2)) {
      return { ok: false, message: "color2 must be a #RRGGBB colour." };
    }
    if (typeof next.color !== "string" || !HEX.test(next.color)) {
      return {
        ok: false,
        message: "A second colour needs a first colour: send color with color2.",
      };
    }
  }
  return { ok: true, theme: next };
};
