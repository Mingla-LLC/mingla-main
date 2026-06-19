/**
 * checkoutBrandAccent — derive the brand-accent hex for the checkout-step CTAs.
 *
 * ORCH-1162 Bug 3 (Q2 RESOLVED, Seth 2026-06-18): the three checkout CTAs (Get
 * tickets → Continue, Your details → Continue, Payment → Pay) must render the
 * brand color from the REAL `theme_color` column — the SAME source the public
 * event/trip page buttons use — NOT `coverHue`. (`theme_color` landed in #507.)
 *
 * The public page CTA color is `createThemePalette(resolveTheme(brand.theme,
 * event.themeOverrides)).accent`, where `brand.theme` is built from the brand's
 * `theme_color` column (publicEventsService `asThemeInput(row.brand_theme_color,
 * …)`) and `event.themeOverrides` from the event's `theme_color_override`. We
 * reuse those EXACT shared resolvers so the checkout button is byte-identical to
 * the public page button (auto contrast-adjusted, accessible on any hue). When
 * neither carries a theme color, resolveTheme falls back to Mingla orange and the
 * Button keeps its default `primary` token — so omit the prop (return null) to
 * preserve the unthemed default during load.
 */
import {
  createThemePalette,
  resolveTheme,
  type ThemeInput,
} from "@mingla/event-rendering";

interface CheckoutAccentInputs {
  brandTheme: ThemeInput | null | undefined;
  eventThemeOverrides: ThemeInput | null | undefined;
}

/**
 * Returns the contrast-resolved brand accent hex matching the public page CTA,
 * or null when no theme color resolves (→ pass undefined to Button → default).
 */
export const resolveCheckoutBrandAccent = (
  inputs: CheckoutAccentInputs,
): string | null => {
  const theme = resolveTheme(inputs.brandTheme, inputs.eventThemeOverrides);
  return createThemePalette(theme).accent;
};
