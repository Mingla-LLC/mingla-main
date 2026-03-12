import { OneSignal, LogLevel } from 'react-native-onesignal'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ONESIGNAL_APP_ID = '388b3efc-14c2-4de2-98cb-68c818be9f06'
const MAX_INIT_RETRIES = 3
const RETRY_DELAY_MS = 3000

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

let _initialized = false
let _initAttempts = 0

/**
 * Initialize the OneSignal SDK. Call once at app startup before any other
 * OneSignal methods. Safe to call again — subsequent calls are no-ops.
 *
 * If initialization fails (e.g. network, SDK error), retries up to 3 times
 * with a 3-second delay. Without a successful init, all other OneSignal
 * calls (login, optIn, listeners) silently no-op.
 *
 * NOTE: This does NOT request notification permission. On Android 13+,
 * POST_NOTIFICATIONS is a runtime permission that should only be requested
 * after the user has context (i.e. after login). Call `loginAndSubscribe()`
 * separately after authentication succeeds.
 */
export function initializeOneSignal(): void {
  if (_initialized) return
  console.log('[OneSignal] initializeOneSignal() called')
  try {
    OneSignal.Debug.setLogLevel(LogLevel.Verbose)
    OneSignal.initialize(ONESIGNAL_APP_ID)
    _initialized = true
    _initAttempts = 0
    console.log('[OneSignal] initialized')
  } catch (e) {
    _initAttempts++
    console.warn(`[OneSignal] Initialization failed (attempt ${_initAttempts}/${MAX_INIT_RETRIES}):`, e)
    if (_initAttempts < MAX_INIT_RETRIES) {
      setTimeout(initializeOneSignal, RETRY_DELAY_MS)
    } else {
      console.error('[OneSignal] All init attempts exhausted. Push notifications will not work this session.')
    }
  }
}

/** Returns true if the SDK has been successfully initialized. */
export function isOneSignalReady(): boolean {
  return _initialized
}

// ─────────────────────────────────────────────────────────────────────────────
// User identity + subscription (sequenced)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full login sequence: link device to user, request OS permission, opt in.
 *
 * Order matters in SDK v5:
 *   1. login(userId)     — tells OneSignal WHO this device belongs to
 *   2. requestPermission — asks the OS for POST_NOTIFICATIONS (Android 13+)
 *   3. optIn()           — tells OneSignal this user WANTS push delivery
 *
 * All three must succeed for backend pushes targeting external_id to arrive.
 * Each step is awaited so the next one runs only after the previous completes.
 */
export async function loginAndSubscribe(userId: string): Promise<void> {
  if (!_initialized) {
    console.warn('[OneSignal] loginAndSubscribe called before init — skipping')
    return
  }
  try {
    // Step 1: Link device to Supabase user ID.
    // MUST await — without it, requestPermission and optIn fire before the
    // backend associates this device with the external_id, causing the
    // subscription to register as anonymous.
    await OneSignal.login(userId)
    console.log('[OneSignal] login:', userId)

    // Step 2: Request OS-level notification permission
    // On Android 13+ this shows the runtime POST_NOTIFICATIONS dialog.
    // On older Android this is a no-op (permission granted at install).
    const granted = await OneSignal.Notifications.requestPermission(true)
    console.log('[OneSignal] permission result:', granted)

    // Step 3: Opt in to OneSignal's push subscription.
    // Even if OS permission is denied, calling optIn is safe — OneSignal
    // will deliver once permission is later granted in system settings.
    await OneSignal.User.pushSubscription.optIn()
    console.log('[OneSignal] subscription opted in')
  } catch (e) {
    console.warn('[OneSignal] loginAndSubscribe failed:', e)
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
  if (!_initialized) {
    console.warn('[OneSignal] onForegroundNotification called before init — listener not registered')
    return () => {}
  }

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
  if (!_initialized) {
    console.warn('[OneSignal] onNotificationClicked called before init — listener not registered')
    return () => {}
  }

  const handler = (event: any) => {
    const data = (event.notification.additionalData ?? {}) as OneSignalNotificationData
    callback(data)
  }

  OneSignal.Notifications.addEventListener('click', handler)
  return () => {
    OneSignal.Notifications.removeEventListener('click', handler)
  }
}
