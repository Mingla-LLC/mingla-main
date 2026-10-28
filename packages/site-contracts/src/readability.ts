/**
 * #2829 AD-2 — readability WARNINGS for a site's colours.
 *
 * Seth's decision: an owner may choose any colour. Mingla tells them, in plain
 * English, where text would be hard to read — in Studio, in the Business
 * "Your look" screen and in Ari's replies — and that is all it does. A warning
 * NEVER blocks save, preview or publish and NEVER changes a colour. There is no
 * "nudge toward contrast" anywhere in Sites; the closest passing shade is only
 * ever SHOWN beside the owner's choice for them to pick or ignore.
 *
 * The contrast maths is copied from packages/offering-rendering/themePalette.ts
 * (`relativeLuminance`, `contrastRatio`) because this package must stay
 * dependency-free; a parity test proves the copy returns the same ratios.
 */
import { hexToRgb, isHex, type Hex } from "./colorRamp.ts";
import type { ResolvedTokens } from "./tokens.ts";

const linearizeSrgb = (channel: number): number => {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (hex: string): number => {
  const { r, g, b } = hexToRgb(hex);
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

/** A token reference: a single role, a ramp step, or plain white. */
export type ColorRef = string;

export type ReadabilityPair = {
  id: string;
  foreground: ColorRef;
  background: ColorRef;
  required: number;
  /** Where this pairing appears, in the owner's words. */
  where: string;
};

/** The fixed pair list (spec §W3). Order is the order warnings are listed. */
export const READABILITY_PAIRS: readonly ReadabilityPair[] = [
  { id: "body_on_canvas", foreground: "ink_body", background: "canvas", required: 4.5, where: "Body text on your page background" },
  { id: "headings_large_on_canvas", foreground: "ink_strong", background: "canvas", required: 3, where: "Large headings on your page background" },
  { id: "headings_small_on_canvas", foreground: "ink_strong", background: "canvas", required: 4.5, where: "Small headings on your page background" },
  { id: "prose_on_canvas", foreground: "ink_prose", background: "canvas", required: 4.5, where: "Long-form writing on your page background" },
  { id: "quiet_on_canvas", foreground: "ink_quiet", background: "canvas", required: 4.5, where: "Captions and small print on your page background" },
  { id: "body_on_tinted", foreground: "ink_body", background: "surface_sunken", required: 4.5, where: "Body text on tinted bands" },
  { id: "accent_label_on_accent", foreground: "accent_ink", background: "accent.400", required: 4.5, where: "Button labels on your accent colour" },
  { id: "links_on_canvas", foreground: "action", background: "canvas", required: 4.5, where: "Links on your page background" },
  { id: "white_on_dark", foreground: "white", background: "surface_deep", required: 4.5, where: "White text on dark panels" },
  { id: "on_dark_body", foreground: "ink_on_dark_body", background: "surface_deep", required: 4.5, where: "Body text on dark panels" },
  { id: "eyebrow_plate", foreground: "highlight.700", background: "highlight.50", required: 4.5, where: "Small labels on highlight plates" },
  { id: "white_on_highlight", foreground: "white", background: "highlight.700", required: 4.5, where: "White text on your second accent" },
];

export type ReadabilityWarning = {
  pair: string;
  foreground: Hex;
  background: Hex;
  /** Rounded to two decimals for display; the comparison uses the exact ratio. */
  ratio: number;
  required: number;
  where: string;
};

/** The hex a reference names in resolved tokens, or null when absent. */
export function colorOf(tokens: ResolvedTokens, ref: ColorRef): Hex | null {
  if (ref === "white") return "#ffffff";
  const colors = tokens.colors as unknown as Record<string, unknown>;
  const [role, step] = ref.split(".");
  const value = step === undefined
    ? colors[role!]
    : (colors[role!] as Record<string, unknown> | undefined)?.[step];
  return isHex(value) ? value : null;
}

/**
 * Every failing pair, in list order. Pure: it reads the tokens and returns
 * words. It has no way to write a colour back, by construction.
 */
export function readabilityWarnings(tokens: ResolvedTokens): ReadabilityWarning[] {
  const warnings: ReadabilityWarning[] = [];
  for (const pair of READABILITY_PAIRS) {
    const foreground = colorOf(tokens, pair.foreground);
    const background = colorOf(tokens, pair.background);
    if (!foreground || !background) continue;
    const ratio = contrastRatio(foreground, background);
    if (ratio < pair.required) {
      warnings.push({
        pair: pair.id,
        foreground,
        background,
        ratio: Math.round(ratio * 100) / 100,
        required: pair.required,
        where: pair.where,
      });
    }
  }
  return warnings;
}

/**
 * A SUGGESTION to show beside a warning: the first shade of the owner's own
 * text colour (moving toward black or white, whichever the background needs)
 * that would pass. Returned for display only — nothing in Sites applies it;
 * the owner chooses.
 */
export function nearestPassingShade(foreground: Hex, background: Hex, required: number): Hex | null {
  if (!isHex(foreground) || !isHex(background)) return null;
  if (contrastRatio(foreground, background) >= required) return foreground;
  const towardWhite = relativeLuminance(background) < 0.18;
  const target = towardWhite ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  const from = hexToRgb(foreground);
  for (let step = 1; step <= 20; step += 1) {
    const weight = step / 20;
    const mixed = [from.r, from.g, from.b].map((channel, index) => {
      const goal = [target.r, target.g, target.b][index]!;
      return Math.round(channel + (goal - channel) * weight).toString(16).padStart(2, "0");
    });
    const candidate = `#${mixed.join("")}`;
    if (contrastRatio(candidate, background) >= required) return candidate;
  }
  return null;
}

/** "Body text on your page background is hard to read (2.1:1; aim for 4.5:1)." */
export function warningSentence(warning: ReadabilityWarning): string {
  return `${warning.where} is hard to read (${warning.ratio.toFixed(1)}:1; aim for ${warning.required}:1).`;
}
