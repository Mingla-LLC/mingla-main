/**
 * #4304 part 2 — Brand-group chat colours, matching the Explorer chats
 * (app-mobile constants/chatTokens.ts, #4114 Waves 3 and 7) so the two apps'
 * group chats read as one product. Sent bubbles are the brand orange with dark
 * text; received bubbles are the dark #1D2026 surface with white text.
 */
import { color, scrim } from "./designSystem";

// #4420 Graphite Glass: every chat colour is a designSystem token. Sent
// bubbles stay the brand orange with ink text; received bubbles sit on the
// card surface with white text.
export const brandGroupChat = {
  screenBg: color.canvas,
  surface: color.card,
  surfaceRaised: color.card2,
  accent: color.accent,
  accentSoft: color.accentTint,
  hairline: color.lineStrong,
  strip: color.fill.tile,
  textPrimary: color.textStrong,
  textSecondary: color.text2,
  textSoft: color.text3,
  textMuted: color.text4,
  scrim: scrim.modal,
  mineBubble: color.accent,
  mineText: color.onAccent,
  mineTextSecondary: color.onAccent2,
  otherBubble: color.card3,
  otherText: color.textStrong,
  senderName: color.text2,
  mentionBg: color.accentTint,
  mentionText: color.accentText,
  mentionMineBg: color.onAccentTint,
  quoteBg: color.fill.pressed,
  quoteMineBg: color.onAccentTint2,
  quoteBar: color.accent,
  quoteBarMine: color.onAccent,
  selected: color.focus,
  bubbleRadius: 20,
  bubbleTail: 6,
  composerRadius: 28,
  inboxRowHeight: 72,
} as const;
