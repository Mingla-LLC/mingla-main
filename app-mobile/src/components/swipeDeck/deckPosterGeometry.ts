import type { ViewStyle } from 'react-native';

/**
 * #1593 — the poster layer's photo box and the interactive card's transparent hero
 * hole are the SAME rectangle drawn in two React trees. They MUST NOT be computed
 * independently: `styles.imageContainer` (flex: IMAGE_SECTION_RATIO) resolves to
 * 689.00pt in the poster tree and 667.67pt in the face tree, and the 21.33pt
 * overhang shows through the tray's 0.85 translucency as a pale bar (#1593).
 *
 * `measuredHoleHeight` is the face tree's own onLayout measurement — the single
 * source of truth. `flex: 0` makes `height` authoritative (RN: flex 0 => grow 0,
 * shrink 0, basis auto), overriding styles.imageContainer's flex.
 *
 * `behind` is deliberately NOT overridden: the behind overlay's tray is EMPTY
 * (SwipeableCards.tsx:3113) so its hole may legitimately differ, and applying the
 * current card's measurement there could paint an inverse white sliver on a layer
 * that is correct today. See I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE.
 */
export function posterPhotoBoxOverride(
  role: 'current' | 'behind',
  measuredHoleHeight: number | null,
): ViewStyle | null {
  if (role !== 'current') return null;
  if (measuredHoleHeight == null) return null;
  if (!Number.isFinite(measuredHoleHeight) || measuredHoleHeight <= 0) return null;
  return { flex: 0, height: measuredHoleHeight };
}
