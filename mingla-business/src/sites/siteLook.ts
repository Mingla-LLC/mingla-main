/**
 * #2829 AD-2 — the model behind the Business "Your look" screen (it mirrors
 * Studio's colour editor). Any colour and any Google font; readability
 * warnings are words only. Setting a swatch stores EXACTLY the colour the
 * owner typed — nothing here nudges a colour toward better contrast.
 *
 * Imports the shared site-contracts directly (like offering-rendering), and
 * only from this screen, so the Business boot bundle never carries them.
 */
import {
  ATELIER,
  designFontSlots,
  designFor,
  designSwatches,
  PRIMARY_SWATCHES,
  type DesignDefinition,
} from "../../../packages/site-contracts/src/designs.ts";
import { normalizeHex, type RampStep } from "../../../packages/site-contracts/src/colorRamp.ts";
import {
  assertOwnerTokenOverrides,
  resolveTokens,
  type OwnerTokenOverrides,
  type RampRole,
  type ResolvedTokens,
  type SingleColorRole,
} from "../../../packages/site-contracts/src/tokens.ts";
import {
  nearestPassingShade,
  readabilityWarnings,
  warningSentence,
  type ReadabilityWarning,
} from "../../../packages/site-contracts/src/readability.ts";
import type { OwnerFontOverrides } from "../../../packages/site-contracts/src/fontSlots.ts";

export type LookSwatch = { label: string; role: SingleColorRole | RampRole; step?: RampStep };

/** All eight primary swatches (spec §W3); the site-contracts registry owns them. */
export const LOOK_SWATCHES: readonly LookSwatch[] = PRIMARY_SWATCHES;

/** The font slots this screen edits (#2829 A8: the accent face too, which voyage draws). */
export type LookFontSlot = "display" | "body" | "accent";

/**
 * #2829 A8 — what the screen shows for a design: only the swatches and font
 * slots that design draws (registry `uses`), never a control that changes
 * nothing. Values stored for hidden roles stay in the overrides untouched.
 */
export function lookControls(
  design: DesignDefinition,
  resolved: ResolvedTokens,
  fonts: OwnerFontOverrides,
): {
  swatches: { swatch: LookSwatch; hex: string }[];
  fontSlots: LookFontSlot[];
  fonts: Record<LookFontSlot, string>;
} {
  return {
    swatches: designSwatches(design).map((swatch) => ({ swatch, hex: swatchHex(resolved, swatch) })),
    fontSlots: designFontSlots(design),
    fonts: { display: slotFamily(design, fonts, "display"), body: slotFamily(design, fonts, "body"), accent: slotFamily(design, fonts, "accent") },
  };
}

/** The look as Studio stores it on site settings. */
export type SiteLookSettings = {
  design?: unknown;
  tokens?: unknown;
  fonts?: unknown;
  updatedAt?: unknown;
};

export function designOfSettings(settings: SiteLookSettings | null): DesignDefinition {
  return designFor(settings?.design) ?? ATELIER;
}

export function safeTokenOverrides(value: unknown): OwnerTokenOverrides {
  try {
    assertOwnerTokenOverrides(value);
    return (value ?? {}) as OwnerTokenOverrides;
  } catch {
    return {};
  }
}

export function safeFontOverrides(value: unknown): OwnerFontOverrides {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as OwnerFontOverrides) : {};
}

export function resolveLook(design: DesignDefinition, tokens: OwnerTokenOverrides): ResolvedTokens {
  return resolveTokens(design.tokens, tokens);
}

export function swatchHex(tokens: ResolvedTokens, swatch: LookSwatch): string {
  const colors = tokens.colors as unknown as Record<string, unknown>;
  const entry = colors[swatch.role];
  return swatch.step === undefined ? String(entry) : String((entry as Record<number, string>)[swatch.step]);
}

/** New overrides with one swatch set exactly; null when the text is not a 6-digit hex. */
export function setSwatch(tokens: OwnerTokenOverrides, swatch: LookSwatch, typed: string): OwnerTokenOverrides | null {
  const hex = normalizeHex(typed.startsWith("#") ? typed : `#${typed}`);
  if (!hex) return null;
  const colors = { ...(tokens.colors ?? {}) } as Record<string, unknown>;
  colors[swatch.role] = swatch.step === undefined ? hex : { seed: hex, steps: { [swatch.step]: hex } };
  return { ...tokens, colors: colors as OwnerTokenOverrides["colors"] };
}

/** "Restore design defaults": no colour overrides (shape presets kept). */
export function restoreColours(tokens: OwnerTokenOverrides): OwnerTokenOverrides {
  const next = { ...tokens };
  delete next.colors;
  delete next.heading_case;
  return next;
}

export type LookWarningRow = { pair: string; sentence: string; suggestion: string | null };

export function lookWarningRows(tokens: ResolvedTokens): LookWarningRow[] {
  return readabilityWarnings(tokens).map((warning) => ({
    pair: warning.pair,
    sentence: warningSentence(warning),
    suggestion: nearestPassingShade(warning.foreground, warning.background, warning.required),
  }));
}

/** The family shown for a slot: the owner's choice, else the design's. */
export function slotFamily(design: DesignDefinition, fonts: OwnerFontOverrides, slot: LookFontSlot): string {
  if (slot === "accent") return fonts.accent?.family ?? design.fonts.accent?.family ?? "";
  return fonts[slot]?.family ?? design.fonts[slot].family;
}

/** Owner-facing sentence for a font fallback Core recorded on the publish receipt. */
export function fontWarningMessage(warning: { slot?: unknown; used?: unknown }): string | null {
  const slot = warning.slot === "display" ? "heading" : warning.slot === "body" ? "body" : warning.slot === "accent" ? "accent" : null;
  if (!slot || typeof warning.used !== "string") return null;
  return `Your ${slot} font couldn’t be loaded, we used ${warning.used} for now.`;
}

/**
 * #2829 W9r (DESIGN_SPEC §3 Colours) — which swatch each readability warning
 * sits under: the text colour for text pairs, the background for band pairs.
 * One warning per swatch (the first in the fixed pair order), only for
 * swatches the design draws, each with a passing shade of THAT swatch to
 * offer. Words only: nothing here changes a colour.
 */
export const PAIR_SWATCH: Readonly<Record<string, { role: string; background: boolean }>> = {
  body_on_canvas: { role: "ink_body", background: false },
  headings_large_on_canvas: { role: "ink_strong", background: false },
  headings_small_on_canvas: { role: "ink_strong", background: false },
  prose_on_canvas: { role: "ink_body", background: false },
  quiet_on_canvas: { role: "ink_body", background: false },
  body_on_tinted: { role: "surface_sunken", background: true },
  accent_label_on_accent: { role: "accent_ink", background: false },
  links_on_canvas: { role: "accent", background: false },
  white_on_dark: { role: "surface_deep", background: true },
  on_dark_body: { role: "surface_deep", background: true },
  eyebrow_plate: { role: "highlight", background: false },
  white_on_highlight: { role: "highlight", background: true },
};

export function swatchWarnings(
  design: DesignDefinition,
  resolved: ResolvedTokens,
): Map<string, { warning: ReadabilityWarning; suggestion: string | null }> {
  const drawn = new Set<string>(designSwatches(design).map((swatch) => swatch.role));
  const out = new Map<string, { warning: ReadabilityWarning; suggestion: string | null }>();
  for (const warning of readabilityWarnings(resolved)) {
    const owner = PAIR_SWATCH[warning.pair];
    if (!owner || !drawn.has(owner.role) || out.has(owner.role)) continue;
    const suggestion = owner.background
      ? nearestPassingShade(warning.background, warning.foreground, warning.required)
      : nearestPassingShade(warning.foreground, warning.background, warning.required);
    out.set(owner.role, { warning, suggestion });
  }
  return out;
}
