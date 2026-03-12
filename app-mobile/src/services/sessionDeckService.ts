import { supabase } from './supabase';
import { unifiedCardToRecommendation } from './deckService';
import { Recommendation } from '../types/recommendation';
import { extractFunctionError } from '../utils/edgeFunctionError';

export interface SessionDeckResponse {
  cards: Recommendation[];
  deckMode: string;
  activePills: string[];
  total: number;
  hasMore: boolean;
  deckVersion: number;
  preferencesHash: string;
}

export async function fetchSessionDeck(
  sessionId: string,
  batchSeed: number = 0
): Promise<SessionDeckResponse> {
  const { data, error } = await supabase.functions.invoke('generate-session-deck', {
    body: { sessionId, batchSeed },
  });

  if (error) {
    const parsed = await extractFunctionError(error, 'Failed to fetch session deck');
    throw new Error(parsed);
  }

  if (!data) {
    throw new Error('Empty response from generate-session-deck');
  }

  const cards = (data.cards || []).map(unifiedCardToRecommendation);

  return {
    cards,
    deckMode: 'mixed',
    activePills: [],
    total: data.totalCards ?? cards.length,
    hasMore: data.hasMore ?? false,
    deckVersion: data.deckVersion ?? 1,
    preferencesHash: data.preferencesHash ?? '',
  };
}
