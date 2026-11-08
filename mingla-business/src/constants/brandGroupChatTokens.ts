/**
 * #4304 part 2 — Brand-group chat colours, matching the Explorer chats
 * (app-mobile constants/chatTokens.ts, #4114 Waves 3 and 7) so the two apps'
 * group chats read as one product. Sent bubbles are the brand orange with dark
 * text; received bubbles are the dark #1D2026 surface with white text.
 */
import { accent, canvas } from "./designSystem";

export const brandGroupChat = {
  screenBg: canvas.discover,
  surface: "#111418",
  surfaceRaised: "#1A1E24",
  accent: accent.warm,
  accentSoft: "rgba(235, 120, 37, 0.16)",
  hairline: "rgba(255, 255, 255, 0.10)",
  strip: "rgba(255, 255, 255, 0.06)",
  textPrimary: "#FFFFFF",
  textSecondary: "rgba(255, 255, 255, 0.72)",
  textSoft: "rgba(255, 255, 255, 0.56)",
  textMuted: "rgba(255, 255, 255, 0.40)",
  scrim: "rgba(0, 0, 0, 0.55)",
  mineBubble: accent.warm,
  mineText: "#101216",
  mineTextSecondary: "rgba(16, 18, 22, 0.66)",
  otherBubble: "#1D2026",
  otherText: "#FFFFFF",
  senderName: "#C9CDD4",
  mentionBg: "#4A2F1C",
  mentionText: "#FFD9BD",
  mentionMineBg: "rgba(16, 18, 22, 0.16)",
  quoteBg: "rgba(255, 255, 255, 0.08)",
  quoteMineBg: "rgba(16, 18, 22, 0.12)",
  quoteBar: accent.warm,
  quoteBarMine: "#101216",
  selected: "#b995ff",
  bubbleRadius: 20,
  bubbleTail: 6,
  composerRadius: 28,
  inboxRowHeight: 72,
} as const;
