import { AppState } from 'react-native';
import { Platform } from 'react-native';
import { requestPushPermission, canRequestPushPermission } from './oneSignalService';
import { startAppsFlyer } from './appsFlyerService';
import { shouldRequestAttNow } from '../utils/attRequestTiming';

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
 *
 * ORCH-1257 (Apple 2.1) — AppState gating. iOS SILENTLY DROPS an ATT request
 * issued while the app is not foreground-`active` (common on iPad, where the app
 * is briefly backgrounded during onboarding). Build 35 was rejected because the
 * reviewer "was unable to locate the ATT permission request" on iPadOS 26.4.2 —
 * the request had been fired off-`active` and never shown. `ensureAttRequested()`
 * now gates the prompt on `AppState === 'active'` (via `shouldRequestAttNow`): if
 * active it requests immediately; otherwise it waits for the FIRST `active`
 * transition (one-shot listener), then requests. This mirrors the business app's
 * ORCH-1246 fix, after which Apple stopped flagging the business app's ATT.
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
      // ORCH-1257 (Apple 2.1): iOS silently DROPS an ATT request issued while the
      // app is not foreground-`active`. Gate on AppState: if active, request now;
      // otherwise wait for the FIRST `active` transition (one-shot listener), then
      // request. Guarantees the dialog is issued on-`active` so it actually shows.
      await requestAttWhenActive();
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
 * Perform the iOS ATT prompt on the app's foreground-`active` state. Resolves
 * after `requestTrackingPermissionsAsync()` settles. If the app is not active
 * when called, registers a one-shot AppState listener and issues the request the
 * first time the app becomes active. iOS-only caller (see `ensureAttRequested`).
 */
async function requestAttWhenActive(): Promise<void> {
  const runAttRequest = async (): Promise<void> => {
    try {
      const { requestTrackingPermissionsAsync } = await import('expo-tracking-transparency');
      // Resolves with the user's decision; on a previously-answered install it
      // returns immediately without showing the dialog again (no double-prompt).
      await requestTrackingPermissionsAsync();
    } catch (e) {
      console.warn('[permissionOrchestrator] ATT request failed:', e);
    }
  };

  if (shouldRequestAttNow(AppState.currentState)) {
    await runAttRequest();
    return;
  }

  // Not active — defer to the first `active` transition, then request once.
  await new Promise<void>((resolve) => {
    const sub = AppState.addEventListener('change', (next) => {
      if (shouldRequestAttNow(next)) {
        sub.remove();
        void runAttRequest().then(resolve);
      }
    });
  });
}

/**
 * Resolves once ATT has been requested (iOS) or immediately on non-iOS. Tracking
 * SDKs await this so they never transmit before the ATT decision is made.
 */
export function whenAttResolved(): Promise<void> {
  return _attResolved;
}

/**
 * Deferred permission sequence — ORCH-1257 (Apple 2.1): fired EARLY, in the
 * onboarding `onComplete` callback (app/index.tsx), right after onboarding and
 * BEFORE the coach-mark tour, so the reviewer encounters the ATT prompt within
 * seconds. (It previously fired only after the 11-step coach-mark tour completed
 * or was skipped — 1–5 minutes in — which is why Apple could not locate it.)
 * NOT the only ATT trigger: the home-screen effect (app/index.tsx) also fires
 * `ensureAttRequested()` independently, so a returning user who never got the
 * prompt still gets it once on reaching home. All paths route through the same
 * single-flight gate, so ATT / AppsFlyer never double-fire.
 *
 * Sequence:
 *   1. iOS ATT prompt — via the single-flight `ensureAttRequested()` gate, so it
 *      is never shown twice (if the home-screen effect already fired it, this
 *      resolves immediately).
 *   2. Start AppsFlyer SDK transmission with the now-resolved IDFA state.
 *   3. OneSignal push notification permission prompt — ONLY on a never-asked
 *      device (ORCH-1244 / Apple Guideline 4.5.4). If the OS can no longer be
 *      asked (already allowed OR already declined), the dialog is NOT
 *      re-surfaced — push stays optional + consent-based, the user's prior
 *      choice is respected, and nothing nags them back toward Settings.
 */
export async function requestPostTourPermissions(): Promise<void> {
  // Step 1: iOS ATT prompt (single-flight — never double-prompts).
  await ensureAttRequested();

  // Step 2: Start AppsFlyer transmission (idempotent — only fires once).
  startAppsFlyer();

  // Step 3: OneSignal push permission prompt — gated so the OS dialog only ever
  // appears once, on a clean never-asked device. canRequestPushPermission()
  // wraps OneSignal's canRequestPermission() inside oneSignalService (the only
  // module allowed to import OneSignal). A declined or already-granted user is
  // never re-prompted (ORCH-1244).
  if (await canRequestPushPermission()) {
    await requestPushPermission();
  }
}
