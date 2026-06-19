/**
 * buttonAccentContrast — pure WCAG-contrast helpers for the Button primitive's
 * optional brand-accent override (ORCH-1162 Bug 3). Extracted from Button.tsx so
 * the contrast/label logic is unit-testable (no RN import). Mirrors the proven
 * logic in packages/event-rendering/themePalette.ts (relativeLuminance +
 * contrastRatio + readableTextFor). I-PROPOSED-1162-CHECKOUT-CTA-BRAND-THEMED.
 */
const HEX6 = /^[0-9a-fA-F]{6}$/;
const HEX3 = /^[0-9a-fA-F]{3}$/;

/** Validate + normalize a hex string to lowercase "#rrggbb"; null if invalid. */
export const normalizeHex = (raw: string): string | null => {
  const s = raw.replace(/^#/, "").trim();
  if (HEX6.test(s)) return `#${s.toLowerCase()}`;
  if (HEX3.test(s)) {
    const [r, g, b] = s.split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
};

const parseChannels = (hex: string): { r: number; g: number; b: number } => {
  const s = hex.replace(/^#/, "");
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
};

const linearizeSrgb = (channel: number): number => {
  const n = channel / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (hex: string): number => {
  const { r, g, b } = parseChannels(hex);
  return (
    0.2126 * linearizeSrgb(r) +
    0.7152 * linearizeSrgb(g) +
    0.0722 * linearizeSrgb(b)
  );
};

export const contrastRatio = (a: string, b: string): number => {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
};

/** Max-contrast label color (#000 or #fff) for an arbitrary background hex. */
export const readableTextFor = (background: string): "#000000" | "#ffffff" =>
  contrastRatio("#000000", background) >= contrastRatio("#ffffff", background)
    ? "#000000"
    : "#ffffff";

/** Blend two hex colors by `amount` (0..1) toward `b` — used for the web hover. */
export const mixHex = (a: string, b: string, amount: number): string => {
  const ca = parseChannels(a);
  const cb = parseChannels(b);
  const ch = (x: number, y: number): string =>
    Math.round(x + (y - x) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(ca.r, cb.r)}${ch(ca.g, cb.g)}${ch(ca.b, cb.b)}`;
};
