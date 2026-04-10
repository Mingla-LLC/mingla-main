import { OneSignal, LogLevel } from 'react-native-onesignal'
import { logger } from '../utils/logger'

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
let _loginComplete = false

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
 * after the user has context. Call `loginToOneSignal()` on auth, then
 * `requestPushPermission()` later (e.g. after coach mark tour).
 */
export function initializeOneSignal(): void {
  if (_initialized) return
  if (__DEV__) logger.push('initializeOneSignal() called')
  try {
    OneSignal.Debug.setLogLevel(LogLevel.Verbose)
    OneSignal.initialize(ONESIGNAL_APP_ID)
    _initialized = true
    _initAttempts = 0
    if (__DEV__) logger.push('initialized')
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
 * Login only: link this device to a Supabase user ID.
 *
 * Call on auth. Does NOT request notification permission — that is deferred
 * to `requestPushPermission()` so the user isn't bombarded with OS dialogs
 * on first landing.
 */
export async function loginToOneSignal(userId: string): Promise<void> {
  if (!_initialized) {
    console.warn('[OneSignal] loginToOneSignal called before init — skipping')
    return
  }
  try {
    await OneSignal.login(userId)
    if (__DEV__) logger.push('login', { userId })
  } catch (e) {
    console.warn('[OneSignal] loginToOneSignal failed:', e)
  }
}

/**
 * Request OS-level notification permission and opt in to push delivery.
 *
 * Call AFTER the user has context for why they need notifications (e.g. after
 * coach mark tour completes). Do NOT call on app boot.
 *
 * Order matters in SDK v5:
 *   1. login(userId) must have been called first (via loginToOneSignal)
 *   2. requestPermission — asks the OS for POST_NOTIFICATIONS (Android 13+)
 *   3. optIn() — tells OneSignal this user WANTS push delivery
 */
export async function requestPushPermission(): Promise<boolean> {
  if (!_initialized) {
    console.warn('[OneSignal] requestPushPermission called before init — skipping')
    return false
  }
  try {
    const granted = await OneSignal.Notifications.requestPermission(true)
    if (__DEV__) logger.push('permission result', { granted })

    await OneSignal.User.pushSubscription.optIn()
    _loginComplete = true
    if (__DEV__) logger.push('subscription opted in')
    return granted
  } catch (e) {
    console.warn('[OneSignal] requestPushPermission failed:', e)
    return false
  }
}

/**
 * Unlink the OneSignal player from the current user.
 * Call immediately after Supabase sign-out.
 */
export function logoutOneSignal(): void {
  if (!_initialized) return
  _loginComplete = false
  try {
    OneSignal.logout()
    if (__DEV__) logger.push('logout')
  } catch (e) {
    console.warn('[OneSignal] logout failed:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely clear all OneSignal notifications and reset the iOS badge to 0.
 *
 * Guards:
 *   1. SDK must be initialised (`_initialized`)
 *   2. Login sequence must have completed (`_loginComplete`)
 *   3. Entire call is wrapped in try/catch to prevent native ObjC exceptions
 *      from propagating through the TurboModule bridge → std::terminate → SIGABRT
 *
 * This is the ONLY safe way to call OneSignal.Notifications.clearAll().
 * Consumers must NEVER import OneSignal directly.
 */
export function clearNotificationBadge(): void {
  if (!_initialized || !_loginComplete) return
  try {
    OneSignal.Notifications.clearAll()
  } catch (e) {
    console.warn('[OneSignal] clearAll failed:', e)
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
    if (__DEV__) {
      logger.push('foreground received', {
        type: data.type ?? '(unknown)',
        title: event.getNotification().title ?? '(no title)',
        data,
      })
    }
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
    if (__DEV__) {
      logger.push('notification tapped', {
        type: data.type ?? '(unknown)',
        data,
      })
    }
    callback(data)
  }

  OneSignal.Notifications.addEventListener('click', handler)
  return () => {
    OneSignal.Notifications.removeEventListener('click', handler)
  }
}
