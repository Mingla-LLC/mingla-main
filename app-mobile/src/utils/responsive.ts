import { Dimensions, PixelRatio } from 'react-native';

// ─── Base Reference Dimensions ───────────────────────────────────────
// Design reference: iPhone 14 (390 × 844)
// All designs are authored at this size and scale proportionally
const BASE_WIDTH = 390;
const BASE_HEIGHT = 844;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Core Scale Factors ──────────────────────────────────────────────
const widthScale = SCREEN_WIDTH / BASE_WIDTH;
const heightScale = SCREEN_HEIGHT / BASE_HEIGHT;

/**
 * Scales a value horizontally relative to the reference width (390).
 * Use for: horizontal padding, margins, widths, icon sizes, font sizes.
 *
 * Example: scale(16) → 16px on iPhone 14, ~14px on iPhone SE, ~18px on Pro Max
 */
export function scale(size: number): number {
  return Math.round(PixelRatio.roundToNearestPixel(size * widthScale));
}

/**
 * Scales a value vertically relative to the reference height (844).
 * Use for: vertical padding, margins, heights, spacing between sections.
 *
 * Example: verticalScale(24) → 24px on iPhone 14, ~20px on SE, ~28px on Pro Max
 */
export function verticalScale(size: number): number {
  return Math.round(PixelRatio.roundToNearestPixel(size * heightScale));
}

/**
 * Moderate scale — scales partially (default 50%) to prevent extreme stretching.
 * Use for: font sizes, border radii, icon sizes — things that should scale
 * but not as aggressively as layout dimensions.
 *
 * factor=0 → no scaling (fixed)
 * factor=0.5 → scales at half the rate (DEFAULT — best for text/icons)
 * factor=1 → full scaling (same as scale())
 *
 * Example: moderateScale(16, 0.5) → 16px on iPhone 14, ~15px on SE, ~17px on Pro Max
 */
export function moderateScale(size: number, factor: number = 0.5): number {
  return Math.round(
    PixelRatio.roundToNearestPixel(size + (scale(size) - size) * factor)
  );
}

/**
 * Moderate vertical scale — same as moderateScale but uses height axis.
 * Use for: vertical spacing that should scale gently.
 */
export function moderateVerticalScale(size: number, factor: number = 0.5): number {
  return Math.round(
    PixelRatio.roundToNearestPixel(size + (verticalScale(size) - size) * factor)
  );
}

// ─── Screen Dimension Exports ────────────────────────────────────────
export { SCREEN_WIDTH, SCREEN_HEIGHT };

// ─── Shorthand Aliases ───────────────────────────────────────────────
export const s = scale;
export const vs = verticalScale;
export const ms = moderateScale;
export const mvs = moderateVerticalScale;
