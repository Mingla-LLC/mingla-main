/**
 * #4304 part 2 — Brand-group chat colours, matching the Explorer chats
 * (app-mobile constants/chatTokens.ts, #4114 Waves 3 and 7) so the two apps'
 * group chats read as one product. Sent bubbles are the brand orange with dark
 * text; received bubbles are the dark #1D2026 surface with white text.
 */
import { color, scrim } from "./designSystem";

// #4420 Graphite Glass: every chat colour is a designSystem token.
// #4420 D2 (approved design, "no orange fields"): your own bubble is the
// selected graphite material (card3) with white text; received bubbles sit on
// the card surface. Orange stays a small accent (the quote bar).
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
  mineBubble: color.card3,
  /** Ink text on accent/paper controls (Mingla team screens). Not for bubbles. */
  mineText: color.onAccent,
  /** #4420 D2: text on your own (graphite) bubble. */
  mineBubbleText: color.textStrong,
  mineTextSecondary: color.text2,
  otherBubble: color.card,
  otherText: color.textStrong,
  senderName: color.text2,
  mentionBg: color.accentTint,
  mentionText: color.accentText,
  mentionMineBg: color.accentTint,
  quoteBg: color.fill.pressed,
  quoteMineBg: color.fill.pressed,
  quoteBar: color.accent,
  quoteBarMine: color.accent,
  selected: color.focus,
  bubbleRadius: 20,
  bubbleTail: 6,
  composerRadius: 28,
  inboxRowHeight: 72,
} as const;
