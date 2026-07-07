import appsFlyer from 'react-native-appsflyer'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { supabase } from './supabase'
import { resolveOneLinkDestination, OneLinkDestination } from './oneLinkResolver'

// ORCH-1318 — the branded OneLink subdomain the SDK must treat as a OneLink
// host at runtime (SPEC §C.1). EXACT constant, shared with oneLinkShare.ts.
const ONELINK_BRAND_DOMAIN = 'go.usemingla.com'

// ─────────────────────────────────────────────────────────────────────────────
// Constants — ORCH-1313 (§4.C) env-driven (single-source + fail-loud on release)
//
// Read from the app.config `extra` block FIRST, then process.env — mirroring
// supabase.ts. A DYNAMIC process.env read is NOT inlined by babel-preset-expo and
// is undefined in Hermes standalone/OTA builds (COMMS-0028), so `extra` is the
// build-safe path. The dev fallback lives in app.config.ts (release builds fail
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
    if (__DEV__) console.warn('[AppsFlyer] startAppsFlyer called before init — skipping')
    return
  }
  try {
    appsFlyer.startSdk()
    _started = true
    if (__DEV__) console.log('[AppsFlyer] SDK started — transmission active')
  } catch (e) {
    console.warn('[AppsFlyer] startSdk failed:', e)
  }
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
  if (!_initialized) return
  try {
    appsFlyer.setCustomerUserId(userId, (result: unknown) => {
      if (__DEV__) console.log('[AppsFlyer] Customer user ID set:', result)
    })
  } catch (e) {
    console.warn('[AppsFlyer] setCustomerUserId failed:', e)
  }
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
  if (!_initialized) return
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
  if (!_initialized) return
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
