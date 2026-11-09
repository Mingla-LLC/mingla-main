/**
 * #4347 wave 4 — the Explorer layer on a host venue's public page: the pure
 * parts (colour, hours, crowd category, the main button).
 *
 * The page body is the shared `PublicVenueScreen`, drawn in the host's own
 * palette. "When you'd go" sits inside that body, so it has to be legible on
 * whatever page colour the host's theme resolves to. `whenColorsFor` derives
 * the block's colours from the page palette and MEASURES them: text 4.5:1 and
 * bars 3:1 against the surface they sit on. If any pair fails, the block falls
 * back to the neutral paper tokens (the same measured values the place sheet
 * uses), drawn on its own white card. Never a guess.
 */
import { contrastRatio, themeTextAccent, type ThemePalette } from '@mingla/offering-rendering/themePalette';
import { SPINE, WHEN_BLOCK } from '../expandedCard/spineTokens';

/** The colours "When you'd go" draws with. */
export interface WhenColors {
  /** The block's own background. */
  readonly surface: string;
  readonly heading: string;
  readonly text: string;
  readonly muted: string;
  readonly tileFill: string;
  readonly chipFill: string;
  readonly chipActiveFill: string;
  readonly chipActiveText: string;
  readonly barFill: string;
  readonly barActiveFill: string;
}

export const TEXT_MIN_CONTRAST = 4.5;
export const GRAPHIC_MIN_CONTRAST = 3;

/** The neutral fallback: the place sheet's paper tokens, all measured. */
export const NEUTRAL_WHEN_COLORS: WhenColors = {
  surface: SPINE.paper,
  heading: SPINE.heading,
  text: SPINE.factValue,
  muted: SPINE.muted,
  tileFill: SPINE.chipFill,
  chipFill: WHEN_BLOCK.chipFill,
  chipActiveFill: WHEN_BLOCK.chipActiveFill,
  chipActiveText: WHEN_BLOCK.chipActiveText,
  barFill: WHEN_BLOCK.barFill,
  barActiveFill: WHEN_BLOCK.barActiveFill,
};

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** "#rrggbb" or "rgba(r,g,b,a)" / "rgb(r,g,b)"; null when unreadable. */
export function parseColor(value: string): Rgba | null {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(value.trim());
  if (hex) {
    const v = hex[1];
    return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16), a: 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim());
  if (fn) {
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) };
  }
  return null;
}

const toHex = (n: number): string => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0');

/** `color` painted over the opaque `base`, as an opaque "#rrggbb". Null when unreadable. */
export function flatten(color: string, base: string): string | null {
  const top = parseColor(color);
  const under = parseColor(base);
  if (!top || !under || under.a !== 1) return null;
  const a = Math.min(1, Math.max(0, top.a));
  return `#${toHex(top.r * a + under.r * (1 - a))}${toHex(top.g * a + under.g * (1 - a))}${toHex(top.b * a + under.b * (1 - a))}`;
}

/** Mix two opaque colours (`amount` of `to`). */
function mix(from: string, to: string, amount: number): string | null {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return null;
  return `#${toHex(a.r + (b.r - a.r) * amount)}${toHex(a.g + (b.g - a.g) * amount)}${toHex(a.b + (b.b - a.b) * amount)}`;
}

/** Every pair the block draws, with the floor it must clear. */
export function whenColorPairs(c: WhenColors): { name: string; fg: string; bg: string; min: number }[] {
  return [
    { name: 'heading/surface', fg: c.heading, bg: c.surface, min: TEXT_MIN_CONTRAST },
    { name: 'text/surface', fg: c.text, bg: c.surface, min: TEXT_MIN_CONTRAST },
    { name: 'muted/surface', fg: c.muted, bg: c.surface, min: TEXT_MIN_CONTRAST },
    { name: 'text/tile', fg: c.text, bg: c.tileFill, min: TEXT_MIN_CONTRAST },
    { name: 'muted/tile', fg: c.muted, bg: c.tileFill, min: TEXT_MIN_CONTRAST },
    { name: 'text/chip', fg: c.text, bg: c.chipFill, min: TEXT_MIN_CONTRAST },
    { name: 'chipActiveText/chipActive', fg: c.chipActiveText, bg: c.chipActiveFill, min: TEXT_MIN_CONTRAST },
    { name: 'chipActive/surface', fg: c.chipActiveFill, bg: c.surface, min: GRAPHIC_MIN_CONTRAST },
    { name: 'bar/surface', fg: c.barFill, bg: c.surface, min: GRAPHIC_MIN_CONTRAST },
    { name: 'barActive/surface', fg: c.barActiveFill, bg: c.surface, min: GRAPHIC_MIN_CONTRAST },
  ];
}

/** True when every pair clears its floor. */
export function whenColorsPass(c: WhenColors): boolean {
  return whenColorPairs(c).every((p) => {
    if (!parseColor(p.fg) || !parseColor(p.bg)) return false;
    return contrastRatio(p.fg, p.bg) >= p.min;
  });
}

export interface WhenTheme {
  readonly colors: WhenColors;
  /** True when the block is in the host's colours; false = neutral fallback. */
  readonly themed: boolean;
}

/**
 * The block's colours, from the page palette. Everything is flattened to an
 * opaque colour first (the palette's secondary/tertiary text and card fills
 * are translucent) so the contrast check measures what is actually drawn.
 */
export function whenColorsFor(palette: ThemePalette | null | undefined): WhenTheme {
  if (!palette) return { colors: NEUTRAL_WHEN_COLORS, themed: false };
  const page = flatten(palette.page, '#000000');
  if (!page) return { colors: NEUTRAL_WHEN_COLORS, themed: false };
  const surface = flatten(palette.card, page);
  const text = flatten(palette.primaryText, page);
  if (!surface || !text) return { colors: NEUTRAL_WHEN_COLORS, themed: false };
  const tileFill = mix(surface, text, 0.08);
  const muted = flatten(palette.secondaryText, tileFill ?? surface);
  const barFill = flatten(palette.tertiaryText, surface);
  // The chosen chip wears the brand accent when it stands out from the block
  // (3:1); a dark accent on a dark page does not, so the chip inverts to the
  // page's text colour instead, still in the host's palette.
  const accentFill = flatten(palette.accent, surface);
  const accentStandsOut = accentFill !== null && contrastRatio(accentFill, surface) >= GRAPHIC_MIN_CONTRAST;
  const chipActiveFill = accentStandsOut ? accentFill : text;
  const chipActiveText = accentStandsOut ? flatten(palette.accentText, accentFill) : surface;
  const barActiveFill = themeTextAccent({ ...palette, page: surface });
  if (!tileFill || !muted || !barFill || !chipActiveFill || !chipActiveText) {
    return { colors: NEUTRAL_WHEN_COLORS, themed: false };
  }
  const colors: WhenColors = {
    surface,
    heading: muted,
    text,
    muted,
    tileFill,
    chipFill: tileFill,
    chipActiveFill,
    chipActiveText,
    barFill,
    barActiveFill,
  };
  return whenColorsPass(colors) ? { colors, themed: true } : { colors: NEUTRAL_WHEN_COLORS, themed: false };
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function clock12(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2];
  if (h > 24) return null;
  const hh = h % 24;
  const period = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${min} ${period}`;
}

export interface BrandHourEntry {
  readonly weekday: number;
  readonly openTime: string | null;
  readonly closeTime: string | null;
  readonly isClosed: boolean;
}

/**
 * The host's own published hours (`brand_hours`, weekday 0 = Monday, the page's
 * convention) as the weekday lines the opening-hours parser reads. Null when
 * no day is readable, so the "quieter at" hint hides rather than guesses.
 */
export function brandHoursToWeekdayText(hours: readonly BrandHourEntry[] | null | undefined): string[] | null {
  if (!Array.isArray(hours) || hours.length === 0) return null;
  const lines: string[] = [];
  for (const entry of hours) {
    const day = DAY_NAMES[entry.weekday];
    if (!day) continue;
    if (entry.isClosed) {
      lines.push(`${day}: Closed`);
      continue;
    }
    const open = clock12(entry.openTime);
    const close = clock12(entry.closeTime);
    if (!open || !close) continue;
    lines.push(`${day}: ${open} – ${close}`);
  }
  return lines.length > 0 ? lines : null;
}

/**
 * The typical-crowd curve to use. The deck card's own Mingla category is the
 * better signal when the page was opened from the deck; otherwise the venue's
 * category maps onto the nearest curve (a Stay has none: the default curve).
 */
export function crowdCategoryFor(
  deckCategory: string | null | undefined,
  venueCategory: string | null | undefined,
): string | null {
  if (typeof deckCategory === 'string' && deckCategory.trim().length > 0) return deckCategory;
  switch (venueCategory) {
    case 'restaurant':
      return 'casual_eats';
    case 'play':
      return 'play';
    case 'creative_and_arts':
      return 'creative_arts';
    default:
      return null;
  }
}

export type VenuePrimaryAction = 'reserve' | 'directions';

/**
 * The Explorer bar's main button. Reserve only when ALL of these hold:
 *   - the reservability resolver says reservable (`useVenueReservable`), with
 *     a brand id AND a venue id (the same three conditions as the place sheet);
 *   - the shared page's own gate can open the sheet (`canReserve`).
 * A Stay books through the shared page's Stay rail, whose gate is the page's.
 * Anything else is Directions — never a dead Reserve tap.
 */
export function venuePrimaryAction(input: {
  readonly bookingKind: 'table' | 'stay';
  readonly canReserve: boolean;
  readonly reservable: { reservable: boolean; brand_id: string | null; venue_id: string | null } | null | undefined;
}): VenuePrimaryAction {
  if (!input.canReserve) return 'directions';
  if (input.bookingKind === 'stay') return 'reserve';
  const r = input.reservable;
  return r?.reservable === true && r.brand_id !== null && r.venue_id !== null ? 'reserve' : 'directions';
}
