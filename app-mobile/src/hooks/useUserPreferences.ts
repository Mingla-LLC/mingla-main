import { useQuery } from '@tanstack/react-query';
import { ExperiencesService, UserPreferences } from '../services/experiencesService';
import { offlineService } from '../services/offlineService';

const fetchUserPreferences = async (
  userId: string | undefined
): Promise<UserPreferences | null> => {
  if (!userId) {
    return null;
  }

  // First, try to get preferences from cache
  try {
    const cachedPrefs = await offlineService.getOfflineUserPreferences();
    if (cachedPrefs) {
      console.log('Using cached preferences');
      return cachedPrefs as UserPreferences;
    }
  } catch (error) {
    console.log('No cached preferences found, fetching from database');
  }

  // If not found in cache, fetch from database
  try {
    const prefs = await ExperiencesService.getUserPreferences(userId);
    // Cache the preferences for next time
    if (prefs) {
      await offlineService.cacheUserPreferences(prefs);
    }
    return prefs;
  } catch (error) {
    console.error('Error loading preferences from database:', error);
    return null;
  }
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

