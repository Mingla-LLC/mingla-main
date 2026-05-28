import { Platform } from 'react-native';
import { requestPushPermission } from './oneSignalService';
import { startAppsFlyer } from './appsFlyerService';

/**
 * Deferred permission requests — called AFTER the coach mark tour completes
 * (either naturally or via skip). Not called on app boot.
 *
 * Wired in CoachMarkContext.tsx (`nextStep` past final step, and `skipTour`).
 *
 * Sequence (ORCH-0977):
 *   1. iOS ATT prompt (App Tracking Transparency) — user allows/denies IDFA access
 *   2. Start AppsFlyer SDK transmission with the now-resolved IDFA state
 *      (real IDFA if allowed, zeroed IDFA if denied — AppsFlyer falls back to
 *      SKAdNetwork in the denied case)
 *   3. OneSignal push notification permission prompt
 *
 * iOS queues the two popups serially. The user sees ATT first, then push.
 * On Android, ATT is a no-op (the import call throws "unavailable" which we
 * swallow); AppsFlyer starts immediately; push prompt is OS-level.
 */
export async function requestPostTourPermissions(): Promise<void> {
  // Step 1: iOS ATT prompt
  if (Platform.OS === 'ios') {
    try {
      const { requestTrackingPermissionsAsync } = await import('expo-tracking-transparency');
      await requestTrackingPermissionsAsync();
    } catch (e) {
      console.warn('[permissionOrchestrator] ATT request failed:', e);
    }
  }

  // Step 2: Start AppsFlyer transmission (idempotent — only fires once)
  startAppsFlyer();

  // Step 3: OneSignal push permission prompt
  await requestPushPermission();
}
