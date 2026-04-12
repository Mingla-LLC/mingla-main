// INVARIANT: This is the ONLY file that imports expo-updates.
// All OTA logic is centralized here. Do not scatter Updates calls elsewhere.

import { useCallback, useRef, useState } from 'react';
import * as Updates from 'expo-updates';

export interface OtaUpdateState {
  /** Whether an update check is in progress */
  isChecking: boolean;
  /** Whether an update is currently downloading */
  isDownloading: boolean;
  /** Whether a downloaded update is ready to apply */
  isUpdateReady: boolean;
  /** Trigger a manual check (called by useForegroundRefresh) */
  checkForUpdate: () => Promise<void>;
  /** Apply the downloaded update (reloads the app) */
  applyUpdate: () => Promise<void>;
  /** Dismiss the banner for this session (user chose to ignore) */
  dismissBanner: () => void;
  /** Whether the user dismissed the banner this session */
  isDismissed: boolean;
}

/**
 * Centralized OTA update checker.
 *
 * Exposes state and actions for checking, downloading, and applying EAS OTA updates.
 * All expo-updates calls are guarded with __DEV__ checks (the native module throws
 * in development) and wrapped in try/catch (OTA is best-effort infrastructure).
 *
 * Does NOT check on mount — lets expo-updates' built-in ON_LAUNCH handle cold starts.
 * The `checkForUpdate` callback is designed to be called by useForegroundRefresh
 * on foreground resume (short + long background, not trivial).
 */
export function useOtaUpdates(): OtaUpdateState {
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUpdateReady, setIsUpdateReady] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Refs for guards — prevent concurrent checks and reads in async callbacks
  const isCheckingRef = useRef(false);
  const isDownloadingRef = useRef(false);

  const checkForUpdate = useCallback(async (): Promise<void> => {
    // Guard: expo-updates throws in dev mode
    if (__DEV__) return;

    // Guard: already checking or downloading
    if (isCheckingRef.current || isDownloadingRef.current) return;

    try {
      isCheckingRef.current = true;
      setIsChecking(true);

      console.warn('[OTA] Checking for update...');
      const checkResult = await Updates.checkForUpdateAsync();

      if (!checkResult.isAvailable) {
        console.warn('[OTA] No update available');
        return;
      }

      // Update available — download it
      console.warn('[OTA] Update available, downloading...');
      isDownloadingRef.current = true;
      setIsDownloading(true);

      await Updates.fetchUpdateAsync();

      console.warn('[OTA] Update downloaded and ready to apply');
      setIsUpdateReady(true);
      setIsDismissed(false); // Reset dismiss if a new update arrives
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[OTA] Check failed: ${message}`);
    } finally {
      isCheckingRef.current = false;
      isDownloadingRef.current = false;
      setIsChecking(false);
      setIsDownloading(false);
    }
  }, []);

  const applyUpdate = useCallback(async (): Promise<void> => {
    if (__DEV__) return;

    try {
      console.warn('[OTA] Applying update — reloading app');
      await Updates.reloadAsync();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[OTA] Reload failed: ${message}`);
    }
  }, []);

  const dismissBanner = useCallback((): void => {
    setIsDismissed(true);
  }, []);

  return {
    isChecking,
    isDownloading,
    isUpdateReady,
    checkForUpdate,
    applyUpdate,
    dismissBanner,
    isDismissed,
  };
}
