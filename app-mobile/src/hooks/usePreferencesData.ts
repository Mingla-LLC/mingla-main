import { useQueryClient } from '@tanstack/react-query';
import { PreferencesService } from '../services/preferencesService';
import { useBoardSession } from './useBoardSession';
import type { UserPreferences } from '../services/experiencesService';

/**
 * Hook for efficiently loading and managing preferences data.
 *
 * Solo mode reads from the React Query cache synchronously — zero network
 * calls, zero shimmer on every open. The cache is populated by
 * useUserPreferences on app start. Only the very first open (empty cache)
 * triggers a prefetch.
 *
 * Collab mode delegates to useBoardSession (unchanged).
 */
export const usePreferencesData = (
  userId: string | undefined,
  sessionId: string | undefined,
  shouldLoad: boolean = true
) => {
  const isCollaborationMode = !!sessionId;
  const queryClient = useQueryClient();

  // Collaboration mode — unchanged (useBoardSession already caches)
  const {
    preferences: boardPreferences,
    updatePreferences: updateBoardPreferences,
    loading: loadingBoardPreferences,
  } = useBoardSession(sessionId);

  // Solo mode — read from React Query cache (same cache useUserPreferences writes to)
  const cachedPrefs = queryClient.getQueryData<UserPreferences>(
    ['userPreferences', userId]
  );

  // Only loading if cache is empty AND we need data
  const isLoadingSolo = !isCollaborationMode && shouldLoad && !cachedPrefs && !!userId;

  // If cache is empty on first open, trigger a fetch
  // (this is the ONLY time a network call happens)
  if (isLoadingSolo && userId) {
    queryClient.prefetchQuery({
      queryKey: ['userPreferences', userId],
      queryFn: () => PreferencesService.getUserPreferences(userId),
      staleTime: Infinity,
    });
  }

  const isLoading = isCollaborationMode ? loadingBoardPreferences : isLoadingSolo;
  const preferences = isCollaborationMode ? boardPreferences : cachedPrefs;

  return {
    preferences: preferences ?? null,
    isLoading,
    error: null,
    isCollaborationMode,
    updateBoardPreferences,
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: ['userPreferences', userId] });
    },
  };
};
