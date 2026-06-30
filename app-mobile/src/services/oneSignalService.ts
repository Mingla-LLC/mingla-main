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
    // ORCH-1243: seed the OS-permission tag as soon as the SDK is up so the
    // launch In-App Message audience can read TRUE permission, not OneSignal's
    // async subscription state. Fire-and-forget; self-guards on _initialized.
    void syncPushPermissionTag()
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
    // ORCH-1243: keep the OS-permission tag fresh once identity + subscription
    // are established (the tag is now attached to the logged-in user).
    await syncPushPermissionTag()
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
 *
 * ORCH-1244 (Apple Guideline 4.5.4): push must be optional + consent-based.
 * We pass `fallbackToSettings: false` so a user who already DECLINED is NOT
 * nagged into the iOS Settings app — their choice is respected silently. The
 * first OS dialog still shows (it already carries a real "Don't Allow"); a prior
 * denial is never re-surfaced. Callers gate this behind `canRequestPushPermission()`
 * so the dialog is only ever shown on a never-asked device.
 */
export async function requestPushPermission(): Promise<boolean> {
  if (!_initialized) {
    console.warn('[OneSignal] requestPushPermission called before init — skipping')
    return false
  }
  try {
    // ORCH-1244: fallbackToSettings = false (was true). `true` steered a
    // previously-declining user into the iOS Settings app to flip notifications
    // on — the textbook 4.5.4 "push feels mandatory" trigger. `false` respects
    // the user's decline.
    const granted = await OneSignal.Notifications.requestPermission(false)
    if (__DEV__) logger.push('permission result', { granted })
    // optIn() already called at login — no need to call again here (ORCH-0407)
    // ORCH-1243: a fresh grant/deny from the OS dialog must update the tag
    // immediately so the In-App Message audience reconciles right away.
    await syncPushPermissionTag()
    return granted
  } catch (e) {
    console.warn('[OneSignal] requestPushPermission failed:', e)
    return false
  }
}

/**
 * ORCH-1244 (Apple Guideline 4.5.4): true only when the OS can STILL be asked
 * for push permission — i.e. the device has not been prompted yet. Once the user
 * has answered (allow OR deny), this returns false and the caller must NOT
 * re-surface the OS dialog.
 *
 * Wraps OneSignal v5 `Notifications.canRequestPermission(): Promise<boolean>`
 * (node_modules/react-native-onesignal/dist/index.d.ts:366). Lives here so the
 * OneSignal import stays isolated to this service (import-isolation invariant);
 * permissionOrchestrator calls THIS, never OneSignal directly. Self-guards on
 * `_initialized` and never throws — returns false if the SDK isn't up (we cannot
 * safely prompt before init anyway).
 */
export async function canRequestPushPermission(): Promise<boolean> {
  if (!_initialized) return false
  try {
    return await OneSignal.Notifications.canRequestPermission()
  } catch (e) {
    console.warn('[OneSignal] canRequestPushPermission failed:', e)
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OS-permission tag (ORCH-1243)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirror the device's TRUE OS notification permission into a OneSignal tag.
 *
 * TAG CONTRACT:
 *   key   = `push_os_permission`
 *   value ∈ { `granted`, `denied` }
 *
 * Consumed by the launch "turn on notifications" In-App Message audience.
 * The dashboard message must target this TAG (show when
 * `push_os_permission != granted`) instead of OneSignal's subscription state:
 * OneSignal v5 registers the push subscription ASYNCHRONOUSLY, so at launch the
 * audience can see a device as "not subscribed" even when iOS permission is
 * GRANTED → false "notifications are off" popup. The OS permission read below is
 * synchronous truth, so the tag is reliable.
 *
 * Kept fresh by calling at init, login, after the permission dialog, and on app
 * foreground (so returning from iOS Settings reconciles the tag). Self-guards on
 * `_initialized` and never throws.
 */
export async function syncPushPermissionTag(): Promise<void> {
  if (!_initialized) return
  try {
    // OneSignal v5 (react-native-onesignal 5.3.3) — TRUE OS permission read:
    //   Notifications.getPermissionAsync(): Promise<boolean>
    //   (node_modules/react-native-onesignal/dist/index.d.ts:355). hasPermission()
    //   is deprecated in favour of this async form (index.d.ts:348-350).
    const granted = await OneSignal.Notifications.getPermissionAsync()
    // addTag(key, value): void — index.d.ts:325 (addTags({...}) is the bulk form).
    OneSignal.User.addTag('push_os_permission', granted ? 'granted' : 'denied')
    if (__DEV__) logger.push('os-permission tag synced', { granted })
  } catch (e) {
    console.warn('[OneSignal] syncPushPermissionTag failed:', e)
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
