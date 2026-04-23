import { useQuery } from '@tanstack/react-query';
// ORCH-0640 ch09: experiencesService DELETED. getUserPreferences survives on preferencesService.
import { PreferencesService } from '../services/preferencesService';
import type { UserPreferences } from '../types/preferences';
import { offlineService } from '../services/offlineService';

const fetchUserPreferences = async (
  userId: string | undefined,
  signal?: AbortSignal
): Promise<UserPreferences | null> => {
  if (!userId) {
    return null;
  }

  // Try database first — authoritative source of truth.
  // Network timeout is handled by fetchWithTimeout (12s) in supabase.ts.
  // No wrapper timeout needed — single layer of timeout control.
  try {
    const prefs = await PreferencesService.getUserPreferences(userId);

    // Bail early if React Query cancelled this query (e.g. component unmounted)
    if (signal?.aborted) return null;

    if (prefs) {
      // Update offline cache with fresh data (fire-and-forget)
      offlineService.cacheUserPreferences(prefs).catch(() => {});
      return prefs;
    }
  } catch (error) {
    if (signal?.aborted) return null;
    console.log('DB fetch failed, falling back to offline cache:', error);
  }

  // Fallback: offline cache (only when DB is unreachable)
  try {
    const cachedPrefs = await offlineService.getOfflineUserPreferences();
    if (cachedPrefs) {
      console.log('Using cached preferences (offline fallback)');
      return cachedPrefs;
    }
  } catch (error) {
    console.error('Offline cache also failed:', error);
  }

  return null;
};

export const useUserPreferences = (userId: string | undefined) => {
  return useQuery({
    queryKey: ['userPreferences', userId],
    queryFn: ({ signal }) => fetchUserPreferences(userId, signal),
    enabled: !!userId,
    staleTime: 60_000, // 60s — matches subscription tier window from Pass 5
    gcTime: 24 * 60 * 60 * 1000, // 24 hours
    // Retry once after a short delay. The most common failure cause is network
    // socket recovery after background resume. Single retry handles it cleanly.
    // With 12s network timeout + 1s delay + 12s retry = 25s worst case.
    retry: 1,
    retryDelay: 1000,
    // Show cached data immediately while fresh data loads
    placeholderData: (previousData) => previousData,
  });
};
