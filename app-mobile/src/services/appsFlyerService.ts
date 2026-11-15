import appsFlyer from 'react-native-appsflyer'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { supabase } from './supabase'
import { resolveOneLinkDestination, OneLinkDestination } from './oneLinkResolver'
import { captureNativeOneLinkAttribution } from './nativeAdAttributionService'

// ORCH-1318 — the branded OneLink subdomain the SDK must treat as a OneLink
// host at runtime (SPEC §C.1). EXACT constant, shared with oneLinkShare.ts.
const ONELINK_BRAND_DOMAIN = 'go.usemingla.com'

// ─────────────────────────────────────────────────────────────────────────────
// Constants — ORCH-1313 (§4.C) env-driven (single-source + fail-loud on release)
//
// Read from the app.config `extra` block FIRST, then process.env — mirroring
// supabase.ts. A DYNAMIC process.env read is NOT inlined by babel-preset-expo and
// is undefined in Hermes standalone/OTA builds (COMMS-0028), so `extra` is the
// build-safe path. The dev fallback lives in app.config.js (release builds fail
// loud if the env is unset); on any correctly-built binary these resolve to a
// real value, so hasAppsFlyerEnv is defense-in-depth for a misconfigured dev build.
// ─────────────────────────────────────────────────────────────────────────────

const AF_DEV_KEY =
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_APPSFLYER_DEV_KEY as string | undefined) ??
  process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY
const AF_IOS_APP_ID =
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID as string | undefined) ??
  process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID
const AF_ANDROID_APP_ID =
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID as string | undefined) ??
  process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID
const hasAppsFlyerEnv =
  Boolean(AF_DEV_KEY) && Boolean(AF_IOS_APP_ID) && Boolean(AF_ANDROID_APP_ID)

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

let _initialized = false
let _started = false
const registeredDeviceKeys = new Set<string>()

// ─────────────────────────────────────────────────────────────────────────────
// #4238 W6-1 (I-4238-AF-START-NEVER-LOST) — the ATT gate can resolve before
// initSdk's callback has run. A start, customer id or device registration that
// arrives first is held and applied exactly once after init; events logged
// before the SDK is transmitting are queued (oldest dropped past the cap) and
// replayed in order. Sign-out drops the queue.
// ─────────────────────────────────────────────────────────────────────────────
export const PRE_START_EVENT_QUEUE_MAX = 50
let _startPending = false
let _pendingUserId: string | null = null
let _pendingDeviceUserId: string | null = null
let _eventQueue: Array<{ name: string; values: Record<string, string | number | boolean> }> = []

// #4238 W6-6 / W6-11 / W6-5 state.
let _anonymized: boolean | null = null
let _privacySubscribed = false
let _pushTokenWatched = false
let _signedInUserId: string | null = null
let _emailSetForUserId: string | null = null
let _lastUninstallToken: string | null = null
let _pendingUninstallToken: string | null = null

/**
 * #4238 W6-11 (Step 0 Z22): AppsFlyer `emailsCryptType` 3 = SHA-256; the SDK
 * hashes the plain email. Never 2 — the 6.x iOS bridge maps it to "none" and
 * would send plain text. setUserEmails is the 6.x plugin API (7.x renames it).
 */
export const APPSFLYER_EMAIL_CRYPT_SHA256 = 3

// Lazy requires: these modules are only needed at runtime, and a test or
// render harness that mocks this service's neighbours must never load them.
type AnalyticsStoreLike = {
  getState: () => { analyticsOptOut?: boolean }
  subscribe: (l: (s: { analyticsOptOut?: boolean }, p: { analyticsOptOut?: boolean }) => void) => () => void
}
function analyticsStore(): AnalyticsStoreLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('../store/appStore') as { useAppStore: AnalyticsStoreLike }).useAppStore
  } catch {
    return null
  }
}
type AsyncStorageLike = {
  getItem: (k: string) => Promise<string | null>
  setItem: (k: string, v: string) => Promise<void>
}
function asyncStorage(): AsyncStorageLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@react-native-async-storage/async-storage') as { default: AsyncStorageLike }).default
  } catch {
    return null
  }
}

/** #4238 W6-6 (I-4238-AF-RESPECTS-OPT-OUT): the Account "share usage data" switch. */
function isAnalyticsOptedOut(): boolean {
  try {
    return analyticsStore()?.getState().analyticsOptOut === true
  } catch {
    return false
  }
}

/**
 * #4238 P2-2 (W6-6, I-4238-AF-DMA-CONSENT): DMA consent for EU / EEA / UK
 * devices from the same switch. Called before startSdk (init callback) and on
 * every change. Lazy, like the store: a harness without it sends nothing.
 */
function deviceRegionCode(consent: typeof import('./appsFlyerConsent')): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const localization = require('expo-localization') as {
      getLocales?: () => Array<{ regionCode?: string | null }>
    }
    const region = localization.getLocales?.()[0]?.regionCode
    if (typeof region === 'string' && region.length > 0) return region
  } catch {
    // fall through to the Intl locale
  }
  return consent.intlDeviceRegion()
}

function applyConsentData(): void {
  if (typeof appsFlyer.setConsentData !== 'function') return
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const consent = require('./appsFlyerConsent') as typeof import('./appsFlyerConsent')
    appsFlyer.setConsentData(
      consent.appsFlyerConsentFor(isAnalyticsOptedOut(), deviceRegionCode(consent)),
    )
  } catch (e) {
    console.warn('[AppsFlyer] setConsentData failed:', e)
  }
}

/** #4238 W6-6: anonymize AppsFlyer while analytics is off; restore on re-enable. */
function applyPrivacyChoice(): void {
  if (!_initialized) return
  const optedOut = isAnalyticsOptedOut()
  if (_anonymized === optedOut) return
  const wasOptedOut = _anonymized === true
  try {
    if (typeof appsFlyer.anonymizeUser === 'function') {
      appsFlyer.anonymizeUser(optedOut, () => {
        if (__DEV__) console.log('[AppsFlyer] anonymizeUser:', optedOut)
      })
    }
  } catch (e) {
    console.warn('[AppsFlyer] anonymizeUser failed:', e)
  }
  _anonymized = optedOut
  if (optedOut) {
    _eventQueue = []
    clearAppsFlyerUserEmails()
  } else if (wasOptedOut && _signedInUserId) {
    void syncAppsFlyerUserEmail(_signedInUserId)
  }
}

/**
 * #4238 P1-4 (I-4238-AF-SERVER-RESPECTS-OPT-OUT): tell the server this
 * person's installs changed their "share usage data" choice, so server posts
 * (af_purchase, referrals) skip an opted-out install. Logged, never thrown.
 */
function syncDeviceOptOut(): void {
  const userId = _signedInUserId
  if (!userId) return
  try {
    void Promise.resolve(
      supabase
        .from('appsflyer_devices')
        .update({ tracking_opt_out: isAnalyticsOptedOut() })
        .eq('user_id', userId)
        .eq('app', 'consumer'),
    ).then(
      (res: { error?: { message?: string } | null } | undefined) => {
        if (res?.error) console.warn('[AppsFlyer] device opt-out sync failed:', res.error.message)
      },
      (e: unknown) => console.warn('[AppsFlyer] device opt-out sync failed:', e),
    )
  } catch (e) {
    console.warn('[AppsFlyer] device opt-out sync unavailable:', e)
  }
}

function subscribePrivacyChoice(): void {
  if (_privacySubscribed) return
  const store = analyticsStore()
  if (!store || typeof store.subscribe !== 'function') return
  try {
    store.subscribe((state, prev) => {
      if (state.analyticsOptOut !== prev.analyticsOptOut) {
        applyPrivacyChoice()
        applyConsentData()
        syncDeviceOptOut()
      }
    })
    _privacySubscribed = true
  } catch (e) {
    console.warn('[AppsFlyer] privacy subscription unavailable:', e)
  }
}

/** #4238 W6-11: the signed-in user's email to AppsFlyer, SHA-256 by the SDK. */
async function syncAppsFlyerUserEmail(userId: string): Promise<void> {
  if (!_initialized || typeof appsFlyer.setUserEmails !== 'function') return
  if (isAnalyticsOptedOut() || _emailSetForUserId === userId) return
  let email: string | null = null
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.id !== userId) return
    email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : null
  } catch (e) {
    console.warn('[AppsFlyer] email lookup failed:', e)
    return
  }
  if (!email || _signedInUserId !== userId) return
  try {
    appsFlyer.setUserEmails(
      { emails: [email], emailsCryptType: APPSFLYER_EMAIL_CRYPT_SHA256 },
      () => {
        if (__DEV__) console.log('[AppsFlyer] setUserEmails (SHA-256) ok')
      },
      (err: unknown) => console.warn('[AppsFlyer] setUserEmails failed:', err),
    )
    _emailSetForUserId = userId
  } catch (e) {
    console.warn('[AppsFlyer] setUserEmails threw:', e)
  }
}

function clearAppsFlyerUserEmails(): void {
  _emailSetForUserId = null
  if (!_initialized || typeof appsFlyer.setUserEmails !== 'function') return
  try {
    appsFlyer.setUserEmails(
      { emails: [], emailsCryptType: APPSFLYER_EMAIL_CRYPT_SHA256 },
      () => {},
      (err: unknown) => console.warn('[AppsFlyer] clear emails failed:', err),
    )
  } catch (e) {
    console.warn('[AppsFlyer] clear emails threw:', e)
  }
}

export type UninstallTokenVerdict =
  | { ok: true; token: string }
  | { ok: false; reason: 'empty' | 'not_apns_hex' | 'android_fid' | 'not_fcm' }

/**
 * #4238 W6-5 (Step 0 Z14): iOS takes the APNs token as hex (OneSignal v5's
 * getTokenAsync returns lower-case hex); Android takes the FCM registration
 * token. A Firebase Installation ID (22 url-safe chars) cannot measure
 * uninstalls and is refused.
 */
export function classifyUninstallToken(token: string | null | undefined, platform: string): UninstallTokenVerdict {
  const raw = typeof token === 'string' ? token.trim() : ''
  if (raw.length === 0) return { ok: false, reason: 'empty' }
  if (platform === 'ios') {
    const hex = raw.replace(/[<>\s]/g, '').toLowerCase()
    return /^[0-9a-f]{64,}$/.test(hex) ? { ok: true, token: hex } : { ok: false, reason: 'not_apns_hex' }
  }
  if (/^[A-Za-z0-9_-]{1,32}$/.test(raw)) return { ok: false, reason: 'android_fid' }
  return raw.length >= 100 ? { ok: true, token: raw } : { ok: false, reason: 'not_fcm' }
}

/**
 * #4238 W6-5: pass the device push token to AppsFlyer for uninstall
 * measurement, once per token change; held until init. Skipped when opted out.
 */
export function updateAppsFlyerUninstallToken(token: string | null | undefined): void {
  const verdict = classifyUninstallToken(token, Platform.OS)
  if (!verdict.ok) {
    if (verdict.reason === 'android_fid') {
      console.error(
        '[AppsFlyer] uninstall token skipped: OneSignal returned a Firebase Installation ID, not an FCM token. Uninstall measurement is OFF on this device (#4238 W6-5).',
      )
    } else if (verdict.reason !== 'empty') {
      console.warn(`[AppsFlyer] uninstall token skipped (${verdict.reason}).`)
    }
    return
  }
  if (verdict.token === _lastUninstallToken || isAnalyticsOptedOut()) return
  if (!_initialized) {
    _pendingUninstallToken = verdict.token
    return
  }
  if (typeof appsFlyer.updateServerUninstallToken !== 'function') return
  try {
    appsFlyer.updateServerUninstallToken(verdict.token, () => {
      if (__DEV__) console.log('[AppsFlyer] updateServerUninstallToken ok')
    })
    _lastUninstallToken = verdict.token
    _pendingUninstallToken = null
  } catch (e) {
    console.warn('[AppsFlyer] updateServerUninstallToken failed:', e)
  }
}

function watchPushTokenForUninstall(): void {
  if (_pushTokenWatched) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { onPushSubscriptionToken } = require('./oneSignalService') as {
      onPushSubscriptionToken?: (l: (t: string | null) => void) => void
    }
    if (typeof onPushSubscriptionToken !== 'function') return
    onPushSubscriptionToken(updateAppsFlyerUninstallToken)
    _pushTokenWatched = true
  } catch (e) {
    console.warn('[AppsFlyer] push token watch unavailable:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCH-1318 — OneLink deferred deep-link plumbing.
//
// The `onDeepLink` subscription is registered ONCE inside initializeAppsFlyer
// (after initSdk success, before any startAppsFlyer/startSdk — AppsFlyer drops a
// deferred link that resolves before the listener exists). Registering a
// listener is transmission-inert: it does NOT start the SDK, so the
// ATT-before-transmit invariant (I-ONELINK-NO-TRANSMIT-BEFORE-ATT) is preserved
// — only startAppsFlyer() (behind the ATT gate in index.tsx) transmits.
//
// The service NEVER navigates. It resolves a FOUND payload to a typed
// OneLinkDestination (the ONE resolver — I-ONELINK-SINGLE-RESOLVER) and forwards
// it to the UI sink the app registers via subscribeOneLinkDeepLink. If a
// destination resolves before the sink is registered (deferred link resolves
// faster than mount), it is buffered and flushed once when the sink arrives.
// ─────────────────────────────────────────────────────────────────────────────
let _deepLinkSubscribed = false
let _deepLinkUnsub: (() => void) | null = null
let _oneLinkSink: ((dest: OneLinkDestination) => void) | null = null
let _bufferedDestination: OneLinkDestination = null
// Double-fire dedup: the SDK can re-emit the same link on resume. A second
// identical `res.data.link` within this window is a no-op (SPEC §A.4.1).
const DEEPLINK_DEDUP_WINDOW_MS = 5000
let _lastHandledLink: string | null = null
let _lastHandledAt = 0

/**
 * Initialize the AppsFlyer SDK. Call once at app startup.
 *
 * Configured with `manualStart: true` — the SDK loads but does not transmit
 * until `startAppsFlyer()` is called. This gives us a window to fire the iOS
 * ATT (App Tracking Transparency) prompt first, so AppsFlyer has a final
 * IDFA value when transmission begins (real IDFA if user allowed, zeroed
 * IDFA if denied — either way, no race condition).
 *
 * The ATT prompt + startAppsFlyer() pair is wired in app/index.tsx
 * (ORCH-0977 — replaces the never-implemented ORCH-0349 plan).
 */
export function initializeAppsFlyer(): void {
  if (_initialized) return
  // ORCH-1313 (§4.C) — defense-in-depth env guard. `hasAppsFlyerEnv` is the
  // single-source flag; the explicit per-value checks also narrow the types to
  // `string` for the initSdk config below. On release builds the app.config guard
  // guarantees these are present, so this warn only fires in a misconfigured dev
  // build. Constitution #3 — never fail silently.
  if (!hasAppsFlyerEnv || !AF_DEV_KEY || !AF_IOS_APP_ID || !AF_ANDROID_APP_ID) {
    console.warn(
      '[AppsFlyer] env missing — init skipped. Set EXPO_PUBLIC_APPSFLYER_DEV_KEY + EXPO_PUBLIC_APPSFLYER_IOS_APP_ID + EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID.',
    )
    return
  }
  // ORCH-1318 — register onDeepLink BEFORE initSdk fires. AppsFlyer requires the
  // unified deep-link callback exist before the SDK starts, else a deferred link
  // resolving during the first session is dropped. This is transmission-inert
  // (it does NOT start the SDK) so the ATT gate is untouched.
  registerOneLinkDeepLink()
  // #4238 W6-6 / W6-5 — follow the privacy switch and the push token.
  subscribePrivacyChoice()
  watchPushTokenForUninstall()
  try {
    appsFlyer.initSdk(
      {
        devKey: AF_DEV_KEY,
        isDebug: __DEV__,
        appId: Platform.OS === 'ios' ? AF_IOS_APP_ID : undefined,
        // ORCH-1318 — ENABLE the listeners. This only wires the callbacks; it does
        // NOT transmit. Transmission stays gated by manualStart + startAppsFlyer()
        // (I-ONELINK-NO-TRANSMIT-BEFORE-ATT).
        onInstallConversionDataListener: true,
        onDeepLinkListener: true,
        manualStart: true,
      },
      (result: unknown) => {
        if (__DEV__) console.log('[AppsFlyer] SDK initialized:', result)
        _initialized = true
        // #4238 W6-1 / W6-6 — apply what arrived before init, exactly once:
        // the privacy choice first, then identity, then a held start (which
        // replays the queued events). #4238 P2-2: DMA consent before startSdk.
        applyConsentData()
        applyPrivacyChoice()
        const pendingUserId = _pendingUserId
        _pendingUserId = null
        if (pendingUserId) setAppsFlyerUserId(pendingUserId)
        const pendingDeviceUserId = _pendingDeviceUserId
        _pendingDeviceUserId = null
        if (pendingDeviceUserId) registerAppsFlyerDevice(pendingDeviceUserId)
        if (_pendingUninstallToken) updateAppsFlyerUninstallToken(_pendingUninstallToken)
        if (_startPending) {
          _startPending = false
          startAppsFlyer()
        }
        // ORCH-1318 (SPEC §C.1) — register the branded subdomain so the SDK
        // resolves go.usemingla.com links as OneLinks. Safe post-init; no-op on
        // the *.onelink.me fallback domain.
        try {
          appsFlyer.setOneLinkCustomDomains(
            [ONELINK_BRAND_DOMAIN],
            (r: unknown) => {
              if (__DEV__) console.log('[AppsFlyer] OneLink custom domain set:', r)
            },
            (err: unknown) => {
              console.warn('[AppsFlyer] setOneLinkCustomDomains failed:', err)
            },
          )
        } catch (e) {
          console.warn('[AppsFlyer] setOneLinkCustomDomains threw:', e)
        }
      },
      (error: unknown) => {
        console.warn('[AppsFlyer] SDK initialization failed:', error)
      },
    )
  } catch (e) {
    console.warn('[AppsFlyer] Native module not available:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCH-1318 — OneLink deep-link listener + sink
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register the single `appsFlyer.onDeepLink` subscription (idempotent). Called
 * from initializeAppsFlyer BEFORE initSdk. The callback:
 *   1. ignores any non-FOUND status (log-only — a NOT_FOUND on an organic open
 *      is expected; never a warning storm, never navigation — SPEC §A.4.2),
 *   2. dedups a double-fire by `res.data.link` within a short window (§A.4.1),
 *   3. resolves the payload via the ONE resolver, and
 *   4. forwards the destination to the UI sink — or buffers it if the sink is
 *      not yet registered (deferred resolves faster than mount — §A.4.3).
 * It NEVER navigates (the service has no router).
 */
function registerOneLinkDeepLink(): void {
  if (_deepLinkSubscribed) return
  try {
    _deepLinkUnsub = appsFlyer.onDeepLink((res: any) => {
      try {
        if (!res || res.deepLinkStatus !== 'FOUND') {
          if (__DEV__) {
            console.log('[AppsFlyer] onDeepLink non-FOUND (no-op):', res?.deepLinkStatus)
          }
          return
        }
        const data = (res.data ?? {}) as Record<string, any>
        void captureNativeOneLinkAttribution(data)
        // Double-fire dedup (SPEC §A.4.1).
        const link = typeof data.link === 'string' ? data.link : ''
        const now = Date.now()
        if (link && link === _lastHandledLink && now - _lastHandledAt < DEEPLINK_DEDUP_WINDOW_MS) {
          if (__DEV__) console.log('[AppsFlyer] onDeepLink duplicate emission ignored')
          return
        }
        _lastHandledLink = link
        _lastHandledAt = now

        const dest = resolveOneLinkDestination(data)
        if (!dest) {
          if (__DEV__) console.log('[AppsFlyer] onDeepLink FOUND but unresolvable payload:', data)
          return
        }
        if (_oneLinkSink) {
          _oneLinkSink(dest)
        } else {
          // Buffer the last FOUND destination until the UI sink registers (§A.4.3).
          _bufferedDestination = dest
        }
      } catch (e) {
        console.warn('[AppsFlyer] onDeepLink handler failed:', e)
      }
    })
    _deepLinkSubscribed = true
  } catch (e) {
    // Native module absent (Expo Go / dev-client) → clean no-op (SPEC §A.4.4).
    console.warn('[AppsFlyer] onDeepLink registration skipped (native module?):', e)
  }
}

/**
 * Register the UI sink that receives resolved OneLink destinations. Call ONCE
 * from the app shell (index.tsx) inside the same effect that owns
 * initializeAppsFlyer, so the sink exists for the buffered-flush. If a
 * destination resolved before the sink was registered, it is flushed exactly
 * once here, then cleared (SPEC §A.4.3).
 */
export function subscribeOneLinkDeepLink(onDestination: (dest: OneLinkDestination) => void): void {
  _oneLinkSink = onDestination
  if (_bufferedDestination) {
    const buffered = _bufferedDestination
    _bufferedDestination = null
    onDestination(buffered)
  }
}

/**
 * Android-only: force a cold-start `onDeepLink` resolution pass. Invoke once
 * right AFTER startAppsFlyer() (post-ATT) so the deferred link resolves with the
 * settled GAID state. iOS resolves via the AppDelegate hooks the Expo plugin
 * injects — no equivalent call (SPEC §A.1.3 / §A.3).
 */
export function triggerAndroidDeferredResolution(): void {
  if (Platform.OS !== 'android') return
  try {
    appsFlyer.performOnDeepLinking()
  } catch (e) {
    console.warn('[AppsFlyer] performOnDeepLinking failed:', e)
  }
}

/**
 * Start AppsFlyer transmission. Must be called AFTER iOS ATT has resolved
 * (or immediately on Android, where ATT is a no-op).
 *
 * Idempotent — safe to call multiple times; only the first call has effect.
 */
export function startAppsFlyer(): void {
  if (_started) return
  if (!_initialized) {
    // #4238 W6-1: ATT resolved before initSdk's callback — start once init lands.
    _startPending = true
    if (__DEV__) console.log('[AppsFlyer] startAppsFlyer before init — deferred until init')
    return
  }
  try {
    appsFlyer.startSdk()
    _started = true
    if (__DEV__) console.log('[AppsFlyer] SDK started — transmission active')
  } catch (e) {
    console.warn('[AppsFlyer] startSdk failed:', e)
    return
  }
  // #4238 W6-1: replay, in order, events logged before transmission began.
  const queued = _eventQueue
  _eventQueue = []
  for (const event of queued) logAppsFlyerEvent(event.name, event.values)
}

// ─────────────────────────────────────────────────────────────────────────────
// User identity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the AppsFlyer customer user ID to the Supabase user UUID.
 * Call immediately after a successful Supabase sign-in.
 * This links attribution data to your internal user ID.
 */
export function setAppsFlyerUserId(userId: string): void {
  _signedInUserId = userId
  if (!_initialized) {
    // #4238 W6-1: applied once in initSdk's callback.
    _pendingUserId = userId
    return
  }
  try {
    appsFlyer.setCustomerUserId(userId, (result: unknown) => {
      if (__DEV__) console.log('[AppsFlyer] Customer user ID set:', result)
    })
  } catch (e) {
    console.warn('[AppsFlyer] setCustomerUserId failed:', e)
  }
  // #4238 W6-11: hashed email for advanced matching (skipped when opted out).
  void syncAppsFlyerUserEmail(userId)
}

/**
 * Clear the AppsFlyer customer user ID. Call on signOut so a subsequent
 * different sign-in on the same device does not inherit the prior user's
 * attribution identity.
 *
 * ORCH-1313 (§4.B) — Constitution #6: logout clears everything, including
 * third-party identity caches that survive Supabase signOut by default. Mirrors
 * the business service's clearAppsFlyerUserId.
 */
export function clearAppsFlyerUserId(): void {
  // #4238 W6-1: a held id and the queued events belong to the old session.
  _signedInUserId = null
  _pendingUserId = null
  _pendingDeviceUserId = null
  _eventQueue = []
  // #4238 W6-11: sign-out clears the email.
  clearAppsFlyerUserEmails()
  if (!_initialized) return
  try {
    appsFlyer.setCustomerUserId('', (result: unknown) => {
      if (__DEV__) console.log('[AppsFlyer] Customer user ID cleared:', result)
    })
  } catch (e) {
    console.warn('[AppsFlyer] clearCustomerUserId failed:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Device registration (S2S support)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieve the SDK-generated AppsFlyer UID and upsert it into
 * `appsflyer_devices` so edge functions can send S2S events
 * (e.g. referral_completed) without the device being online.
 *
 * Fire-and-forget — failures are logged but never block auth flow.
 */
export function registerAppsFlyerDevice(userId: string): void {
  if (!_initialized) {
    // #4238 W6-1: registered once init lands (same session only).
    _pendingDeviceUserId = userId
    return
  }
  try {
    appsFlyer.getAppsFlyerUID(async (err: any, uid: string) => {
      if (err || !uid) {
        console.warn('[AppsFlyer] getAppsFlyerUID failed:', err)
        return
      }

      let currentUserId: string | undefined
      try {
        const { data: { user } } = await supabase.auth.getUser()
        currentUserId = user?.id
      } catch {
        currentUserId = undefined
      }

      if (currentUserId !== userId) {
        if (__DEV__) console.log('[AppsFlyer] Device registration skipped - auth user changed')
        return
      }

      const platform = Platform.OS as 'ios' | 'android'
      const appId = platform === 'ios' ? AF_IOS_APP_ID : AF_ANDROID_APP_ID
      const deviceKey = `${userId}:${uid}`
      if (registeredDeviceKeys.has(deviceKey)) return

      supabase
        .from('appsflyer_devices')
        .upsert(
          {
            user_id: userId,
            appsflyer_uid: uid,
            platform,
            app_id: appId,
            app: 'consumer', // ORCH-0808 — discriminator added so business app rows for the same user don't collide.
            // #4238 P1-4: the server skips AppsFlyer posts for an opted-out install.
            tracking_opt_out: isAnalyticsOptedOut(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,app,appsflyer_uid' },
        )
        .then(({ error }) => {
          if (error) {
            console.warn('[AppsFlyer] Device registration failed:', error.message)
          } else {
            registeredDeviceKeys.add(deviceKey)
            if (__DEV__) console.log(`[AppsFlyer] Device registered: ${platform}/${uid}`)
          }
        })
    })
  } catch (e) {
    console.warn('[AppsFlyer] registerAppsFlyerDevice failed:', e)
  }
}

/**
 * Reset the in-memory device-dedup cache. Call on signOut (and account-switch)
 * so the next signed-in user is registered fresh rather than skipped as
 * "already registered."
 *
 * ORCH-1313 (§4.B) — mirrors the business service's resetAppsFlyerDeviceCache.
 */
export function resetAppsFlyerDeviceCache(): void {
  registeredDeviceKeys.clear()
  _pendingDeviceUserId = null
}

// ─────────────────────────────────────────────────────────────────────────────
// Event tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log a custom event to AppsFlyer.
 *
 * Usage:
 *   logAppsFlyerEvent('af_purchase', { af_revenue: 9.99, af_currency: 'USD' })
 *   logAppsFlyerEvent('complete_registration', { method: 'email' })
 */
export function logAppsFlyerEvent(
  eventName: string,
  eventValues: Record<string, string | number | boolean> = {},
): void {
  // #4238 W6-6 (I-4238-AF-RESPECTS-OPT-OUT): analytics off → nothing logged.
  if (isAnalyticsOptedOut()) return
  if (!_initialized || !_started) {
    // #4238 W6-1: held for the replay in startAppsFlyer (bounded, FIFO).
    if (hasAppsFlyerEnv) {
      _eventQueue.push({ name: eventName, values: eventValues })
      if (_eventQueue.length > PRE_START_EVENT_QUEUE_MAX) _eventQueue.shift()
    }
    return
  }
  try {
    appsFlyer.logEvent(
      eventName,
      eventValues,
      (result: unknown) => {
        if (__DEV__) console.log(`[AppsFlyer] Event logged (${eventName}):`, result)
      },
      (error: unknown) => {
        console.warn(`[AppsFlyer] Event logging failed (${eventName}):`, error)
      },
    )
  } catch (e) {
    console.warn('[AppsFlyer] logEvent failed:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// #4238 W6-7 — registration counts once; the sign-in method is right
// ─────────────────────────────────────────────────────────────────────────────

/** Supabase `app_metadata.provider` → the AppsFlyer method value. */
export function appsFlyerAuthMethod(provider: unknown): string {
  const p = typeof provider === 'string' ? provider.trim().toLowerCase() : ''
  if (p === 'apple' || p === 'google' || p === 'phone' || p === 'email') return p
  return p.length > 0 ? 'other' : 'email'
}

const REGISTRATION_SENT_KEY_PREFIX = '@mingla_af_registration_sent:'

/**
 * #4238 W6-7: af_login for a returning (onboarded) user; otherwise
 * af_complete_registration at most once per user on this device (persisted
 * flag keyed by user id), so a second app session before onboarding finishes
 * does not count the account twice. Never throws.
 */
export async function logAppsFlyerAuthOutcome(input: {
  userId: string
  provider: unknown
  completedOnboarding: boolean
  country?: string | null
}): Promise<'login' | 'registration' | 'already_registered'> {
  const method = appsFlyerAuthMethod(input.provider)
  if (input.completedOnboarding) {
    logAppsFlyerEvent('af_login', { af_login_method: method })
    return 'login'
  }
  const storage = asyncStorage()
  const key = `${REGISTRATION_SENT_KEY_PREFIX}${input.userId}`
  try {
    if (storage && (await storage.getItem(key)) !== null) return 'already_registered'
    await storage?.setItem(key, new Date().toISOString())
  } catch (e) {
    console.warn('[AppsFlyer] registration flag unavailable:', e)
  }
  logAppsFlyerEvent('af_complete_registration', {
    af_registration_method: method,
    country: input.country ?? '',
  })
  return 'registration'
}

/**
 * #4238 W6-3: the AppsFlyer id for RevenueCat (Purchases.setAppsflyerID).
 * Resolves null before init or when the SDK cannot give one.
 */
export function getAppsFlyerUid(): Promise<string | null> {
  if (!_initialized) return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      appsFlyer.getAppsFlyerUID((err: unknown, uid: string) => {
        resolve(!err && typeof uid === 'string' && uid.length > 0 ? uid : null)
      })
    } catch (e) {
      console.warn('[AppsFlyer] getAppsFlyerUID failed:', e)
      resolve(null)
    }
  })
}
