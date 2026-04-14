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
 * Login + activate push subscription: link this device to a Supabase user ID
 * and register for push delivery.
 *
 * ORCH-0407: optIn() moved here from requestPushPermission(). Without optIn(),
 * the device is logged in but has no active push subscription — OneSignal
 * returns invalid_aliases when you try to send push. optIn() registers the
 * subscription immediately; requestPermission() (OS dialog) is still deferred
 * to the coach mark tour. These are separate concerns:
 *   - optIn() = "register this device for push delivery" (server-side)
 *   - requestPermission() = "let the OS show banners" (client-side)
 *
 * Revert: move optIn() back to requestPushPermission() if immediate
 * subscription causes issues.
 */
export async function loginToOneSignal(userId: string): Promise<void> {
  if (!_initialized) {
    console.warn('[OneSignal] loginToOneSignal called before init — skipping')
    return
  }
  try {
    await OneSignal.login(userId)
    await OneSignal.User.pushSubscription.optIn()
    _loginComplete = true
    if (__DEV__) logger.push('login + optIn', { userId })
  } catch (e) {
    console.warn('[OneSignal] loginToOneSignal failed:', e)
  }
}

/**
 * Request OS-level notification permission (Android 13+ POST_NOTIFICATIONS).
 *
 * Call AFTER the user has context for why they need notifications (e.g. after
 * coach mark tour completes). Do NOT call on app boot.
 *
 * NOTE: optIn() is now called at login time (loginToOneSignal), not here.
 * This function only handles the OS permission dialog. The push subscription
 * is already active by the time this runs.
 */
export async function requestPushPermission(): Promise<boolean> {
  if (!_initialized) {
    console.warn('[OneSignal] requestPushPermission called before init — skipping')
    return false
  }
  try {
    const granted = await OneSignal.Notifications.requestPermission(true)
    if (__DEV__) logger.push('permission result', { granted })
    // optIn() already called at login — no need to call again here (ORCH-0407)
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
 * OneSignal SDK v5 requires an EXPLICIT `display()` call to show the notification
 * in the system tray. Without it, the notification is received but not shown.
 * The `prevent` callback suppresses display entirely.
 *
 * ORCH-0407: Updated to pass `display` alongside `prevent`. Callers must call
 * `display()` to show the banner, or `prevent()` to suppress it, or neither
 * (notification will NOT auto-display in SDK v5 — this was a bug).
 *
 * Returns a cleanup function to remove the listener.
 */
export function onForegroundNotification(
  callback: (data: OneSignalNotificationData, prevent: () => void, display: () => void) => void
): () => void {
  if (!_initialized) {
    console.warn('[OneSignal] onForegroundNotification called before init — listener not registered')
    return () => {}
  }

  const handler = (event: any) => {
    const notification = event.getNotification()
    const data = (notification.additionalData ?? {}) as OneSignalNotificationData
    if (__DEV__) {
      logger.push('foreground received', {
        type: data.type ?? '(unknown)',
        title: notification.title ?? '(no title)',
        data,
      })
    }
    callback(
      data,
      () => event.preventDefault(),
      () => notification.display(),
    )
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
