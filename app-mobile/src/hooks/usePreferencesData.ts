import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PreferencesService, type UserPreferences } from '../services/preferencesService';
import { useBoardSession } from './useBoardSession';

// INVARIANT I-RESUME-01: Use useQuery (not getQueryData) so isLoading is false
// when cache exists. getQueryData() misses transient states during background
// refetch, causing false shimmer. See ORCH-0336 CF-6.

/**
 * Hook for efficiently loading and managing preferences data.
 *
 * Solo mode subscribes to the React Query cache via useQuery — isLoading
 * is false when cached data exists (even during background refetch). The
 * cache is populated by useUserPreferences on app start. Shimmer only
 * shows on the very first open when no cache exists at all.
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

  // Solo mode — subscribe to the React Query observer so isLoading correctly
  // distinguishes "no data at all" (true) from "stale data being refreshed" (false).
  const { data: cachedPrefs, isLoading: queryIsLoading } = useQuery<UserPreferences | null>({
    queryKey: ['userPreferences', userId],
    queryFn: () => PreferencesService.getUserPreferences(userId!),
    enabled: !isCollaborationMode && shouldLoad && !!userId,
    staleTime: Infinity,
  });

  const isLoadingSolo = !isCollaborationMode && queryIsLoading;

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
