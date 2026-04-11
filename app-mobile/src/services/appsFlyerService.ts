import appsFlyer from 'react-native-appsflyer'
import { Platform } from 'react-native'
import { supabase } from './supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const AF_DEV_KEY = 'W29Z6cqfWKvML3FdQAX27E'
const AF_IOS_APP_ID = '6760440898'
const AF_ANDROID_APP_ID = 'com.mingla.app.v2'

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

let _initialized = false

/**
 * Initialize the AppsFlyer SDK. Call once at app startup.
 * Tracks installs, sessions, and attribution automatically after init.
 */
export function initializeAppsFlyer(): void {
  if (_initialized) return
  try {
    appsFlyer.initSdk(
      {
        devKey: AF_DEV_KEY,
        isDebug: __DEV__,
        appId: Platform.OS === 'ios' ? AF_IOS_APP_ID : undefined,
        onInstallConversionDataListener: true,
        onDeepLinkListener: true,
        timeToWaitForATTUserAuthorization: 0, // deferred — ATT requested after coach mark tour (ORCH-0349)
      },
      (result: unknown) => {
        if (__DEV__) console.log('[AppsFlyer] SDK initialized:', result)
        _initialized = true
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
    appsFlyer.getAppsFlyerUID((err: any, uid: string) => {
      if (err || !uid) {
        console.warn('[AppsFlyer] getAppsFlyerUID failed:', err)
        return
      }

      const platform = Platform.OS as 'ios' | 'android'
      const appId = platform === 'ios' ? AF_IOS_APP_ID : AF_ANDROID_APP_ID

      supabase
        .from('appsflyer_devices')
        .upsert(
          {
            user_id: userId,
            appsflyer_uid: uid,
            platform,
            app_id: appId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,appsflyer_uid' },
        )
        .then(({ error }) => {
          if (error) {
            console.warn('[AppsFlyer] Device registration failed:', error.message)
          } else if (__DEV__) {
            console.log(`[AppsFlyer] Device registered: ${platform}/${uid}`)
          }
        })
    })
  } catch (e) {
    console.warn('[AppsFlyer] registerAppsFlyerDevice failed:', e)
  }
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
