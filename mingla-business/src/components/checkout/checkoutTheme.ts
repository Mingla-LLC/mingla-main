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
import {
  createThemePalette,
  resolveTheme,
  type ThemeInput,
  type ThemePalette,
} from "@mingla/offering-rendering";
import {
  inkWash,
  neutralControl,
  neutralHair,
  statusOn,
  themeTextAccent,
} from "@mingla/offering-rendering/themePalette";

import { color as graphite } from "../../constants/designSystem";

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
    lineStrong: neutralControl(palette),
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
let activeTokens: CheckoutColor = graphite;
const tokenCache = new WeakMap<ThemePalette, CheckoutColor>();

/** The active palette (null = Graphite). */
export const activeCheckoutPalette = (): ThemePalette | null => activePalette;

/**
 * Called by a checkout layout during render, before its steps render, with
 * the offering's palette (or null while it loads / for Graphite).
 */
export function setActiveCheckoutPalette(palette: ThemePalette | null): void {
  activePalette = palette;
  if (palette === null) {
    activeTokens = graphite;
    return;
  }
  const cached = tokenCache.get(palette);
  if (cached !== undefined) {
    activeTokens = cached;
    return;
  }
  const tokens = checkoutColorFor(palette);
  tokenCache.set(palette, tokens);
  activeTokens = tokens;
}

/** designSystem `color`'s shape, read against the active palette. */
export const color: CheckoutColor = new Proxy({} as CheckoutColor, {
  get: (_target, key: string | symbol) =>
    (activeTokens as Record<string | symbol, unknown>)[key],
  ownKeys: () => Reflect.ownKeys(activeTokens),
  getOwnPropertyDescriptor: (_target, key) => {
    const tokens = activeTokens as Record<string | symbol, unknown>;
    return key in tokens
      ? { configurable: true, enumerable: true, value: tokens[key] }
      : undefined;
  },
});

/**
 * A module-scope stylesheet whose colours follow the active palette. The
 * factory runs once per palette (cached); reading a style key returns the
 * sheet for the palette that is active NOW.
 */
export function checkoutStyles<T extends object>(factory: () => T): T {
  const byTokens = new WeakMap<object, T>();
  const current = (): T => {
    const hit = byTokens.get(activeTokens);
    if (hit !== undefined) return hit;
    const built = factory();
    byTokens.set(activeTokens, built);
    return built;
  };
  return new Proxy({} as T, {
    get: (_target, key: string | symbol) =>
      (current() as Record<string | symbol, unknown>)[key],
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_target, key) => {
      const sheet = current() as Record<string | symbol, unknown>;
      return key in sheet
        ? { configurable: true, enumerable: true, value: sheet[key] }
        : undefined;
    },
  });
}
