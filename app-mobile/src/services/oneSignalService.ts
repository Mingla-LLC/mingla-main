import { OneSignal, LogLevel } from 'react-native-onesignal'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ONESIGNAL_APP_ID = '388b3efc-14c2-4de2-98cb-68c818be9f06'

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

let _initialized = false

/**
 * Initialize the OneSignal SDK. Call once at app startup before any other
 * OneSignal methods. Safe to call again — subsequent calls are no-ops.
 */
export function initializeOneSignal(): void {
  if (_initialized) return
  try {
    OneSignal.Debug.setLogLevel(LogLevel.Verbose)
    OneSignal.initialize(ONESIGNAL_APP_ID)

    // Request notification permission immediately on first launch.
    // OneSignal will prompt the user with the native iOS/Android dialog.
    OneSignal.Notifications.requestPermission(true)

    _initialized = true
  } catch (e) {
    console.warn('[OneSignal] Initialization failed:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// User identity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Link the OneSignal player to a Supabase user ID.
 * Call immediately after a successful Supabase sign-in.
 *
 * This lets you target push notifications to specific users via the
 * OneSignal dashboard or API using their Supabase UUID as the external ID.
 */
export function loginOneSignal(userId: string): void {
  if (!_initialized) return
  try {
    OneSignal.login(userId)
  } catch (e) {
    console.warn('[OneSignal] login failed:', e)
  }
}

/**
 * Unlink the OneSignal player from the current user.
 * Call immediately after Supabase sign-out.
 */
export function logoutOneSignal(): void {
  if (!_initialized) return
  try {
    OneSignal.logout()
  } catch (e) {
    console.warn('[OneSignal] logout failed:', e)
  }
}
