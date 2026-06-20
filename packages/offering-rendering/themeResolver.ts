import {
  FONT_FAMILY_MAP,
  MINGLA_DEFAULT_THEME,
  THEME_ANIMATION_SLUGS,
  THEME_FONT_SLUGS,
  type ResolvedTheme,
  type ThemeAnimationSlug,
  type ThemeFontSlug,
  type ThemeInput,
} from "./designTokens";

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

const resolveColor = (
  brandTheme: ThemeInput | null | undefined,
  eventOverride: ThemeInput | null | undefined,
): string => {
  if (isThemeColor(eventOverride?.color)) return eventOverride.color;
  if (isThemeColor(brandTheme?.color)) return brandTheme.color;
  return MINGLA_DEFAULT_THEME.color;
};

const resolveFont = (
  brandTheme: ThemeInput | null | undefined,
  eventOverride: ThemeInput | null | undefined,
): ThemeFontSlug => {
  if (isThemeFontSlug(eventOverride?.font)) return eventOverride.font;
  if (isThemeFontSlug(brandTheme?.font)) return brandTheme.font;
  return MINGLA_DEFAULT_THEME.font;
};

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
  const color = resolveColor(brandTheme, eventOverride);
  const font = resolveFont(brandTheme, eventOverride);
  const animation = resolveAnimation(brandTheme, eventOverride);

  return {
    color,
    foregroundColor: computeForeground(color),
    font,
    fontFamilyValue: FONT_FAMILY_MAP[font],
    animation,
  };
};
