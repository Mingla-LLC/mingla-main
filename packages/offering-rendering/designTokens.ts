// Design tokens duplicated from mingla-business/src/constants/designSystem.ts
// for the subset that PublicEventPage rendering uses.
//
// Inline-defined; the package does NOT import from either app per the
// I-MOR-0827-PACKAGE-ISOLATION rule. Tokens are stable and worth
// duplicating for the package boundary.
//
// If mingla-business design tokens change in a way that affects rendering,
// update both this file AND the source. A future @mingla/design-tokens
// package could consolidate, but not in scope for Pass 2.

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
} as const;

export const text = {
  primary: "#ffffff",
  secondary: "rgba(255, 255, 255, 0.72)",
  tertiary: "rgba(255, 255, 255, 0.48)",
  quaternary: "rgba(255, 255, 255, 0.32)",
  inverse: "#0c0e12",
} as const;

export const accent = {
  warm: "#ff8a3b",
  tint: "rgba(255, 138, 59, 0.16)",
  border: "rgba(255, 138, 59, 0.32)",
} as const;

export const glass = {
  tint: {
    profileBase: "rgba(255, 255, 255, 0.06)",
  },
  border: {
    profileBase: "rgba(255, 255, 255, 0.10)",
  },
} as const;

export const semantic = {
  error: "#ef4444",
  errorTint: "rgba(239, 68, 68, 0.16)",
  warningTint: "rgba(245, 158, 11, 0.16)",
  infoTint: "rgba(59, 130, 246, 0.16)",
} as const;

export const typography = {
  caption: {
    fontSize: 11,
    lineHeight: 14,
  },
  bodySm: {
    fontSize: 13,
    lineHeight: 18,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
} as const;

export const backgroundColor = "#0c0e12";

export const MINGLA_DEFAULT_THEME = {
  color: "#eb7825",
  font: "inter",
  animation: "none",
} as const;

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

// issue #1023 — 29 generated animations (9 original slugs keep their names),
// in the reference page's group order: Celebrate, Glow, Nature, Night, Love.
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

export type ThemeMotionGroup = "Celebrate" | "Glow" | "Nature" | "Night" | "Love";

/** Display name and picker group for every animation (reference page names). */
export const THEME_ANIMATION_CATALOG: Readonly<
  Record<
    Exclude<(typeof THEME_ANIMATION_SLUGS)[number], "none">,
    { name: string; group: ThemeMotionGroup }
  >
> = {
  confetti: { name: "Confetti", group: "Celebrate" },
  streamers: { name: "Streamers", group: "Celebrate" },
  party_shapes: { name: "Party shapes", group: "Celebrate" },
  fireworks: { name: "Fireworks", group: "Celebrate" },
  balloons: { name: "Balloons", group: "Celebrate" },
  bubbles: { name: "Bubbles", group: "Celebrate" },
  champagne: { name: "Champagne", group: "Celebrate" },
  sparkles: { name: "Sparkles", group: "Glow" },
  glitter_shower: { name: "Glitter shower", group: "Glow" },
  disco_glints: { name: "Disco glints", group: "Glow" },
  bokeh: { name: "Bokeh lights", group: "Glow" },
  golden_dust: { name: "Golden dust", group: "Glow" },
  shimmer_reveal: { name: "Shimmer sweep", group: "Glow" },
  neon_pulse: { name: "Neon pulse", group: "Glow" },
  snowfall: { name: "Snowfall", group: "Nature" },
  falling_petals: { name: "Falling petals", group: "Nature" },
  autumn_leaves: { name: "Autumn leaves", group: "Nature" },
  fireflies: { name: "Fireflies", group: "Nature" },
  rain: { name: "Soft rain", group: "Nature" },
  sun_rays: { name: "Sun rays", group: "Nature" },
  starry_sky: { name: "Starry sky", group: "Night" },
  aurora: { name: "Aurora", group: "Night" },
  lanterns: { name: "Lanterns", group: "Night" },
  embers: { name: "Embers", group: "Night" },
  music_notes: { name: "Music notes", group: "Night" },
  hearts: { name: "Hearts", group: "Love" },
  love_burst: { name: "Love burst", group: "Love" },
  rose_petals: { name: "Rose petals", group: "Love" },
  love_balloons: { name: "Love balloons", group: "Love" },
};

export const THEME_MOTION_GROUPS: readonly ThemeMotionGroup[] = [
  "Celebrate",
  "Glow",
  "Nature",
  "Night",
  "Love",
];

export type ThemeFontSlug = (typeof THEME_FONT_SLUGS)[number];
export type ThemeAnimationSlug = (typeof THEME_ANIMATION_SLUGS)[number];

// issue #1023 wave 2 — any Google Fonts family can be a theme font. A family
// name must match this shape. The SAME shape lives in the database helper
// `public.issue_1023_is_theme_font`, in Ari's theme schema
// (`supabase/functions/_shared/agentSiteTools.ts`) and in the catalogue build
// script; the parity test keeps all four equal.
export const GOOGLE_FONT_FAMILY_RE = /^[A-Z0-9][A-Za-z0-9]*( [A-Za-z0-9]+)*$/;
export const GOOGLE_FONT_FAMILY_MAX = 40;

declare const googleFontFamilyBrand: unique symbol;
export type GoogleFontFamily = string & {
  readonly [googleFontFamilyBrand]: true;
};
/** A saved theme font: one of the 14 bundled slugs, or a Google family name. */
export type ThemeFontValue = ThemeFontSlug | GoogleFontFamily;

/** The Google Fonts family name behind each bundled slug. */
export const LEGACY_FONT_FAMILY_NAMES: Readonly<Record<ThemeFontSlug, string>> = {
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

export interface ThemeInput {
  color?: string | null;
  /**
   * issue #1023 wave 2 — the gradient's second stop, at the SAME level as
   * `color`. A gradient is one unit: `color2` is only ever used together with
   * this level's `color`.
   */
  color2?: string | null;
  font?: ThemeFontValue | string | null;
  animation?: ThemeAnimationSlug | string | null;
}

export interface ResolvedTheme {
  color: string;
  /**
   * Second gradient stop, or null for a solid theme. `resolveTheme` always
   * sets it; optional only so hand-built test themes stay valid (absent =
   * solid).
   */
  color2?: string | null;
  foregroundColor: "#000000" | "#ffffff";
  font: ThemeFontValue;
  fontFamilyValue: string;
  /** Bold face key. `resolveTheme` always sets it (absent = legacy map). */
  boldFontFamilyValue?: string;
  animation: ThemeAnimationSlug;
}

export const FONT_FAMILY_MAP: Record<ThemeFontSlug, string> = {
  inter: "Inter_500Medium",
  poppins: "Poppins_500Medium",
  space_grotesk: "SpaceGrotesk_500Medium",
  plus_jakarta_sans: "PlusJakartaSans_500Medium",
  manrope: "Manrope_500Medium",
  playfair_display: "PlayfairDisplay_500Medium",
  dm_serif_display: "DMSerifDisplay_400Regular",
  fraunces: "Fraunces_500Medium",
  lora: "Lora_500Medium",
  bebas_neue: "BebasNeue_400Regular",
  anton: "Anton_400Regular",
  unbounded: "Unbounded_500Medium",
  caveat: "Caveat_500Medium",
  dancing_script: "DancingScript_500Medium",
};
