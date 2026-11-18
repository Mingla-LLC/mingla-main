/**
 * #4453 milestone 7 — which website styles the Business look pickers offer.
 *
 * SITES_STYLE_LIBRARY (Core's value for this brand, on the plan read) gates
 * OFFERING the ten styles; it never changes how a stored design draws. Off:
 * Atelier and Voyage, as before. On: the ten styles, each with its fixed fit
 * for the brand's format. An owner may pick any style; an "avoid" pick shows
 * the fixed warning and still saves (D6). A design already in use is always
 * listed, so switching away is never forced.
 */
import { DESIGN_KEYS, type DesignKey } from "../../../packages/site-contracts/src/designs.ts";
import {
  STYLE_AVOID_WARNING,
  STYLE_KEYS,
  primaryFormat,
  styleFitLevel,
  styleFitReason,
  type FormatKey,
  type StyleFitLevel,
} from "../../../packages/site-contracts/src/formats.ts";
import { mainActionPage } from "../../../packages/site-contracts/src/sitePlan.ts";

const BEFORE_LIBRARY: readonly DesignKey[] = ["atelier", "voyage"];

export function lookPickerKeys(styleLibrary: boolean, current: string | null | undefined): DesignKey[] {
  const offered: readonly DesignKey[] = styleLibrary ? STYLE_KEYS : BEFORE_LIBRARY;
  const inUse = DESIGN_KEYS.find((key) => key === current);
  return inUse && !offered.includes(inUse) ? [inUse, ...offered] : [...offered];
}

export function planFormatOf(plan: { offeringsSelected: string[] | null; story: { main_action?: string } | null } | null | undefined): FormatKey | null {
  if (!plan) return null;
  return primaryFormat({
    offerings_selected: plan.offeringsSelected ?? [],
    main_action_page: mainActionPage(plan.story?.main_action ?? null, plan.offeringsSelected ?? []),
  });
}

export type StyleFitLabel = { fit: StyleFitLevel; label: string; reason: string; warning: string | null };

/** The fit chip, the fixed reason and (for "avoid") the fixed warning; null without a format or for Atelier. */
export function styleFitLabel(format: FormatKey | null, key: DesignKey): StyleFitLabel | null {
  if (!format || !(STYLE_KEYS as readonly string[]).includes(key)) return null;
  const fit = styleFitLevel(format, key);
  return {
    fit,
    label: fit === "pick" ? "Ari's pick" : fit === "fits" ? "Fits" : "Built for other places",
    reason: styleFitReason(format, key),
    warning: fit === "avoid" ? STYLE_AVOID_WARNING : null,
  };
}
