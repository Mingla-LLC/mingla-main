/**
 * checkoutTheme — #4420 D-C1: checkout wears the HOST's colours.
 *
 * Every checkout step (event, experience, trip), the buyer cancel page and the
 * shared checkout parts read their colours through `color` from THIS module
 * instead of designSystem's Graphite `color`, and build their stylesheets with
 * `checkoutStyles(() => StyleSheet.create({ … }))`. The two have the same
 * shape and the same key names, so a step's layout, spacing, copy and money
 * logic are untouched: only which hex a token names changes.
 *
 * WHERE THE PALETTE COMES FROM. The flow's layout resolves the offering's own
 * theme with the SAME resolvers the public page uses
 * (`createThemePalette(resolveTheme(brand.theme, offering.themeOverrides))`)
 * and hands it to `useActiveCheckoutPalette` during render, so the checkout
 * reads as the same page as the offering it sells. Until a palette is set —
 * any screen outside a checkout scope, every existing render test — `color`
 * IS designSystem's Graphite `color`, value for value.
 *
 * WHY A SCOPE VALUE AND NOT A PROP. Twenty files build their styles at module
 * scope. Threading a palette prop through each of them would rewrite every
 * StyleSheet into a hook; instead the tokens and the sheets resolve against
 * the one active palette when they are read, cached per palette. Only one
 * checkout is ever on screen, and its layout is the single writer.
 *
 * D-C1 stays reversible behind `CHECKOUT_USES_HOST_PALETTE`.
 */
// Deep imports, not the package barrel: the barrel drags every offering
// component (ParallaxCoverShell, video, svg) into each checkout step's graph,
// and checkout only needs the theme resolvers.
import type {
  ResolvedTheme,
  ThemeInput,
} from "@mingla/offering-rendering/designTokens";
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";
import {
  accentFill,
  themeBoldFace,
} from "@mingla/offering-rendering/themeAccentStyle";
import {
  createThemePalette,
  inkWash,
  neutralControl,
  neutralHair,
  statusOn,
  themeTextAccent,
  type ThemePalette,
} from "@mingla/offering-rendering/themePalette";

import { color as graphite } from "../../constants/designSystem";
import { contrastRatio, mixHex, normalizeHex } from "../../utils/buttonAccentContrast";
import {
  color as surfaceColor,
  materials as surfaceMaterials,
  setActiveSurfaceTokens,
  solidSurfaceMaterials,
  themed,
  themedStyles,
  type SurfaceTokens,
} from "../../theme/surfaceTokens";

/** #4420 D-C1 — false puts every checkout back on Graphite. */
export const CHECKOUT_USES_HOST_PALETTE = true;

type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : { readonly [K in keyof T]: Widen<T[K]> };

/** designSystem's `color`, with every value a plain string (host hexes). */
export type CheckoutColor = Widen<typeof graphite>;

const wash = inkWash;

/** WCAG 1.4.11: a field outline needs 3:1 against the page it sits on. */
export const CHECKOUT_OUTLINE_MIN_CONTRAST = 3;

/**
 * #4518 — the outline of a field, a stepper ring or a quiet button, as an
 * opaque colour that reaches 3:1 on THIS host page. `neutralControl` is one
 * fixed 34 % wash; on a near-black host page that measured 2.16:1, so a
 * buyer could not see where the name and email fields were. Here the page's
 * ink is mixed in until the boundary is met.
 */
export function checkoutOutlineFor(palette: ThemePalette): string {
  const page = normalizeHex(palette.page);
  const ink = normalizeHex(palette.primaryText);
  if (page === null || ink === null) return neutralControl(palette);
  for (let amount = 0.34; amount < 1; amount += 0.04) {
    const candidate = mixHex(page, ink, amount);
    if (contrastRatio(candidate, page) >= CHECKOUT_OUTLINE_MIN_CONTRAST) return candidate;
  }
  return ink;
}

/**
 * The Graphite token set, re-pointed at a host palette. Text accents take the
 * theme's first colour (never the gradient, #1023); status colours come from
 * `statusOn` (the same values as designSystem's, per page brightness).
 */
export function checkoutColorFor(palette: ThemePalette): CheckoutColor {
  const status = statusOn(palette);
  const accent = themeTextAccent(palette);
  return {
    ...graphite,
    canvas: palette.page,
    card: palette.card,
    card2: palette.panelStrong,
    card3: palette.panelStrong,
    line: neutralHair(palette),
    lineStrong: checkoutOutlineFor(palette),
    text1: palette.primaryText,
    text2: palette.secondaryText,
    text3: palette.tertiaryText,
    text4: palette.tertiaryText,
    textStrong: palette.primaryText,
    // The "paper" button is the page's ink: ink fill, page-coloured text.
    paper: palette.primaryText,
    paperEnd: palette.primaryText,
    paperPressed: palette.secondaryText,
    ink: palette.page,
    accent,
    accentText: accent,
    onAccent: palette.accentText,
    accentTint: palette.accentWash,
    accentLine: palette.panelBorder,
    focus: palette.primaryText,
    danger: status.error.text,
    errorText: status.error.text,
    errorTint: status.error.tint,
    errorLine: status.error.line,
    success: status.success.text,
    successText: status.success.text,
    successTint: status.success.tint,
    warning: status.warning.text,
    warningText: status.warning.text,
    warningTint: status.warning.tint,
    skeleton: wash(palette, 0.06),
    skeletonHi: wash(palette, 0.1),
    fill: {
      ...graphite.fill,
      tableHead: wash(palette, 0.025),
      rowHover: wash(palette, 0.035),
      inset: wash(palette, 0.045),
      tile: wash(palette, 0.06),
      status: wash(palette, 0.06),
      quietHover: wash(palette, 0.06),
      railOn: wash(palette, 0.09),
      tabOn: wash(palette, 0.1),
      step: wash(palette, 0.12),
      pager: wash(palette, 0.28),
      pagerOn: palette.primaryText,
      handle: wash(palette, 0.3),
      pressed: wash(palette, 0.08),
      input: wash(palette, 0.045),
      inputDisabled: wash(palette, 0.025),
    },
  };
}

/**
 * #4420 wave 2 — the offering's resolved theme (for the host's title face),
 * resolved exactly as its public page resolves it.
 */
export function resolveCheckoutTheme(input: {
  brandTheme: ThemeInput | null | undefined;
  offeringThemeOverrides: ThemeInput | null | undefined;
}): ResolvedTheme | null {
  if (!CHECKOUT_USES_HOST_PALETTE) return null;
  return resolveTheme(input.brandTheme ?? null, input.offeringThemeOverrides ?? null);
}

/** The offering's palette, resolved exactly as its public page resolves it. */
export function resolveCheckoutPalette(input: {
  brandTheme: ThemeInput | null | undefined;
  offeringThemeOverrides: ThemeInput | null | undefined;
}): ThemePalette | null {
  if (!CHECKOUT_USES_HOST_PALETTE) return null;
  return createThemePalette(
    resolveTheme(input.brandTheme ?? null, input.offeringThemeOverrides ?? null),
  );
}

// ---- the one active palette ------------------------------------------------

let activePalette: ThemePalette | null = null;
const tokenCache = new WeakMap<ThemePalette, SurfaceTokens>();

/** The active palette (null = Graphite). */
export const activeCheckoutPalette = (): ThemePalette | null => activePalette;

let activeTheme: ResolvedTheme | null = null;

/** Set beside the palette by the flow's layout (null = Graphite). */
export function setActiveCheckoutTheme(theme: ResolvedTheme | null): void {
  activeTheme = theme;
}

/**
 * #4420 wave 2 (spec §0.1) — the host's bold face for host-owned titles (the
 * offering strip, "You're in.", "Your total changed"). Graphite: no face, so
 * the platform system font draws them exactly as before.
 */
export const checkoutTitleFace = (): {
  fontFamily?: string;
  fontWeight?: "normal";
} => (activeTheme === null ? {} : themeBoldFace(activeTheme));

/**
 * #4420 wave 2 — the accent FILL (gradient-aware, #1023) for the success disc
 * and the primary button. Graphite: the Graphite accent, solid.
 */
export const checkoutAccentFill = (): { backgroundColor: string } =>
  activePalette === null ? { backgroundColor: graphite.accent } : accentFill(activePalette);

/** The colour drawn on the accent fill (white or ink, WCAG-picked). */
export const checkoutOnAccent = (): string =>
  activePalette === null ? graphite.textStrong : activePalette.accentText;

/**
 * Called by a checkout layout during render, before its steps render, with
 * the offering's palette (or null while it loads / for Graphite).
 *
 * #4518 — this is the SINGLE WRITER of the app's surface tokens. It sets the
 * text tokens and the surface materials together, from one palette, so the
 * shared building blocks (cards, fields, buttons, the dock) can never paint a
 * Graphite surface under host-coloured text again.
 */
export function setActiveCheckoutPalette(palette: ThemePalette | null): void {
  activePalette = palette;
  if (palette === null) {
    setActiveSurfaceTokens(null);
    return;
  }
  const cached = tokenCache.get(palette);
  if (cached !== undefined) {
    setActiveSurfaceTokens(cached);
    return;
  }
  const tokens = checkoutSurfaceTokensFor(palette);
  tokenCache.set(palette, tokens);
  setActiveSurfaceTokens(tokens);
}

/** The host palette as one token set: text colours plus the surfaces under them. */
export function checkoutSurfaceTokensFor(palette: ThemePalette): SurfaceTokens {
  const tokens = checkoutColorFor(palette);
  return {
    color: tokens,
    materials: solidSurfaceMaterials({
      pane: tokens.card,
      control: tokens.card2,
      selected: tokens.card3,
      chrome: tokens.canvas,
      liquid: tokens.card2,
      sheet: tokens.card,
      edge: tokens.line,
      edgeStrong: tokens.lineStrong,
    }),
  };
}

/** designSystem `color`'s shape, read against the active palette. */
export const color: CheckoutColor = surfaceColor;

/** designSystem `materials`' shape, read against the active palette (#4518). */
export const materials = surfaceMaterials;

/**
 * A module-scope stylesheet whose colours follow the active palette. The
 * factory runs once per palette (cached); reading a style key returns the
 * sheet for the palette that is active NOW.
 */
export const checkoutStyles = themedStyles;

/**
 * #4518 — a module-scope VALUE (a colour record handed to a shared part) that
 * follows the active palette. A plain `const X = { accent: color.accent }` is
 * read once at import and freezes whichever palette was active then: that is
 * how the ticket rows stayed white-on-dark on a light host page.
 */
export const checkoutValue = themed;
