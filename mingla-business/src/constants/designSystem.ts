/**
 * Shared tokens aligned with app-mobile for consistent Mingla branding.
 *
 * Cycle 0a: extended additively with the design-package token set
 * (accent / canvas / glass / semantic / text / blurIntensity / easings /
 * durations / typography). Existing exports preserved verbatim.
 */

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 28,
  display: 40,
  full: 999,
} as const;

export const shadows = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 8,
  },
  xl: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.1,
    shadowRadius: 25,
    elevation: 12,
  },
  glassBadge: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  glassChrome: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 6,
  },
  glassChromeActive: {
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  glassCardBase: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
  },
  glassCardElevated: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.42,
    shadowRadius: 24,
    elevation: 10,
  },
  glassModal: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.48,
    shadowRadius: 40,
    elevation: 16,
  },
} as const;

export const fontWeights = {
  regular: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

export const colors = {
  primary: {
    500: "#f97316",
    700: "#c2410c",
  },
  gray: {
    200: "#e5e7eb",
  },
  background: {
    primary: "#ffffff",
    secondary: "#f9fafb",
  },
  text: {
    primary: "#111827",
    secondary: "#4b5563",
    tertiary: "#6b7280",
    inverse: "#ffffff",
  },
  accent: "#eb7825",
} as const;

/** Welcome / auth gradient endpoint (warm off-white) */
export const backgroundWarmGlow = "#fff9f5" as const;

// ---------------------------------------------------------------------------
// Cycle 0a additions — design-package token port (additive only).
// Values match `Mingla_Artifacts/design-package/.../project/tokens.css` verbatim.
// ---------------------------------------------------------------------------

export const accent = {
  warm: "#eb7825",
  glow: "rgba(235, 120, 37, 0.35)",
  tint: "rgba(235, 120, 37, 0.28)",
  border: "rgba(235, 120, 37, 0.55)",
} as const;

export const canvas = {
  discover: "#0c0e12",
  profile: "#141113",
  depth: "#08090c",
} as const;

export const glass = {
  tint: {
    badge: {
      idle: "rgba(12, 14, 18, 0.42)",
      pressed: "rgba(12, 14, 18, 0.52)",
    },
    chrome: {
      idle: "rgba(12, 14, 18, 0.48)",
      pressed: "rgba(12, 14, 18, 0.58)",
    },
    backdrop: "rgba(12, 14, 18, 0.34)",
    profileBase: "rgba(255, 255, 255, 0.04)",
    profileElevated: "rgba(255, 255, 255, 0.06)",
  },
  border: {
    badge: "rgba(255, 255, 255, 0.14)",
    chrome: "rgba(255, 255, 255, 0.06)",
    profileBase: "rgba(255, 255, 255, 0.08)",
    profileElevated: "rgba(255, 255, 255, 0.12)",
    pending: "rgba(255, 255, 255, 0.28)",
  },
  highlight: {
    badge: "rgba(255, 255, 255, 0.22)",
    profileBase: "rgba(255, 255, 255, 0.10)",
    profileElevated: "rgba(255, 255, 255, 0.14)",
  },
} as const;

export const semantic = {
  success: "#22c55e",
  successTint: "rgba(34, 197, 94, 0.18)",
  warning: "#f59e0b",
  warningTint: "rgba(245, 158, 11, 0.18)",
  error: "#ef4444",
  errorTint: "rgba(239, 68, 68, 0.18)",
  info: "#3b82f6",
  infoTint: "rgba(59, 130, 246, 0.18)",
} as const;

export const text = {
  primary: "rgba(255, 255, 255, 0.96)",
  secondary: "rgba(255, 255, 255, 0.72)",
  tertiary: "rgba(255, 255, 255, 0.52)",
  quaternary: "rgba(255, 255, 255, 0.32)",
  inverse: "#ffffff",
} as const;

export const blurIntensity = {
  badge: 24,
  chrome: 28,
  backdrop: 22,
  cardBase: 30,
  cardElevated: 34,
  modal: 40,
} as const;

export const easings = {
  out: "cubic-bezier(0.33, 1, 0.68, 1)",
  in: "cubic-bezier(0.32, 0, 0.67, 0)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  press: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
  sine: "cubic-bezier(0.37, 0, 0.63, 1)",
} as const;

export const durations = {
  instant: 80,
  fast: 120,
  normal: 200,
  entry: 260,
  exit: 180,
  slow: 320,
  deliberate: 400,
  slowest: 800,
} as const;

export const typography = {
  display: { fontSize: 32, lineHeight: 48, fontWeight: "700" as const, letterSpacing: -0.4 },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: "700" as const, letterSpacing: -0.2 },
  h2: { fontSize: 24, lineHeight: 36, fontWeight: "700" as const, letterSpacing: -0.2 },
  h3: { fontSize: 20, lineHeight: 32, fontWeight: "600" as const, letterSpacing: 0 },
  bodyLg: { fontSize: 18, lineHeight: 28, fontWeight: "500" as const, letterSpacing: 0 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const, letterSpacing: 0 },
  bodySm: { fontSize: 14, lineHeight: 20, fontWeight: "400" as const, letterSpacing: 0 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" as const, letterSpacing: 0.2 },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: "600" as const, letterSpacing: 0.4 },
  labelCap: { fontSize: 12, lineHeight: 16, fontWeight: "600" as const, letterSpacing: 1.4 },
  buttonLg: { fontSize: 16, lineHeight: 24, fontWeight: "600" as const, letterSpacing: 0 },
  buttonMd: { fontSize: 14, lineHeight: 20, fontWeight: "600" as const, letterSpacing: 0.2 },
  statValue: { fontSize: 26, lineHeight: 32, fontWeight: "700" as const, letterSpacing: -0.4 },
  monoMd: { fontSize: 14, lineHeight: 20, fontWeight: "500" as const, letterSpacing: 0 },
} as const;
