/**
 * surfaceTokens — #4518: ONE colour owner for every painted surface.
 *
 * The shared building blocks (Material, GlassChrome, Button, Input, Toast,
 * EmptyState, IconChrome, WebDateTimeInput, Icon) read `color` and `materials`
 * from THIS module, not from `constants/designSystem`. With nothing set, both
 * ARE designSystem's Graphite values, key for key, so the Host app paints
 * exactly as before.
 *
 * A checkout flow sets a host palette here (through `checkoutTheme.ts`, the
 * single writer). From that moment the text AND the surfaces under it come
 * from the same token set, so they cannot disagree. That disagreement is the
 * #4518 defect: checkout text followed the host palette while cards, fields,
 * buttons and the dock stayed on Graphite, which put dark ink on dark boxes
 * and white input text on a light page.
 *
 * WHY A MODULE VALUE AND NOT REACT CONTEXT. The blocks build their styles at
 * module scope, and #4420 already resolves checkout colours against one
 * active palette set by the flow's layout during render. This extends that
 * one mechanism to the surfaces instead of adding a second one beside it.
 */
import {
  color as graphiteColor,
  materials as graphiteMaterials,
} from "../constants/designSystem";
import type { MaterialKind, MaterialRecipe } from "../constants/designSystem";

type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : { readonly [K in keyof T]: Widen<T[K]> };

/**
 * designSystem's `color`, with every value a plain string (host hexes), plus
 * #4518 `controlOutline`: the 1px outline of a quiet control (a secondary
 * button, the inline access notice) that reaches 3:1 against `card`.
 * `lineStrong` cannot do it (13 % white measures well under 3:1 on the
 * Graphite card).
 */
export type SurfaceColor = Widen<typeof graphiteColor> & { readonly controlOutline: string };

/**
 * #4518 — Graphite `controlOutline`: `card` (#1b1b1e) mixed toward `text1`
 * (#f5f5f7) until 3:1 against the card (the `checkoutOutlineFor` loop, run on
 * the card): 38 % ⇒ #6e6e70, 3.38:1. Checkout palettes compute their own in
 * `checkoutColorFor`.
 */
export const GRAPHITE_CONTROL_OUTLINE = "#6e6e70";

export type SurfaceMaterials = Readonly<Record<MaterialKind, MaterialRecipe>>;

export interface SurfaceTokens {
  readonly color: SurfaceColor;
  readonly materials: SurfaceMaterials;
}

const GRAPHITE: SurfaceTokens = {
  color: { ...graphiteColor, controlOutline: GRAPHITE_CONTROL_OUTLINE },
  materials: graphiteMaterials,
};

let active: SurfaceTokens = GRAPHITE;

/** The single writer is `checkoutTheme.setActiveCheckoutPalette`. null = Graphite. */
export function setActiveSurfaceTokens(tokens: SurfaceTokens | null): void {
  active = tokens ?? GRAPHITE;
}

export const activeSurfaceTokens = (): SurfaceTokens => active;

/** True while a host palette is painting (inside a checkout flow). */
export const isSurfaceThemed = (): boolean => active !== GRAPHITE;

/**
 * Host surfaces are SOLID: a host page colour behind dark frosted glass is
 * what #4518 looked like. One fill per material, no blur, a hairline frame in
 * the host's own line colour. `onPhoto` keeps its Graphite recipe because it
 * sits on a photograph, not on the host page.
 */
export function solidSurfaceMaterials(input: {
  pane: string;
  control: string;
  selected: string;
  chrome: string;
  liquid: string;
  sheet: string;
  edge: string;
  edgeStrong: string;
}): SurfaceMaterials {
  const solid = (fill: string, edge: string): MaterialRecipe => ({
    glassFill: fill,
    solidFill: fill,
    reducedFill: fill,
    blur: null,
    webBackdrop: null,
    rim: {
      top: null,
      edge,
      edgeWidth: graphiteMaterials.pane.rim.edgeWidth,
    },
  });
  return {
    pane: solid(input.pane, input.edge),
    control: solid(input.control, input.edgeStrong),
    selected: solid(input.selected, input.edgeStrong),
    chrome: solid(input.chrome, input.edge),
    liquid: solid(input.liquid, input.edgeStrong),
    onPhoto: graphiteMaterials.onPhoto,
    sheet: solid(input.sheet, input.edge),
  };
}

function follow<T extends object>(read: () => T): T {
  return new Proxy({} as T, {
    get: (_target, key: string | symbol) =>
      (read() as Record<string | symbol, unknown>)[key],
    has: (_target, key) => key in read(),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor: (_target, key) => {
      const source = read() as Record<string | symbol, unknown>;
      return key in source
        ? { configurable: true, enumerable: true, value: source[key] }
        : undefined;
    },
  });
}

/** designSystem `color`'s shape, read against the active tokens. */
export const color: SurfaceColor = follow(() => active.color);

/** designSystem `materials`' shape, read against the active tokens. */
export const materials: SurfaceMaterials = follow(() => active.materials);

/**
 * A value built from `color` / `materials` that follows the active tokens.
 * The factory runs once per token set (cached); call the getter at render.
 */
export function themed<T>(factory: () => T): () => T {
  const cache = new WeakMap<object, { value: T }>();
  return () => {
    const hit = cache.get(active);
    if (hit !== undefined) return hit.value;
    const value = factory();
    cache.set(active, { value });
    return value;
  };
}

/**
 * A module-scope stylesheet whose colours follow the active tokens. Reading a
 * style key returns the sheet built for the token set that is active NOW.
 */
export function themedStyles<T extends object>(factory: () => T): T {
  return follow(themed(factory));
}
