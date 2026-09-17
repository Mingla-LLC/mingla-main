/**
 * themedPreviewCardColors — every colour on the creator's Preview-step mini
 * card (RSVP Step 6 and ticketed-event Step 7), derived ONLY from the event's
 * resolved theme palette.
 *
 * Why this exists: the mini card paints `palette.page` as its surface — a
 * near-white panel for a light theme — but its venue line, "Not going" label,
 * recurrence pill and ticket badges kept the DARK APP CHROME tokens
 * (`text.secondary` = rgba(255,255,255,0.72), `accent.warm`, the glass "info"
 * pill). White-on-near-white made the venue line and "Not going" invisible.
 * Only the date and title had been routed through the palette.
 *
 * Contract (pinned by themedPreviewCardColors.test.ts across light AND dark
 * themes): every TEXT colour here meets WCAG AA for normal-size text (4.5:1)
 * against the opaque fill it sits on. The pairs mirror the guest-facing RSVP
 * page (`RsvpMomentumDecision` / `RsvpOfferingBody`), so the preview shows the
 * same tones guests will see.
 *
 * Pure: no React Native import, so it is unit-testable.
 */
import {
  opaqueAccentWashColor,
  opaqueSurfaceColor,
  type ThemePalette,
} from "../../../../packages/offering-rendering/themePalette";
import {
  contrastRatio,
  mixHex,
  readableTextFor,
} from "../../utils/buttonAccentContrast";

/** WCAG 2.x AA minimum for normal-size text. */
export const AA_TEXT_CONTRAST = 4.5;

export interface ThemedPreviewCardColors {
  /** Opaque card surface — the themed page colour. */
  surface: string;
  border: string;
  dateText: string;
  titleText: string;
  venueText: string;
  pillFill: string;
  pillBorder: string;
  pillText: string;
  goingFill: string;
  goingText: string;
  notGoingFill: string;
  notGoingBorder: string;
  notGoingText: string;
}

const RGBA_RE =
  /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/;
const HEX_RE = /^#([0-9a-fA-F]{6})$/;

/**
 * The solid colour the eye sees when `top` (hex or rgb/rgba) is painted over
 * the opaque `base` hex. Text colours on a themed page are often translucent
 * (`palette.secondaryText`), so contrast must be measured on this result.
 */
export const compositeOverOpaque = (top: string, base: string): string => {
  const baseMatch = HEX_RE.exec(base);
  if (baseMatch === null) return top;
  const b = parseInt(baseMatch[1], 16);
  const baseRgb = [(b >> 16) & 255, (b >> 8) & 255, b & 255];
  let topRgb: number[];
  let alpha = 1;
  const rgba = RGBA_RE.exec(top);
  if (rgba !== null) {
    topRgb = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
    alpha = rgba[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(rgba[4])));
  } else {
    const hex = HEX_RE.exec(top);
    if (hex === null) return base;
    const t = parseInt(hex[1], 16);
    topRgb = [(t >> 16) & 255, (t >> 8) & 255, t & 255];
  }
  return `#${topRgb
    .map((channel, i) =>
      Math.round(channel * alpha + baseRgb[i] * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
};

/** Contrast of a possibly-translucent text colour over an opaque fill. */
export const textContrastOn = (textColor: string, fill: string): number =>
  contrastRatio(compositeOverOpaque(textColor, fill), fill);

/**
 * The accent, nudged toward black or white only as far as needed to read as
 * normal-size text on `fill`. The palette guarantees the accent only 3.15:1
 * against the page (a large-text / UI threshold), which is too faint for the
 * 11px date line and pill label. Falls back to pure black/white, which always
 * clears 4.5:1.
 */
export const readableAccentOn = (accentHex: string, fill: string): string => {
  if (contrastRatio(accentHex, fill) >= AA_TEXT_CONTRAST) return accentHex;
  const toward = readableTextFor(fill);
  let adjusted = accentHex;
  for (let i = 0; i < 12; i += 1) {
    adjusted = mixHex(adjusted, toward, 0.16);
    if (contrastRatio(adjusted, fill) >= AA_TEXT_CONTRAST) return adjusted;
  }
  return toward;
};

/** `preferred` when it reads on `fill`, else the max-contrast black/white. */
const readableOr = (preferred: string, fill: string): string =>
  textContrastOn(preferred, fill) >= AA_TEXT_CONTRAST
    ? preferred
    : readableTextFor(fill);

export const themedPreviewCardColors = (
  palette: ThemePalette,
): ThemedPreviewCardColors => {
  const surface = palette.page;
  const pillFill = opaqueAccentWashColor(palette);
  const notGoingFill = opaqueSurfaceColor(palette);
  return {
    surface,
    border: palette.panelBorder,
    dateText: readableAccentOn(palette.accent, surface),
    titleText: readableOr(palette.primaryText, surface),
    venueText: readableOr(palette.secondaryText, surface),
    pillFill,
    pillBorder: palette.panelBorder,
    pillText: readableAccentOn(palette.accent, pillFill),
    goingFill: palette.accent,
    goingText: readableOr(palette.accentText, palette.accent),
    notGoingFill,
    notGoingBorder: palette.panelBorder,
    notGoingText: readableOr(palette.secondaryText, notGoingFill),
  };
};
