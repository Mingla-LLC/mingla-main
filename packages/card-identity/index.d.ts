/**
 * @mingla/card-identity — type surface.
 *
 * The implementation is `index.js` (CommonJS, dependency-free) so that the CI
 * oracle, satori/Node and Metro can all consume the SAME module without a
 * build step. See the header of index.js for why that matters.
 */

export type Rgb = readonly [number, number, number];

/**
 * Both ramps are FOUR-STOP by contract, and the tuple type is load-bearing:
 * `expo-linear-gradient` types `colors` as `readonly [string, string, ...string[]]`
 * and rejects a plain `readonly string[]`. Declaring the arity here keeps every
 * consumer honest without a cast at the call site.
 */
export interface RampSpec {
  readonly colors: readonly [string, string, string, string];
  readonly locations: readonly [number, number, number, number];
  readonly alphas: readonly [number, number, number, number];
}

export interface TopRampSpec extends RampSpec {
  readonly heightPt: number;
  readonly plateauHoldsToPt: number;
  readonly maxPlateauAlpha: number;
}

export const RAMP: {
  readonly bottom: RampSpec;
  readonly top: TopRampSpec;
};

export const PLATE: {
  readonly targetLstar: number;
  readonly lift: string;
  readonly liftRgb: Rgb;
  readonly liftAlpha: number;
  readonly underRgb: Rgb;
  readonly border: string;
  readonly borderRgb: Rgb;
  readonly borderAlpha: number;
  readonly borderWidth: number;
  readonly topHighlight: string;
  readonly fallbackSolid: string;
  readonly fallbackSolidRgb: Rgb;
  readonly blurIntensity: number;
  readonly blurTint: 'light';
};

export interface MetaSpan {
  readonly weight: string;
  readonly color: string;
}

export const META: {
  readonly rating: MetaSpan;
  readonly fact: MetaSpan;
  readonly separator: MetaSpan & { readonly text: string };
  readonly tail: MetaSpan;
};

export const DIVIDER: { readonly color: string; readonly height: number; readonly gap: number };
export const CHEVRON: { readonly color: string; readonly size: number };
export const SHARE_GLYPH: { readonly color: string; readonly size: number; readonly target: number };
export const STATE_DISC: {
  readonly size: number;
  readonly radius: number;
  readonly top: number;
  readonly right: number;
  readonly gap: number;
};

export type BeenHereStateKey = 'rest' | 'pressed' | 'flash' | 'settled' | 'failed';

export interface BeenHereState {
  readonly fill: string;
  readonly border: string;
  readonly androidFill: string;
  readonly androidBorder: string;
}

export const BEEN_HERE: {
  readonly height: number;
  readonly paddingHorizontal: number;
  readonly borderRadius: number;
  readonly borderWidth: number;
  readonly gap: number;
  readonly labelSize: number;
  readonly labelWeight: string;
  readonly glyphSize: { readonly rest: number; readonly active: number };
  readonly spinnerSize: number;
  readonly inFlightAfterMs: number;
  readonly flashHoldMs: number;
  readonly states: Readonly<Record<BeenHereStateKey, BeenHereState>>;
};

export const SLIVER: {
  readonly height: number;
  readonly radius: number;
  readonly offsets: readonly number[];
  readonly insets: readonly number[];
  readonly alpha: number;
};

export interface SurfaceSliver {
  readonly height: number;
  readonly radius: number;
  readonly alpha: number;
  readonly alpha2?: number;
  readonly opaque: readonly string[];
  readonly forcedOpaque: boolean;
}

export interface SurfaceDescriptor {
  readonly label: string;
  readonly w: number;
  readonly h: number;
  readonly cardR: number;
  readonly sideInset: number;
  readonly bottomInset: number;
  readonly plateW: number;
  readonly plateH: number;
  readonly plateR: number;
  readonly titleSize: number;
  readonly titleLH: number;
  readonly titleLines: number;
  readonly titleWeight: string;
  readonly titleInset: number;
  readonly metaSize: number;
  readonly gap: number;
  readonly titleOnPlate: boolean;
  readonly controls: boolean;
  readonly topScrim: boolean;
  readonly curated: boolean;
  readonly opaqueOnly?: boolean;
  readonly sliver: SurfaceSliver;
}

export type SurfaceKey =
  | 's1Single'
  | 's1Curated'
  | 's2Grid'
  | 's3Chat'
  | 's4Snippet'
  | 's5Og'
  | 's6Phone';

export const SURFACES: Readonly<Record<SurfaceKey, SurfaceDescriptor>>;

export const MAX_FONT_SCALE: {
  readonly title: number;
  readonly meta: number;
  readonly controlLabel: number;
};

export const META_ROW_H: number;
export const DIVIDER_H: number;
/** Points reserved ABOVE the divider on the short plate so the chevron is whole. */
export const CHEVRON_CLEARANCE: number;
export const PLATE_H_NO_META: number;
export const PLATE_ALPHA_FLOOR: number;
export const TITLE_ALPHA_FLOOR: number;
export const K_PLATE: number;
export const K_TITLE: number;

/** H = ceil2(max(K_PLATE * dPlateTop, K_TITLE * dTitleTop)), clamped to the card. */
export function scrimHeight(dPlateTop: number, dTitleTop: number, cardH: number): number;

/** Piecewise-linear ramp alpha at depth `d` (points from the card's bottom edge). */
export function rampAlphaAtDepth(d: number, scrimH: number): number;

/** Solves L*(composite) = PLATE.targetLstar for the under-layer's alpha. */
export function plateUnderAlpha(scrimAlphaAtPlateTop: number): number;

/**
 * Row heights inside the plate's content box. `control` is the remainder.
 *
 * `divider` is NEVER zero — it carries the chevron, which is the card's only
 * visible expand affordance. `clearance` is the space reserved above the
 * divider for the chevron's overhang, and is non-zero only on the short plate.
 */
export function plateRows(
  plateH: number,
  withMeta: boolean,
): { meta: number; divider: number; clearance: number; control: number };

export function typeLadder(surfaceKey: SurfaceKey): {
  title: { size: number; lineHeight: number; lines: number; weight: string };
  meta: { size: number; weight: string; lines: number };
  plateRadius: number;
  sliverHeight: number;
};

export function plateTopDepth(surfaceKey: SurfaceKey): number;
export function titleBottom(surfaceKey: SurfaceKey, plateH?: number): number;
export function titleTopDepth(surfaceKey: SurfaceKey): number;
export function surfaceScrimHeight(surfaceKey: SurfaceKey): number;
export function surfacePlateUnder(surfaceKey: SurfaceKey): number;
