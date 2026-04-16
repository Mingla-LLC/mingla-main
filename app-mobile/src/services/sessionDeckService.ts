import { supabase, trackedInvoke } from './supabase';
import { unifiedCardToRecommendation } from './deckService';
import { curatedToRecommendation } from '../utils/cardConverters';
import { Recommendation } from '../types/recommendation';
import { extractFunctionError } from '../utils/edgeFunctionError';

export type DeckStatus = 'ready' | 'waiting_for_participants' | 'waiting_for_preferences' | 'empty_pool';

export interface SessionDeckResponse {
  cards: Recommendation[];
  deckMode: string;
  activePills: string[];
  total: number;
  hasMore: boolean;
  deckVersion: number;
  preferencesHash: string;
  deckStatus?: DeckStatus;
}

export async function fetchSessionDeck(
  sessionId: string,
  batchSeed: number = 0,
  _excludeCardIds: string[] = [], // ORCH-0438: No longer sent — session decks are shared, per-user exclusions filtered client-side
  location?: { lat: number; lng: number },
): Promise<SessionDeckResponse> {
  const { data, error } = await trackedInvoke('generate-session-deck', {
    body: { sessionId, batchSeed, location },
  });

  if (error) {
    const parsed = await extractFunctionError(error, 'Failed to fetch session deck');
    throw new Error(parsed);
  }

  if (!data) {
    throw new Error('Empty response from generate-session-deck');
  }

  // Curated cards (from generate-curated-experiences) have a `stops` array;
  // regular cards (from discover-cards) do not. Use the correct converter.
  const cards = (data.cards || []).map((card: any) =>
    card.stops ? curatedToRecommendation(card) : unifiedCardToRecommendation(card)
  );

  return {
    cards,
    deckMode: 'mixed',
    activePills: [],
    total: data.totalCards ?? cards.length,
    hasMore: data.hasMore ?? false,
    deckVersion: data.deckVersion ?? 1,
    preferencesHash: data.preferencesHash ?? '',
    deckStatus: data.deckStatus,
  };
}
