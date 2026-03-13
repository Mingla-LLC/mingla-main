import { useQuery } from '@tanstack/react-query';
import { ExperiencesService, UserPreferences } from '../services/experiencesService';
import { offlineService } from '../services/offlineService';

const TIMEOUT_MS = 15000;

const fetchUserPreferences = async (
  userId: string | undefined,
  signal?: AbortSignal
): Promise<UserPreferences | null> => {
  if (!userId) {
    return null;
  }

  // Race the fetch chain against a 15-second timeout.
  // 15s matches mobile network realities (Android auth token restoration
  // from AsyncStorage can take 5-8s alone before the Supabase query fires).
  // The timer is always cleaned up — no dangling rejected promises.
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('useUserPreferences timed out after 15s')),
      TIMEOUT_MS
    );
  });

  const fetchLogic = async (): Promise<UserPreferences | null> => {
    // Try database first — authoritative source of truth
    try {
      const prefs = await ExperiencesService.getUserPreferences(userId);

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

  try {
    return await Promise.race([fetchLogic(), timeoutPromise]);
  } finally {
    // Always clear the timer — prevents dangling rejected promises on happy path
    clearTimeout(timer);
  }
};

export const useUserPreferences = (userId: string | undefined) => {
  return useQuery({
    queryKey: ['userPreferences', userId],
    queryFn: ({ signal }) => fetchUserPreferences(userId, signal),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes - preferences don't change often
    gcTime: 24 * 60 * 60 * 1000, // 24 hours
    // Timeout-based errors are not worth retrying — if Supabase was unreachable
    // for 8s, a second attempt will almost certainly time out too.
    retry: 0,
    // Show cached data immediately while fresh data loads
    placeholderData: (previousData) => previousData,
  });
};
