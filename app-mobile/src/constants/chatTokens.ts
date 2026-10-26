/**
 * Issue #4114 Wave 3: the dark chat screen's colour tokens, in one place.
 *
 * Every value comes from the design system (`glass.discover.screenBg`,
 * `colors.accent`, `glass.chrome.*`) or is white/black at a fixed alpha, as the
 * design contract (D9) specifies: white 6% / 10% / 36% for strip, hairline and
 * secondary text. No light-theme surfaces on the chat screen.
 */
import { colors, glass } from "./designSystem";

export const chatTokens = {
  screenBg: glass.discover.screenBg,
  /** Raised dark surface: sheets, banners, the reply bar. */
  surface: "#111418",
  surfaceRaised: "#1A1E24",
  accent: colors.accent,
  accentSoft: "rgba(235, 120, 37, 0.16)",
  strip: "rgba(255, 255, 255, 0.06)",
  hairline: "rgba(255, 255, 255, 0.10)",
  chromeHairline: glass.chrome.border.hairline,
  textPrimary: "#FFFFFF",
  textSecondary: "rgba(255, 255, 255, 0.72)",
  textMuted: "rgba(255, 255, 255, 0.36)",
  textSoft: "rgba(255, 255, 255, 0.56)",
  danger: "#F87171",
  dangerSoft: "rgba(248, 113, 113, 0.14)",
  warning: "#FBBF24",
  warningSoft: "rgba(251, 191, 36, 0.14)",
  success: "#34D399",
  online: "#10B981",
  scrim: "rgba(0, 0, 0, 0.5)",
} as const;

/**
 * Issue #4114 Wave 7: received bubbles are a dark surface with white text.
 * Every text colour here passes WCAG AA (4.5:1) on `bubble`; the regression
 * test computes the ratios. Sent bubbles keep the orange design-system fill.
 */
export const receivedBubbleTokens = {
  bubble: "#1D2026",
  text: "#FFFFFF",
  textSecondary: "rgba(255, 255, 255, 0.72)",
  senderName: "#C9CDD4",
  mentionBg: "#4A2F1C",
  mentionText: "#FFD9BD",
  /** Issue #4114 QA run 2: links in a received bubble (AA on `bubble`). */
  link: "#9CCBFF",
  quoteBg: "rgba(255, 255, 255, 0.08)",
  quoteBar: "#EB7825",
  quoteName: "#FFFFFF",
  quoteText: "rgba(255, 255, 255, 0.72)",
  quoteDeleted: "#A3A9B2",
  icon: "#FFB27A",
} as const;
