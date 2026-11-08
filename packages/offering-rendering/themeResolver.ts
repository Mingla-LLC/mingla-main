import {
  FONT_FAMILY_MAP,
  GOOGLE_FONT_FAMILY_MAX,
  GOOGLE_FONT_FAMILY_RE,
  LEGACY_FONT_FAMILY_NAMES,
  MINGLA_DEFAULT_THEME,
  THEME_ANIMATION_SLUGS,
  THEME_FONT_SLUGS,
  type ResolvedTheme,
  type ThemeAnimationSlug,
  type ThemeFontSlug,
  type ThemeFontValue,
  type ThemeInput,
} from "./designTokens";
import { FONT_FAMILY_BOLD_MAP } from "./themePalette";

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export const isThemeFontSlug = (value: unknown): value is ThemeFontSlug =>
  typeof value === "string" &&
  (THEME_FONT_SLUGS as readonly string[]).includes(value);

export const isThemeAnimationSlug = (
  value: unknown,
): value is ThemeAnimationSlug =>
  typeof value === "string" &&
  (THEME_ANIMATION_SLUGS as readonly string[]).includes(value);

export const isThemeColor = (value: unknown): value is string =>
  typeof value === "string" && HEX_COLOR_RE.test(value);

const relativeLuminance = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const sr = r <= 0.03928 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4;
  const sg = g <= 0.03928 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
  const sb = b <= 0.03928 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4;
  return 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
};

export const computeForeground = (
  rawHex: string,
): "#000000" | "#ffffff" => {
  const hex = isThemeColor(rawHex) ? rawHex : MINGLA_DEFAULT_THEME.color;
  return relativeLuminance(hex) > 0.179 ? "#000000" : "#ffffff";
};

/** issue #1023 wave 2 — a Google Fonts family name in the stored shape. */
export const isGoogleFontFamily = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= GOOGLE_FONT_FAMILY_MAX &&
  GOOGLE_FONT_FAMILY_RE.test(value);

/** A saved theme font: a bundled slug or a Google family name. */
export const isThemeFontValue = (value: unknown): value is ThemeFontValue =>
  isThemeFontSlug(value) || isGoogleFontFamily(value);

const LEGACY_SLUG_BY_FAMILY: ReadonlyMap<string, ThemeFontSlug> = new Map(
  (Object.keys(LEGACY_FONT_FAMILY_NAMES) as ThemeFontSlug[]).map((slug) => [
    LEGACY_FONT_FAMILY_NAMES[slug],
    slug,
  ]),
);

/**
 * A family that is one of the 14 bundled fonts ("Inter", spelled as Google
 * spells it) becomes its slug, so it keeps loading from the app bundle with no
 * network request. Anything else is returned unchanged.
 */
export function canonicalThemeFont(value: string): string;
export function canonicalThemeFont(
  value: string | null | undefined,
): string | null | undefined;
export function canonicalThemeFont(
  value: string | null | undefined,
): string | null | undefined {
  if (typeof value !== "string") return value;
  return LEGACY_SLUG_BY_FAMILY.get(value) ?? value;
}

/**
 * The font key a Google family registers under for one weight, for example
 * `GF_Roboto_Slab_500`. Family names never contain `_`, so keys cannot
 * collide.
 */
export const googleFontKey = (family: string, weight: 500 | 700): string =>
  `GF_${family.replace(/ /g, "_")}_${weight}`;

/** The family behind a `GF_` / `GFP_` key, or null for any other key. */
export const familyFromGoogleFontKey = (key: string): string | null => {
  const match = /^GFP?_(.+?)(?:_(?:500|700))?$/.exec(key);
  if (match === null) return null;
  const family = match[1].replace(/_/g, " ");
  return isGoogleFontFamily(family) ? family : null;
};

/** `"#aaaaaa,#bbbbbb"` (lower case) when both stops are valid hex, else null. */
export const gradientToColumn = (
  color: string | null | undefined,
  color2: string | null | undefined,
): string | null =>
  isThemeColor(color) && isThemeColor(color2)
    ? `${color.toLowerCase()},${color2.toLowerCase()}`
    : null;

/**
 * The second stop from a stored gradient — only when the stored pair is valid
 * and its first stop equals this level's colour. A pair whose first stop no
 * longer matches was left behind by a client that changed only the colour, so
 * it reads as solid (stale), never as a gradient nobody chose.
 */
export const color2FromColumn = (
  color: string | null | undefined,
  gradient: string | null | undefined,
): string | null => {
  if (!isThemeColor(color) || typeof gradient !== "string") return null;
  const match = /^(#[0-9a-f]{6}),(#[0-9a-f]{6})$/i.exec(gradient);
  if (match === null) return null;
  return match[1].toLowerCase() === color.toLowerCase() ? match[2] : null;
};

// I-1023-GRADIENT-ONE-UNIT: a gradient is one unit. The second colour always
// comes from the SAME level as the first. An offering's solid colour over a
// brand gradient is solid; a second colour without a first is ignored.
const resolveColor = (
  brandTheme: ThemeInput | null | undefined,
  eventOverride: ThemeInput | null | undefined,
): { color: string; color2: string | null } => {
  if (isThemeColor(eventOverride?.color)) {
    return {
      color: eventOverride.color,
      color2: isThemeColor(eventOverride.color2) ? eventOverride.color2 : null,
    };
  }
  if (isThemeColor(brandTheme?.color)) {
    return {
      color: brandTheme.color,
      color2: isThemeColor(brandTheme.color2) ? brandTheme.color2 : null,
    };
  }
  return { color: MINGLA_DEFAULT_THEME.color, color2: null };
};

const pickFont = (value: unknown): ThemeFontValue | null => {
  if (typeof value !== "string") return null;
  const canonical = canonicalThemeFont(value);
  return isThemeFontValue(canonical) ? canonical : null;
};

const resolveFont = (
  brandTheme: ThemeInput | null | undefined,
  eventOverride: ThemeInput | null | undefined,
): ThemeFontValue =>
  pickFont(eventOverride?.font) ??
  pickFont(brandTheme?.font) ??
  MINGLA_DEFAULT_THEME.font;

const resolveAnimation = (
  brandTheme: ThemeInput | null | undefined,
  eventOverride: ThemeInput | null | undefined,
): ThemeAnimationSlug => {
  if (isThemeAnimationSlug(eventOverride?.animation)) {
    return eventOverride.animation;
  }
  if (isThemeAnimationSlug(brandTheme?.animation)) {
    return brandTheme.animation;
  }
  return MINGLA_DEFAULT_THEME.animation;
};

export const resolveTheme = (
  brandTheme: ThemeInput | null | undefined,
  eventOverride: ThemeInput | null | undefined,
): ResolvedTheme => {
  const { color, color2 } = resolveColor(brandTheme, eventOverride);
  const font = resolveFont(brandTheme, eventOverride);
  const animation = resolveAnimation(brandTheme, eventOverride);
  const legacy = isThemeFontSlug(font);

  return {
    color,
    color2,
    foregroundColor: computeForeground(color),
    font,
    fontFamilyValue: legacy ? FONT_FAMILY_MAP[font] : googleFontKey(font, 500),
    boldFontFamilyValue: legacy
      ? FONT_FAMILY_BOLD_MAP[font]
      : googleFontKey(font, 700),
    animation,
  };
};

/**
 * issue #1023 wave 2 — guards raw theme fields (DB columns or payload keys)
 * into a ThemeInput. A font survives when it is a bundled slug or a Google
 * family name; `color2` survives only from a stored gradient whose first stop
 * equals this level's colour. Returns null when nothing valid is present.
 */
export const themeInputFromFields = (
  color: unknown,
  font: unknown,
  animation: unknown,
  gradient?: unknown,
): ThemeInput | null => {
  const out: ThemeInput = {};
  if (isThemeColor(color)) {
    out.color = color;
    const color2 = color2FromColumn(
      color,
      typeof gradient === "string" ? gradient : null,
    );
    if (color2 !== null) out.color2 = color2;
  }
  if (isThemeFontValue(font)) out.font = canonicalThemeFont(font);
  if (isThemeAnimationSlug(animation)) out.animation = animation;
  return Object.keys(out).length > 0 ? out : null;
};
