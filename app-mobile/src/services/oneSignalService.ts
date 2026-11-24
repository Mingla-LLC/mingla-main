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
 * `requestPushPermission()` later (e.g. after coach mark tour); the latter opts
 * the subscription in once the user grants.
 */
export function initializeOneSignal(): void {
  if (_initialized) return
  if (__DEV__) logger.push('initializeOneSignal() called')
  try {
    OneSignal.Debug.setLogLevel(LogLevel.Verbose)
    OneSignal.initialize(ONESIGNAL_APP_ID)
    // ORCH-1260: pause ALL In-App Messages the instant the SDK is up, BEFORE any
    // IAM can auto-render during boot / while the iOS ATT prompt is pending. A
    // dashboard-configured IAM (no IAM code lives in this app) was auto-rendering
    // on app-open and CLUSTERING with the ATT prompt. Holding IAMs here — resumed
    // only AFTER the ATT decision (see resumeInAppMessages()) — guarantees the ATT
    // prompt is the SOLE first prompt at launch. Self-guarded in its own try/catch
    // so an IAM-pause failure never disrupts initialization (never throws).
    try {
      OneSignal.InAppMessages.setPaused(true)
      if (__DEV__) logger.push('in-app messages paused (pending ATT)')
    } catch (e) {
      console.warn('[OneSignal] InAppMessages.setPaused(true) failed:', e)
    }
    _initialized = true
    _initAttempts = 0
    if (__DEV__) logger.push('initialized')
    // #4238 W6-5 — hand the push token to listeners registered before init.
    attachPushTokenListeners()
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

// ─────────────────────────────────────────────────────────────────────────────
// #4238 W6-5 — the device push token, for AppsFlyer uninstall measurement
// ─────────────────────────────────────────────────────────────────────────────

type PushTokenListener = (token: string | null) => void
const _pushTokenListeners: PushTokenListener[] = []
let _pushTokenAttached = false

function emitPushToken(token: unknown): void {
  const value = typeof token === 'string' && token.length > 0 ? token : null
  for (const listener of _pushTokenListeners) {
    try {
      listener(value)
    } catch (e) {
      console.warn('[OneSignal] push token listener threw:', e)
    }
  }
}

type PushSubscriptionLike = {
  getTokenAsync?: () => Promise<string | null>
  addEventListener?: (event: 'change', cb: (e: { current?: { token?: string | null } }) => void) => void
}

/**
 * OneSignal v5 `User.pushSubscription`: the current token (APNs hex on iOS,
 * FCM on Android) once, then every change. Guarded so a partial native module
 * (or a partial test mock) never throws.
 */
function attachPushTokenListeners(): void {
  if (_pushTokenAttached || !_initialized || _pushTokenListeners.length === 0) return
  const sub = (OneSignal as { User?: { pushSubscription?: PushSubscriptionLike } }).User?.pushSubscription
  if (!sub) return
  _pushTokenAttached = true
  try {
    if (typeof sub.getTokenAsync === 'function') {
      void sub.getTokenAsync().then(emitPushToken).catch((e: unknown) => {
        console.warn('[OneSignal] getTokenAsync failed:', e)
      })
    }
    if (typeof sub.addEventListener === 'function') {
      sub.addEventListener('change', (e) => emitPushToken(e?.current?.token))
    }
  } catch (e) {
    console.warn('[OneSignal] push token watch failed:', e)
  }
}

/** #4238 W6-5: receive the push token now (when ready) and on every change. */
export function onPushSubscriptionToken(listener: PushTokenListener): void {
  _pushTokenListeners.push(listener)
  if (_pushTokenAttached) {
    const sub = (OneSignal as { User?: { pushSubscription?: PushSubscriptionLike } }).User?.pushSubscription
    if (typeof sub?.getTokenAsync === 'function') {
      void sub.getTokenAsync().then((t) => {
        try {
          listener(typeof t === 'string' && t.length > 0 ? t : null)
        } catch (e) {
          console.warn('[OneSignal] push token listener threw:', e)
        }
      }).catch(() => {})
    }
    return
  }
  attachPushTokenListeners()
}

/** Returns true if the SDK has been successfully initialized. */
export function isOneSignalReady(): boolean {
  return _initialized
}

// ─────────────────────────────────────────────────────────────────────────────
// In-App Messages (ORCH-1260)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resume OneSignal In-App Messages after the ATT decision has resolved.
 *
 * IAMs are PAUSED at init (see initializeOneSignal) so no dashboard IAM can
 * auto-render during boot and cluster with the iOS App Tracking Transparency
 * prompt — ATT must be the SOLE first prompt at launch. Once the ATT decision has
 * resolved (iOS: after the user answers the prompt; non-iOS: immediately, since
 * ATT is a no-op), the caller resumes IAMs so legitimate messages are delivered as
 * normal — just a few seconds later. IAMs are NEVER left permanently paused.
 *
 * Self-guards on `_initialized` (only resume if the SDK actually came up — if it
 * never initialized, IAMs were never paused either) and never throws. Mirrors the
 * pause call's own try/catch style.
 */
export function resumeInAppMessages(): void {
  if (!_initialized) return
  try {
    OneSignal.InAppMessages.setPaused(false)
    if (__DEV__) logger.push('in-app messages resumed (ATT resolved)')
  } catch (e) {
    console.warn('[OneSignal] InAppMessages.setPaused(false) failed:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// User identity + subscription (sequenced)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * #4517: the user the SDK is logged in as, the user we already opted in, and
 * the single in-flight-or-finished login for a user id. Cleared by logout.
 */
let _loginUserId: string | null = null
let _optedInUserId: string | null = null
let _loginFlight: { userId: string; promise: Promise<void> } | null = null

/**
 * Login + activate push subscription: link this device to a Supabase user ID
 * and, ONLY when the OS permission was already answered and granted, register
 * the push subscription.
 *
 * #4517: optIn() is NOT an unconditional sign-in step. The SDK's optIn() raises
 * the OS notification prompt when the user was never asked, and raises the
 * "notifications turned off / Open Settings" alert when they were asked and
 * declined (or are mid-prompt). The sign-in effect runs this up to four times per
 * launch, so an unconditional optIn() showed the prompt at sign-in and then the
 * false alert after Allow, and nagged decliners on every launch (Apple 4.5.4).
 * The OS prompt belongs to requestPushPermission() (after onboarding or on
 * reaching home); that call opts in once the user grants.
 *
 * Single-flight per user id: a call for a user whose login is in flight or has
 * already completed this session returns the same promise. Logout clears it.
 * Never throws.
 */
export function loginToOneSignal(userId: string): Promise<void> {
  if (!_initialized) {
    console.warn('[OneSignal] loginToOneSignal called before init — skipping')
    return Promise.resolve()
  }
  if (_loginFlight && _loginFlight.userId === userId) return _loginFlight.promise
  const flight = { userId, promise: runLogin(userId) }
  _loginFlight = flight
  return flight.promise
}

async function runLogin(userId: string): Promise<void> {
  try {
    await OneSignal.login(userId)
    _loginUserId = userId
    // ORCH-1264 (kept): read the true OS permission before deciding on optIn().
    // #4517: the read now decides WHETHER to opt in, not only how fresh the cache is.
    // A failed read means "unknown", which is treated as "do not opt in".
    let promptAnswered = false
    let granted = false
    try {
      promptAnswered = !(await OneSignal.Notifications.canRequestPermission())
      granted = await OneSignal.Notifications.getPermissionAsync()
    } catch (permErr) {
      console.warn('[OneSignal] pre-optIn permission read failed:', permErr)
    }
    if (promptAnswered && granted && _optedInUserId !== userId) {
      _optedInUserId = userId
      OneSignal.User.pushSubscription.optIn()
    }
    _loginComplete = true
    if (__DEV__) logger.push('login', { userId, optedIn: _optedInUserId === userId })
    // ORCH-1243: keep the OS-permission tag fresh once identity is established.
    await syncPushPermissionTag()
  } catch (e) {
    console.warn('[OneSignal] loginToOneSignal failed:', e)
    // Let a later call retry a failed login instead of replaying the failure.
    if (_loginFlight?.userId === userId) _loginFlight = null
  }
}

/**
 * Request OS-level notification permission (iOS prompt, Android 13+
 * POST_NOTIFICATIONS).
 *
 * Call AFTER the user has context for why they need notifications (after the
 * onboarding tour, or for a returning user on reaching home). Do NOT call on boot.
 *
 * #4517: when the user grants, this opts the push subscription in (once for the
 * logged-in user) and syncs the tag. If no user is logged in yet, loginToOneSignal
 * opts in later because it then finds the permission granted.
 *
 * ORCH-1244 (Apple Guideline 4.5.4): push must be optional + consent-based. We pass
 * `fallbackToSettings: false` so a user who already DECLINED is never nagged into
 * Settings. Callers gate this behind `canRequestPushPermission()` so the dialog is
 * only shown on a never-asked device.
 */
export async function requestPushPermission(): Promise<boolean> {
  if (!_initialized) {
    console.warn('[OneSignal] requestPushPermission called before init — skipping')
    return false
  }
  try {
    const granted = await OneSignal.Notifications.requestPermission(false)
    if (__DEV__) logger.push('permission result', { granted })
    if (granted === true && _loginUserId && _optedInUserId !== _loginUserId) {
      _optedInUserId = _loginUserId
      OneSignal.User.pushSubscription.optIn()
    }
    // ORCH-1243: a fresh grant/deny must update the tag immediately.
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
  // #4517: a later login (same or different user) must run again.
  _loginFlight = null
  _loginUserId = null
  _optedInUserId = null
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
