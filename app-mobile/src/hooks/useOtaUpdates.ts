// INVARIANT (#2107): src/services/otaUpdateRuntime.ts is the ONLY file that
// imports expo-updates. This hook consumes its bridge. Do not scatter Updates
// calls elsewhere — .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs
// fails the build if any other file imports expo-updates directly.
//
// SCOPE (#2107): this hook is now the OPTIONAL update path only — the small
// dismissible banner offering an immediate restart once an update has landed.
// A REQUIRED update is handled by OtaAcknowledgementLayer, which blocks the app
// until the user taps once. Kept per the #2107 operator decision: it interrupts
// nobody and gets a fix live sooner for anyone who takes it.

import { useCallback, useRef, useState } from 'react';
import { createOtaUpdateBridge } from '../services/otaUpdateRuntime';

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
    // Guard: the bridge reports disabled in dev (the native module throws) and
    // in any build with updates switched off.
    const bridge = createOtaUpdateBridge();
    if (!bridge.isEnabled) return;

    // Guard: already checking or downloading
    if (isCheckingRef.current || isDownloadingRef.current) return;

    try {
      isCheckingRef.current = true;
      setIsChecking(true);

      console.warn('[OTA] Checking for update...');
      const checkResult = await bridge.checkForUpdate();

      if (!checkResult.isAvailable) {
        console.warn('[OTA] No update available');
        return;
      }

      // Update available — download it
      console.warn('[OTA] Update available, downloading...');
      isDownloadingRef.current = true;
      setIsDownloading(true);

      await bridge.fetchUpdate();

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
    const bridge = createOtaUpdateBridge();
    if (!bridge.isEnabled) return;

    try {
      console.warn('[OTA] Applying update — reloading app');
      await bridge.reload();
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
