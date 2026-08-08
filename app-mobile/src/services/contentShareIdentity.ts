export type CuratedCompositionIdentity = { stopPlaceIds: string[] };
export type SharePreviewTerminalState = 'loading' | 'covered' | 'coverless' | 'error';

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

/**
 * Every Consumer curated surface converges on the same ordered composition.
 * Display facts are deliberately excluded; the server rehydrates them from
 * place_pool when the share is served.
 */
export function curatedCompositionIdentity(value: unknown): CuratedCompositionIdentity | null {
  const card = record(value);
  if (!card || !Array.isArray(card.stops)) return null;

  const stopPlaceIds: string[] = [];
  for (const rawStop of card.stops) {
    const stop = record(rawStop);
    if (!stop || typeof stop.placeId !== 'string') return null;
    const placeId = stop.placeId.trim();
    if (!placeId) return null;
    stopPlaceIds.push(placeId);
  }
  return { stopPlaceIds };
}

export function sharePreviewTerminalState(
  sharedCard: { s4Url?: unknown } | null,
  shareState: string,
): SharePreviewTerminalState {
  if (sharedCard) {
    return typeof sharedCard.s4Url === 'string' && sharedCard.s4Url.length > 0
      ? 'covered'
      : 'coverless';
  }
  return shareState === 'error' ? 'error' : 'loading';
}
