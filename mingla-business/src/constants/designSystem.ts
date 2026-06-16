/**
 * Shared tokens aligned with app-mobile for consistent Mingla branding.
 *
 * Cycle 0a: extended additively with the design-package token set
 * (accent / canvas / glass / semantic / text / blurIntensity / easings /
 * durations / typography). Existing exports preserved verbatim.
 *
 * Sub-phase E.2: glass shadow tokens (`glassBadge`, `glassChrome`,
 * `glassChromeActive`, `glassCardBase`, `glassCardElevated`, `glassModal`)
 * use `Platform.select` to zero `elevation` on Android. Reason: Android
 * `elevation` draws a hard rectangular drop-shadow regardless of border-
 * radius or alpha, which bleeds through translucent glass surfaces and
 * creates a "solid box inside" artifact (ORCH-BIZ-0a-E4). iOS shadow*
 * fields are preserved verbatim — premium blur unchanged on iOS.
 */

import { Platform } from "react-native";

// Sub-phase E.3 (ORCH-BIZ-0a-E8): renamed from `glassElevation` and applied
// to ALL shadow tokens (including non-glass `sm`/`md`/`lg`/`xl`). Reason:
// styleguide demos render the generic shadows on translucent backgrounds,
// so the same Android elevation-rectangle artifact applied. There are no
// opaque-card consumers in mingla-business today; if a future cycle needs
// Android elevation on a specific opaque surface, override at the component
// level.
const androidSafeElevation = (ios: number): number =>
  Platform.select({ ios, android: 0, default: ios }) ?? ios;

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

// META-ORCH-1148 sub-ORCH 2.0 — venue-suite layout tokens (Design §8). The
// desktop two-column master rail width + the workspace max width. Named so no
// raw layout numbers live in VenueSuiteShell.
//
// 2.0.1 desktop polish: the rail narrowed 260→220 (the labels are short; 260
// left a dead band of empty rail) and the whole suite is now LEFT-anchored to
// the Hub chrome's `spacing.md` edge instead of centered in the canvas column —
// `alignSelf:"center"` floated the rail far right of the left-aligned TopBar /
// To-Do / sub-nav chrome, opening the dead gutter Seth flagged. `maxWidth` still
// caps ultra-wide so the workspace doesn't run edge-to-edge.
export const venueRailWidth = 220 as const;
export const venueSuiteMaxWidth = 1200 as const;

export const shadows = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: androidSafeElevation(2),
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: androidSafeElevation(4),
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: androidSafeElevation(8),
  },
  xl: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.1,
    shadowRadius: 25,
    elevation: androidSafeElevation(12),
  },
  glassBadge: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: androidSafeElevation(4),
  },
  glassChrome: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: androidSafeElevation(6),
  },
  glassChromeActive: {
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: androidSafeElevation(8),
  },
  glassCardBase: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: androidSafeElevation(6),
  },
  glassCardElevated: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.42,
    shadowRadius: 24,
    elevation: androidSafeElevation(10),
  },
  glassModal: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.48,
    shadowRadius: 40,
    elevation: androidSafeElevation(16),
  },
};

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

// ORCH-0821 — Ari signature palette (rework 2026-05-12).
//
// CALMER + REFRESHING. Decoupled from accent.warm (#eb7825 stays the brand
// action color — punchy on purpose). Ari is its own visual identity: a soft
// peach-coral gradient that reads "warm, premium, lit from within" without
// shouting. Tuned to feel like glass with a warm light behind it, not a
// brand action button.
//
// All HSL/hex per the Cycle 7 FX2 RN color rule (no oklch/lab/color-mix —
// they render transparent on iOS+Android).
export const ariPalette = {
  // Orb gradient stops — soft peach gold → calm warm coral → muted ember.
  gold: "hsl(35, 88%, 78%)",      // #f7d09a — pale peach highlight
  flame: "hsl(20, 72%, 64%)",    // #e69869 — calm warm coral (Ari signature)
  ember: "hsl(10, 55%, 50%)",    // #c66c54 — soft muted ember rim
  // Secondary touches — calmer than the brand warm for UI accents
  cursor: "hsl(20, 72%, 64%)",   // same as flame
  proposalBorder: "hsla(20, 72%, 64%, 0.45)",
  proposalShadow: "hsla(20, 72%, 64%, 0.28)",
  // Glow color for the orb's halo
  glow: "hsla(22, 75%, 68%, 0.4)",
  // ORCH-1101 — Ari thread brand accent. Operator decision (2026-06-08): the
  // send button + user bubble + Confirm button + §5 cards use the canonical
  // Mingla brand action color from the dev style guide (accent.warm #eb7825),
  // paired with white text (colors.text.inverse) exactly like every other
  // brand action button app-wide. This supersedes the earlier Ari-specific
  // deep ember (#a85a44): brand consistency was chosen over the Ari-only 4.5:1
  // target; white-on-#eb7825 (~2.9:1) is the established app-wide action pairing.
  userBubble: accent.warm, // #eb7825 — Mingla brand action color
} as const;

// ORCH-1101 — Ari thread density spine. One vertical-rhythm + type + geometry
// system applied across ChatBubble / MessageList / InputBar / cards. Promotes
// the proven ORCH-0821 literals to named tokens and tightens 1–2px. Zero magic
// numbers downstream; every Ari layout value resolves here.
export const ariThread = {
  // Vertical rhythm
  gapTurn: 10, // between different-speaker turns
  gapGroup: 4, // between same-speaker consecutive bubbles (iMessage cluster)
  orbGap: 6, // orb → bubble gap on Ari rows
  // Bubble geometry + padding
  bubblePadH: 12,
  bubblePadV: 8,
  bubbleRadius: 16, // 3 non-tail corners (was 18)
  bubbleTail: 4, // tail corner
  bodyFont: 14,
  bodyLine: 19,
  // Cards
  cardPad: 12,
  cardTitleFont: 15,
  cardTitleLine: 21,
  btnHeight: 34,
  // ORCH-1103 — Ari brand-proposal cover band height (one shared band, all states).
  coverBandH: 132,
  // Composer
  composerMinH: 48,
  composerPadV: 8,
  inputPadV: 6,
  inputMinH: 30,
  // Send button
  sendSize: 34,
  // Chips
  chipFont: 13,
  chipLine: 17,
  // Android opaque-glass equivalent for the Ari bubble fill (composited value).
  ariBubbleAndroid: "#16181b",
  // ORCH-1101 REWORK Bug #4 — OPAQUE composer surface. The composer host used
  // the translucent glass.tint.profileBase (rgba .04), so the empty-state hint
  // ("Tap + for things to try") and any thread content showed THROUGH the input
  // field. This is a solid, slightly-elevated fill over the dark discover canvas
  // (#0c0e12) on EVERY platform (no rgba/hsla → satisfies
  // ANDROID_GLASS_USES_OPAQUE_FALLBACK; nothing can bleed through).
  composerSurface: "#191c21",
  // Success / cancelled ribbon padding (matches new bubble density).
  ribbonPadH: 10,
  ribbonPadV: 5,
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
    chrome: "rgba(255, 255, 255, 0.14)",
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
