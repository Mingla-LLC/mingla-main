import { useState, useCallback } from 'react';
import { stopReplacementService } from '../services/stopReplacementService';
import type { StopAlternative } from '../utils/mutateCuratedCard';

interface GetAlternativesParams {
  categoryId: string;
  location: { lat: number; lng: number };
  travelMode: string;
  excludePlaceIds: string[];
  siblingStops: Array<{ lat: number; lng: number }>;
  limit?: number;
}

interface UseReplaceStopReturn {
  alternatives: StopAlternative[];
  isLoading: boolean;
  error: Error | null;
  fetchAlternatives: (params: GetAlternativesParams) => Promise<void>;
  clearAlternatives: () => void;
}

export function useReplaceStop(): UseReplaceStopReturn {
  const [alternatives, setAlternatives] = useState<StopAlternative[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchAlternatives = useCallback(async (params: GetAlternativesParams): Promise<void> => {
    setIsLoading(true);
    setError(null);
    setAlternatives([]);
    try {
      const results = await stopReplacementService.getAlternatives(params);
      setAlternatives(results);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load alternatives'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearAlternatives = useCallback((): void => {
    setAlternatives([]);
    setError(null);
    setIsLoading(false);
  }, []);

  return { alternatives, isLoading, error, fetchAlternatives, clearAlternatives };
}
