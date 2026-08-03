export const DECK_HERO_MAX_LONG_EDGE_PX = 1440;
// The deck owns at most the visible and behind native poster nodes. Disk-only
// cache prevents a long session from retaining every decoded poster globally.
export const DECK_VISIBLE_POSTER_CACHE_POLICY = 'disk' as const;

export interface DeckHeroDecodeTarget {
  width: number;
  height: number;
}

export function getDeckHeroDecodeTarget(
  renderedWidth: number,
  renderedHeight: number,
  pixelRatio: number,
): DeckHeroDecodeTarget {
  const safeWidth = Math.max(1, renderedWidth);
  const safeHeight = Math.max(1, renderedHeight);
  const safePixelRatio = Math.max(1, pixelRatio);
  const physicalWidth = safeWidth * safePixelRatio;
  const physicalHeight = safeHeight * safePixelRatio;
  const longEdge = Math.max(physicalWidth, physicalHeight);
  const scale = Math.min(1, DECK_HERO_MAX_LONG_EDGE_PX / longEdge);

  return {
    width: Math.max(1, Math.round(physicalWidth * scale)),
    height: Math.max(1, Math.round(physicalHeight * scale)),
  };
}
