import { useState, useEffect, useCallback } from "react";
import { PreferencesService } from "../services/preferencesService";
import { offlineService } from "../services/offlineService";
import { useBoardSession } from "./useBoardSession";

/**
 * Hook for efficiently loading and managing preferences data
 * Separates data loading from UI rendering to improve modal open performance
 * 
 * Performance optimizations:
 * - Lazy loads data on mount only when visible
 * - Caches loaded data to avoid refetches
 * - Loads from offline cache first
 * - Handles both solo and collaboration modes
 */
export const usePreferencesData = (
  userId: string | undefined,
  sessionId: string | undefined,
  shouldLoad: boolean = true
) => {
  const isCollaborationMode = !!sessionId;
  
  // Collaboration mode - load from board session
  const {
    preferences: boardPreferences,
    updatePreferences: updateBoardPreferences,
    loading: loadingBoardPreferences,
  } = useBoardSession(sessionId);

  // Solo mode - load from preferences service
  const [soloPreferences, setSoloPreferences] = useState<any>(null);
  const [loadingSoloPreferences, setLoadingSoloPreferences] = useState<boolean>(shouldLoad);
  const [error, setError] = useState<Error | null>(null);

  const loadSoloPreferences = useCallback(async () => {
    if (!userId || isCollaborationMode) {
      setLoadingSoloPreferences(false);
      return;
    }

    try {
      setLoadingSoloPreferences(true);
      setError(null);

      // Try offline cache first for instant feedback
      try {
        const cachedPrefs = await offlineService.getOfflineUserPreferences();
        if (cachedPrefs) {
          setSoloPreferences(cachedPrefs);
          // Load fresh data in background
          return; // But continue to fetch fresh
        }
      } catch (err) {
        // Cache miss, continue to database
      }

      // Load from database
      const prefs = await PreferencesService.getUserPreferences(userId);
      if (prefs) {
        setSoloPreferences(prefs);
        // Cache for next time
        await offlineService.cacheUserPreferences(prefs);
      }
    } catch (err) {
      console.error("Error loading solo preferences:", err);
      setError(err instanceof Error ? err : new Error(String(err)));
      setSoloPreferences(null);
    } finally {
      setLoadingSoloPreferences(false);
    }
  }, [userId, isCollaborationMode]);

  // Load preferences only when visible and enabled
  useEffect(() => {
    if (!shouldLoad) {
      setLoadingSoloPreferences(false);
      return;
    }

    if (isCollaborationMode) {
      // Board preferences are loaded by useBoardSession hook
      return;
    }

    loadSoloPreferences();
  }, [shouldLoad, isCollaborationMode, userId, loadSoloPreferences]);

  const isLoading = isCollaborationMode ? loadingBoardPreferences : loadingSoloPreferences;
  const preferences = isCollaborationMode ? boardPreferences : soloPreferences;

  return {
    preferences,
    isLoading,
    error,
    isCollaborationMode,
    updateBoardPreferences,
    refetch: loadSoloPreferences,
  };
};
