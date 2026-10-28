import {
  ATELIER,
  designDrawsColor,
  designFontSlots,
  designFor,
  designSwatches,
  PRIMARY_SWATCHES,
  type DesignDefinition,
  type PrimarySwatch,
} from "../../contracts/generated/designs.ts";
import type { FontSlotKey } from "../../contracts/generated/fontSlots.ts";
import { normalizeHex, type RampStep } from "../../contracts/generated/colorRamp.ts";
import {
  assertOwnerTokenOverrides,
  RAMP_ROLE_STEPS,
  RAMP_ROLES,
  resolveTokens,
  SINGLE_COLOR_ROLES,
  type OwnerTokenOverrides,
  type RampRole,
  type ResolvedTokens,
  type SingleColorRole,
} from "../../contracts/generated/tokens.ts";
import {
  nearestPassingShade,
  readabilityWarnings,
  warningSentence,
  type ReadabilityWarning,
} from "../../contracts/generated/readability.ts";

/*
 * #2829 AD-2 — the pure model behind Studio's colour editor (and mirrored by
 * the Business "Your look" screen): which swatches exist, what setting one
 * stores, what the owner's choices resolve to, and the readability warnings.
 * Setting a colour stores EXACTLY that colour; warnings are words only.
 */

export type Swatch = PrimarySwatch;

/** The eight primary swatches (spec §W3), in order; the registry owns them. */
export { PRIMARY_SWATCHES };

export function designOf(key: unknown): DesignDefinition {
  return designFor(key) ?? ATELIER;
}

/** #2829 A8 — the primary swatches the chosen design draws (registry `uses`). */
export function swatchesFor(designKey: unknown): Swatch[] {
  return designSwatches(designOf(designKey));
}

/** #2829 A8 — every colour behind "All colours" that the chosen design draws. */
export function allColoursFor(designKey: unknown): Swatch[] {
  const design = designOf(designKey);
  const out: Swatch[] = [];
  for (const role of SINGLE_COLOR_ROLES as readonly SingleColorRole[]) {
    if (designDrawsColor(design, role)) out.push({ label: role.replace(/_/g, " "), role });
  }
  for (const role of RAMP_ROLES as RampRole[]) {
    for (const step of RAMP_ROLE_STEPS[role] as readonly RampStep[]) {
      if (designDrawsColor(design, role, step)) out.push({ label: `${role.replace(/_/g, " ")} ${step}`, role, step });
    }
  }
  return out;
}

/** #2829 A8 — the font slots the chosen design draws. */
export function fontSlotsFor(designKey: unknown): FontSlotKey[] {
  return designFontSlots(designOf(designKey));
}

/** Stored overrides, or none when the stored value is not valid. */
export function safeOverrides(value: unknown): OwnerTokenOverrides {
  try {
    assertOwnerTokenOverrides(value);
    return (value ?? {}) as OwnerTokenOverrides;
  } catch {
    return {};
  }
}

export function resolvedLook(designKey: unknown, value: unknown): ResolvedTokens {
  return resolveTokens(designOf(designKey).tokens, safeOverrides(value));
}

export function swatchValue(tokens: ResolvedTokens, swatch: Swatch): string {
  const colors = tokens.colors as unknown as Record<string, unknown>;
  const entry = colors[swatch.role];
  return swatch.step === undefined ? String(entry) : String((entry as Record<number, string>)[swatch.step]);
}

/**
 * The overrides after the owner sets one swatch. A primary ramp swatch sets
 * the role's seed (the rest of the ramp regenerates) AND pins the exact
 * colour at its step; a single role is stored as typed. Returns null for
 * anything that is not a 6-digit hex (nothing is stored).
 */
export function withColor(
  value: unknown,
  swatch: Swatch,
  typed: string,
  mode: "seed" | "step" = "seed",
): OwnerTokenOverrides | null {
  const hex = normalizeHex(typed);
  if (!hex) return null;
  const next = structuredClone(safeOverrides(value));
  const colors = { ...(next.colors ?? {}) } as Record<string, unknown>;
  if (swatch.step === undefined) colors[swatch.role] = hex;
  else if (mode === "seed") colors[swatch.role] = { seed: hex, steps: { [swatch.step]: hex } };
  else {
    const current = (colors[swatch.role] ?? {}) as { seed?: string; steps?: Record<string, string> };
    colors[swatch.role] = { ...current, steps: { ...(current.steps ?? {}), [swatch.step]: hex } };
  }
  next.colors = colors as OwnerTokenOverrides["colors"];
  return next;
}

/** "Restore design defaults": no colour overrides at all (byte-identical defaults). */
export function restoredDefaults(value: unknown): OwnerTokenOverrides {
  const { colors: _colors, heading_case: _case, ...rest } = safeOverrides(value);
  void _colors;
  void _case;
  return rest;
}

export type LookWarning = ReadabilityWarning & { sentence: string; suggestion: string | null };

export function lookWarnings(tokens: ResolvedTokens): LookWarning[] {
  return readabilityWarnings(tokens).map((warning) => ({
    ...warning,
    sentence: warningSentence(warning),
    suggestion: nearestPassingShade(warning.foreground, warning.background, warning.required),
  }));
}
