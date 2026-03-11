import { useQuery } from '@tanstack/react-query';
import { ExperiencesService, UserPreferences } from '../services/experiencesService';
import { offlineService } from '../services/offlineService';

const fetchUserPreferences = async (
  userId: string | undefined
): Promise<UserPreferences | null> => {
  if (!userId) {
    return null;
  }

  // Wrap the entire fetch chain in an 8-second timeout.
  // The Supabase client has a 30-second default; the offline fallback has none.
  // Without a cap, this chain can hang indefinitely and block the loader.
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("useUserPreferences timed out after 8s")), 8000)
  );

  const fetchLogic = async (): Promise<UserPreferences | null> => {
    // Try database first — authoritative source of truth
    try {
      const prefs = await ExperiencesService.getUserPreferences(userId);
      if (prefs) {
        // Update offline cache with fresh data (fire-and-forget)
        offlineService.cacheUserPreferences(prefs).catch(() => {});
        return prefs;
      }
    } catch (error) {
      console.log('DB fetch failed, falling back to offline cache:', error);
    }

    // Fallback: offline cache (only when DB is unreachable)
    try {
      const cachedPrefs = await offlineService.getOfflineUserPreferences();
      if (cachedPrefs) {
        console.log('Using cached preferences (offline fallback)');
        return cachedPrefs as UserPreferences;
      }
    } catch (error) {
      console.error('Offline cache also failed:', error);
    }

    return null;
  };

  return Promise.race([fetchLogic(), timeoutPromise]);
};

export const useUserPreferences = (userId: string | undefined) => {
  return useQuery({
    queryKey: ['userPreferences', userId],
    queryFn: () => fetchUserPreferences(userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes - preferences don't change often
    gcTime: 24 * 60 * 60 * 1000, // 24 hours
    // Show cached data immediately while fresh data loads
    placeholderData: (previousData) => previousData,
  });
};

