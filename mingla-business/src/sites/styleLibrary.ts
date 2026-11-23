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
import { DESIGN_KEYS, DESIGNS, type DesignKey } from "../../../packages/site-contracts/src/designs.ts";
import {
  STYLE_AVOID_WARNING,
  STYLE_KEYS,
  styleFormat,
  styleFitLevel,
  styleFitReason,
  type FormatKey,
  type StyleFitLevel,
} from "../../../packages/site-contracts/src/formats.ts";
import { mainActionPage } from "../../../packages/site-contracts/src/sitePlan.ts";
import type { SitePlanState } from "./sitePlanState";

const BEFORE_LIBRARY: readonly DesignKey[] = ["atelier", "voyage"];

export function lookPickerKeys(styleLibrary: boolean, current: string | null | undefined): DesignKey[] {
  const offered: readonly DesignKey[] = styleLibrary ? STYLE_KEYS : BEFORE_LIBRARY;
  const inUse = DESIGN_KEYS.find((key) => key === current);
  return inUse && !offered.includes(inUse) ? [inUse, ...offered] : [...offered];
}

export function planFormatOf(plan: { offeringsSelected: string[] | null; story: { main_action?: string } | null } | null | undefined): FormatKey | null {
  if (!plan) return null;
  // #4572 item 6 — styles are judged by the style format (a gallery stays art).
  return styleFormat({
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

/**
 * #4453 — why the picked style can't be previewed live in "Choose your
 * design", or null when it can (Core's plan-previews route with that style).
 */
export function stylePreviewBlocker(planState: Pick<SitePlanState, "planPreview" | "plan">, style: DesignKey | null): string | null {
  if (!style) return "Pick a style to see your site in it.";
  if (!planState.planPreview) return "Live previews aren't on for this brand yet. You'll see your pages after Build your pages.";
  const format = planFormatOf(planState.plan);
  if (!format || planState.plan?.revision == null) return "Answer What you'll offer and Your story first, so Ari knows which pages to lay out.";
  // Core refuses an "avoid" style: it is never composed for this kind of place.
  if (styleFitLabel(format, style)?.fit === "avoid") return `${DESIGNS[style].label} is built for other kinds of places, so there's no preview of it for your site.`;
  return null;
}
