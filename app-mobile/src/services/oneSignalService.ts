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
  console.log('[OneSignal] initializeOneSignal() called')
  try {
    OneSignal.Debug.setLogLevel(LogLevel.Verbose)
    OneSignal.initialize(ONESIGNAL_APP_ID)
    OneSignal.Notifications.requestPermission(true)
    _initialized = true
    console.log('[OneSignal] initialized')
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
 * This sets the external_id in OneSignal, which is how edge functions
 * target push notifications to specific users via the REST API.
 */
export function loginOneSignal(userId: string): void {
  if (!_initialized) return
  try {
    OneSignal.login(userId)
    console.log('[OneSignal] login:', userId)
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
    console.log('[OneSignal] logout')
  } catch (e) {
    console.warn('[OneSignal] logout failed:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification event listeners
// ─────────────────────────────────────────────────────────────────────────────

export interface OneSignalNotificationData {
  type?: string
  [key: string]: unknown
}

/**
 * Register a callback for when a push notification arrives while the app is
 * in the foreground. The callback receives the notification's `data` payload.
 *
 * By default, OneSignal will display the notification in the system tray.
 * Call `event.preventDefault()` inside the callback to suppress display
 * and handle it purely in-app.
 *
 * Returns a cleanup function to remove the listener.
 */
export function onForegroundNotification(
  callback: (data: OneSignalNotificationData, prevent: () => void) => void
): () => void {
  if (!_initialized) return () => {}

  const handler = (event: any) => {
    const data = (event.getNotification().additionalData ?? {}) as OneSignalNotificationData
    callback(data, () => event.preventDefault())
  }

  OneSignal.Notifications.addEventListener('foregroundWillDisplay', handler)
  return () => {
    OneSignal.Notifications.removeEventListener('foregroundWillDisplay', handler)
  }
}

/**
 * Register a callback for when the user taps a notification (from system tray,
 * lock screen, or banner). The callback receives the notification's `data` payload.
 *
 * Returns a cleanup function to remove the listener.
 */
export function onNotificationClicked(
  callback: (data: OneSignalNotificationData) => void
): () => void {
  if (!_initialized) return () => {}

  const handler = (event: any) => {
    const data = (event.notification.additionalData ?? {}) as OneSignalNotificationData
    callback(data)
  }

  OneSignal.Notifications.addEventListener('click', handler)
  return () => {
    OneSignal.Notifications.removeEventListener('click', handler)
  }
}
