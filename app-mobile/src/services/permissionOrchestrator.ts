import { Platform } from 'react-native';
import { requestPushPermission } from './oneSignalService';
import { startAppsFlyer } from './appsFlyerService';

/**
 * App Tracking Transparency (ATT) gate — ORCH-1228 (Apple Guideline 2.1).
 *
 * Apple rejected build 29 because the reviewer "was unable to locate the App
 * Tracking Transparency permission request" on iPadOS 26.5. Previously ATT only
 * fired inside `requestPostTourPermissions()`, which runs ONLY after the
 * coach-mark tour completes or is skipped. On the reviewer's iPad the tour never
 * reached that point, so ATT never showed.
 *
 * The app KEEPS tracking (AppsFlyer attribution + PostHog autocapture/replay),
 * so the fix is to make ATT fire RELIABLY and DETERMINISTICALLY — exactly once,
 * before any tracking SDK transmits — not to remove tracking.
 *
 * This module owns a single-flight ATT request:
 *   - `ensureAttRequested()` performs the iOS ATT prompt at most once per process
 *     and resolves the gate. The home-screen effect (app/index.tsx) calls it the
 *     first time the authenticated, onboarded user reaches the main app UI — a
 *     path that ALWAYS runs, independent of the coach-mark tour. The post-tour
 *     permission step also routes through it, so the prompt is never doubled.
 *   - `whenAttResolved()` resolves once ATT has been requested (or immediately on
 *     non-iOS, where ATT is a no-op). Tracking SDKs (PostHog) await this before
 *     they start transmitting, guaranteeing ATT-before-tracking ordering.
 *
 * On a fresh install the OS shows the system ATT dialog once and never again; on
 * subsequent launches `requestTrackingPermissionsAsync()` resolves immediately
 * with the prior decision, so a returning user is never re-prompted.
 */

// Resolves once ATT has been requested (iOS) or is known to be a no-op (other
// platforms). Tracking SDKs await this to enforce ATT-before-tracking ordering.
// The executor runs synchronously, so `capturedResolve` is always assigned before
// the constructor returns.
let capturedResolve: () => void = () => {};
const _attResolved: Promise<void> = new Promise<void>((resolve) => {
  capturedResolve = resolve;
});
let _attResolve: (() => void) | null = capturedResolve;
// Non-iOS: ATT is a no-op — open the gate immediately so PostHog and AppsFlyer
// are never blocked waiting on a prompt that will never appear.
if (Platform.OS !== 'ios') {
  _attResolve();
  _attResolve = null;
}

// Single-flight guard: the in-flight (or completed) ATT request promise. Ensures
// `requestTrackingPermissionsAsync()` is invoked at most once per process even if
// `ensureAttRequested()` is called concurrently from the home-screen effect and
// the post-tour permission step.
let _attRequestInFlight: Promise<void> | null = null;

/**
 * Request the iOS ATT prompt exactly once (single-flight). Resolves the ATT gate
 * so tracking SDKs awaiting `whenAttResolved()` may start. No-op on non-iOS.
 *
 * Must be invoked before any tracking SDK transmits (AppsFlyer start / PostHog
 * init). The home-screen effect in app/index.tsx is the deterministic trigger.
 */
export function ensureAttRequested(): Promise<void> {
  if (_attRequestInFlight) return _attRequestInFlight;

  _attRequestInFlight = (async () => {
    if (Platform.OS === 'ios') {
      try {
        const { requestTrackingPermissionsAsync } = await import('expo-tracking-transparency');
        // Resolves with the user's decision; on a previously-answered install it
        // returns immediately without showing the dialog again (no double-prompt).
        await requestTrackingPermissionsAsync();
      } catch (e) {
        console.warn('[permissionOrchestrator] ATT request failed:', e);
      }
      // Open the gate whether the prompt succeeded or threw — tracking must never
      // be blocked forever by an ATT failure.
      if (_attResolve) {
        _attResolve();
        _attResolve = null;
      }
    }
    // Non-iOS already has the gate open (see module init above).
  })();

  return _attRequestInFlight;
}

/**
 * Resolves once ATT has been requested (iOS) or immediately on non-iOS. Tracking
 * SDKs await this so they never transmit before the ATT decision is made.
 */
export function whenAttResolved(): Promise<void> {
  return _attResolved;
}

/**
 * Deferred permission requests — called AFTER the coach-mark tour completes
 * (either naturally or via skip). NOT the only ATT trigger anymore: the
 * home-screen effect (app/index.tsx) fires `ensureAttRequested()` independently,
 * so ATT appears even when the tour never renders (ORCH-1228).
 *
 * Sequence:
 *   1. iOS ATT prompt — via the single-flight `ensureAttRequested()` gate, so it
 *      is never shown twice (if the home-screen effect already fired it, this
 *      resolves immediately).
 *   2. Start AppsFlyer SDK transmission with the now-resolved IDFA state.
 *   3. OneSignal push notification permission prompt.
 */
export async function requestPostTourPermissions(): Promise<void> {
  // Step 1: iOS ATT prompt (single-flight — never double-prompts).
  await ensureAttRequested();

  // Step 2: Start AppsFlyer transmission (idempotent — only fires once).
  startAppsFlyer();

  // Step 3: OneSignal push permission prompt.
  await requestPushPermission();
}
