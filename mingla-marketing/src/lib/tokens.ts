/**
 * Mingla design tokens (JS mirror of src/styles/tokens.css).
 *
 * For Framer Motion configs, JS-evaluated styles, and any code that needs
 * a numeric/string value at runtime. The CSS file remains the source of
 * truth for static styling — this is the runtime mirror.
 *
 * Constitutional #2: when a value here changes, also update tokens.css.
 * Both files are co-owned and must stay in sync.
 *
 * Source: app-mobile/src/constants/designSystem.ts
 */

export const colors = {
  primary: {
    50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74',
    400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c',
    800: '#9a3412', 900: '#7c2d12',
  },
  accent: '#eb7825',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  errorBright: '#f87171',
  gray: {
    50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db',
    400: '#9ca3af', 500: '#6b7280', 600: '#4b5563', 700: '#374151',
    800: '#1f2937', 900: '#111827',
  },
  canvas: 'rgb(20 17 19)',
  bgPrimary: '#ffffff',
  bgSecondary: '#f9fafb',
  bgTertiary: '#f3f4f6',
  warmGlow: '#fff9f5',
  textPrimary: '#111827',
  textSecondary: '#4b5563',
  textTertiary: '#6b7280',
  textInverse: '#ffffff',
} as const;

export const spacing = {
  xxs: 2, xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
} as const;

export const radius = {
  sm: 8, md: 12, lg: 16, xl: 24, full: 9999,
} as const;

export const typography = {
  xs: { fontSize: 12, lineHeight: 16 },
  sm: { fontSize: 14, lineHeight: 20 },
  md: { fontSize: 16, lineHeight: 24 },
  lg: { fontSize: 18, lineHeight: 28 },
  xl: { fontSize: 20, lineHeight: 32 },
  xxl: { fontSize: 24, lineHeight: 36 },
  xxxl: { fontSize: 32, lineHeight: 48 },
  tagline: { fontSize: 17, lineHeight: 26 },
} as const;

export const fontWeights = {
  regular: 400, medium: 500, semibold: 600, bold: 700,
} as const;

export const animations = {
  duration: {
    fast: 150,    // ms
    normal: 300,
    slow: 500,
  },
  easing: {
    easeInOut: [0.4, 0, 0.2, 1] as const,
    easeOut: [0, 0, 0.2, 1] as const,
    easeIn: [0.4, 0, 1, 1] as const,
  },
} as const;

/**
 * Glass chrome tokens — what the AudienceSwitcher consumes.
 * Mirrors `glass.chrome.*` from designSystem.ts.
 */
export const glassChrome = {
  blur: 28,
  tintFloor: 'rgb(12 14 18 / 0.48)',
  tintPressed: 'rgb(12 14 18 / 0.58)',
  hairline: 'rgb(255 255 255 / 0.06)',
  fallbackSolid: 'rgb(22 24 28 / 0.94)',
  shadow: '0 4px 12px rgb(0 0 0 / 0.28)',
  active: {
    tint: 'rgb(235 120 37 / 0.28)',
    border: 'rgb(235 120 37 / 0.55)',
    glowColor: '#eb7825',
    glowOpacity: 0.35,
    glowRadius: 14,
    iconColor: '#ffffff',
    labelColor: '#ffffff',
  },
  inactive: {
    iconColor: 'rgb(255 255 255 / 0.65)',
    iconColorStrong: 'rgb(255 255 255 / 0.88)',
    labelColor: 'rgb(255 255 255 / 0.55)',
  },
  button: { size: 44, radius: 22 },
  switcher: {
    height: 44, radius: 22, paddingHorizontal: 6, paddingVertical: 4,
    pillGap: 8,
  },
  pill: {
    height: 36, radius: 18,
    paddingHorizontal: 12, paddingHorizontalActive: 14,
  },
  motion: {
    showDurationMs: 260,
    hideDurationMs: 180,
    pressDurationMs: 120,
    pressScale: 0.94,
    selectPulseScale: 1.06,
    springDamping: 18,
    springStiffness: 260,
    springMass: 0.9,
  },
} as const;

/**
 * Hero glow tokens — mirrors `glass.profile.heroGlow` + heroGradient.
 * Phase 2+ will lean on these heavily for the cinematic ecosystem story.
 */
export const heroGlow = {
  centerColor: 'rgb(235 120 37 / 0.28)',
  midColor: 'rgb(235 120 37 / 0.12)',
  edgeColor: 'rgb(235 120 37 / 0)',
  radius: 180,
  offsetY: -10,
  breathingRangeMs: 8000,
  breathingOpacityRange: [0.85, 1.0] as const,
  gradient: {
    from: 'rgb(235 120 37 / 0.10)',
    to: 'rgb(20 17 19 / 0)',
    heightRatio: 0.42,
  },
} as const;

export type Tokens = {
  colors: typeof colors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  fontWeights: typeof fontWeights;
  animations: typeof animations;
  glassChrome: typeof glassChrome;
  heroGlow: typeof heroGlow;
};
