/**
 * OneSignal integration for Mingla Business (ORCH-0808-FOLLOWUP).
 *
 * Scope (operator-confirmed 2026-05-12): install + identity binding only.
 * - SDK init at root mount (env-guarded TRANSITIONAL)
 * - login(userId) on SIGNED_IN — link device to Supabase user
 * - logout() on SIGNED_OUT — Constitution #6
 *
 * NOT in scope (deferred to follow-up ORCHs):
 * - Notification permission prompt (Android 13+ runtime perm + iOS user prompt)
 * - Foreground notification display handler (SDK v5 requires explicit display())
 * - Notification click handler / deep link routing
 * - Push subscription opt-in (optIn() — deferred until permission UX is built)
 * - Server-side push from edge functions
 *
 * Env-driven: no-op (with single warn) if EXPO_PUBLIC_ONESIGNAL_APP_ID missing.
 *
 * NOTE on push subscription: without `OneSignal.User.pushSubscription.optIn()`,
 * the device is identified but NOT subscribed to push delivery. This is
 * intentional for install-only scope — we don't want to start collecting push
 * subscribers before the notification UX is built. When ready, a follow-up
 * ORCH adds optIn() inside loginToOneSignal() per ORCH-0407 consumer pattern.
 */

import { Platform } from "react-native";

// Defer react-native-onesignal require so web bundles don't blow up at
// module-load. The package imports native modules that fail to resolve
// under `expo export -p web`. Web bundles intentionally skip push.
// Invariant: mingla-business web export tolerates native-only deps via
// Platform.OS guard (paired with I-PROPOSED-X web-export deprecation).
let OneSignal: typeof import("react-native-onesignal").OneSignal | null = null;
let LogLevel: typeof import("react-native-onesignal").LogLevel | null = null;
if (Platform.OS !== "web") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-onesignal");
    OneSignal = mod.OneSignal;
    LogLevel = mod.LogLevel;
  } catch (err) {
    console.warn("[OneSignal] native module unavailable; push disabled:", err);
  }
}

const ONESIGNAL_APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID;

let _initialized = false;
const _enabled =
  typeof ONESIGNAL_APP_ID === "string" &&
  ONESIGNAL_APP_ID.length > 0 &&
  OneSignal !== null;

/**
 * Initialize the OneSignal SDK. Call once at app startup before any other
 * OneSignal method. Safe to call again — subsequent calls are no-ops.
 */
export function initializeOneSignal(): void {
  if (_initialized) return;
  if (!_enabled) {
    console.warn(
      "[OneSignal] env missing — SDK disabled. Set EXPO_PUBLIC_ONESIGNAL_APP_ID as an EAS Secret to enable.",
    );
    return;
  }
  try {
    OneSignal!.Debug.setLogLevel(__DEV__ ? LogLevel!.Verbose : LogLevel!.Warn);
    OneSignal!.initialize(ONESIGNAL_APP_ID!);
    _initialized = true;
    if (__DEV__) console.log("[OneSignal] initialized");
  } catch (e) {
    console.warn("[OneSignal] init failed:", e);
  }
}

export function isOneSignalReady(): boolean {
  return _initialized;
}

/**
 * Link this device to a Supabase user. Fire-and-forget.
 * Idempotent — safe to call multiple times for the same userId.
 *
 * Does NOT call optIn() — push subscription is deferred until the
 * notification UX (permission prompt + foreground handler) ships.
 */
export function loginToOneSignal(userId: string): void {
  if (!_initialized) return;
  try {
    OneSignal!.login(userId);
    if (__DEV__) console.log("[OneSignal] logged in:", userId);
  } catch (e) {
    console.warn("[OneSignal] login failed:", e);
  }
}

/**
 * Unlink the device from the current user. Call on signOut so the next
 * signed-in user is not attributed to the prior user's OneSignal alias.
 *
 * Constitution #6 — logout clears everything including third-party identity
 * caches that survive Supabase signOut by default.
 */
export function logoutOneSignal(): void {
  if (!_initialized) return;
  try {
    OneSignal!.logout();
    if (__DEV__) console.log("[OneSignal] logged out");
  } catch (e) {
    console.warn("[OneSignal] logout failed:", e);
  }
}
