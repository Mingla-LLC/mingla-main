import {
  assertOwnerFontOverrides,
  type OwnerFontOverrides,
} from "../contracts/generated/fontSlots.ts";
import {
  assertOwnerTokenOverrides,
  BUTTON_SHAPES,
  MOTION_PRESETS,
  RADIUS_PRESETS,
  type OwnerTokenOverrides,
} from "../contracts/generated/tokens.ts";
import { findCatalogFont } from "../contracts/generated/fontCatalog.ts";

/*
 * #2829 AD-2 — a site's look as Studio stores it: the design, the owner's
 * token choices (`tokens` = colours + heading case), the shape and motion
 * presets, and the font family per slot. Everything here is validated by the
 * shared site-contracts rules, so Studio, Ari and the Business app can store
 * only values of fixed types (never CSS), and the builder resolves them the
 * same way every time.
 */

type Settings = Record<string, unknown> | null | undefined;

/** The owner's token overrides, as stored (invalid stored data is ignored, never half-applied). */
export function ownerTokensOf(settings: Settings): OwnerTokenOverrides {
  const stored = settings?.tokens;
  const out: OwnerTokenOverrides = {};
  try {
    assertOwnerTokenOverrides(stored);
    if (stored && typeof stored === "object") Object.assign(out, stored);
  } catch {
    // Studio validates on save; an invalid stored value means "design defaults".
  }
  const radius = settings?.radius;
  const buttonShape = settings?.button_shape;
  const motion = settings?.motion;
  if ((RADIUS_PRESETS as readonly unknown[]).includes(radius)) out.radius = radius as OwnerTokenOverrides["radius"];
  if ((BUTTON_SHAPES as readonly unknown[]).includes(buttonShape)) out.button_shape = buttonShape as OwnerTokenOverrides["button_shape"];
  if ((MOTION_PRESETS as readonly unknown[]).includes(motion)) out.motion = motion as OwnerTokenOverrides["motion"];
  return out;
}

/** The owner's font choices, as stored (families outside the catalogue are ignored). */
export function ownerFontsOf(settings: Settings): OwnerFontOverrides {
  const stored = settings?.fonts;
  try {
    assertOwnerFontOverrides(stored);
  } catch {
    return {};
  }
  const out: OwnerFontOverrides = {};
  for (const key of ["display", "body", "accent"] as const) {
    const choice = (stored as OwnerFontOverrides | null | undefined)?.[key];
    if (choice === null && key === "accent") out.accent = null;
    else if (choice && (choice.source === "system" || findCatalogFont(choice.family))) out[key] = choice;
  }
  return out;
}

/** Payload field validator for the `tokens` JSON (plain-English refusal). */
export function validateTokensField(value: unknown): true | string {
  try {
    assertOwnerTokenOverrides(value);
    return true;
  } catch (error) {
    const path = error instanceof Error ? error.message.replace("TOKENS_INVALID:", "") : "tokens";
    return `That colour setting is not valid (${path}). Use six-digit colours like #1a2b3c.`;
  }
}

/** Payload field validator for the `fonts` JSON: catalogue families only. */
export function validateFontsField(value: unknown): true | string {
  try {
    assertOwnerFontOverrides(value);
  } catch {
    return "Choose fonts from the font list.";
  }
  for (const key of ["display", "body", "accent"] as const) {
    const choice = (value as OwnerFontOverrides | null | undefined)?.[key];
    if (choice && choice.source === "google" && !findCatalogFont(choice.family)) {
      return `${choice.family} is not in the Google Fonts list.`;
    }
  }
  return true;
}
