import appsFlyer from 'react-native-appsflyer'
import { Platform } from 'react-native'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const AF_DEV_KEY = 'W29Z6cqfWKvML3FdQAX27E'
const AF_IOS_APP_ID = '6760440898'

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
        timeToWaitForATTUserAuthorization: 10, // seconds to wait for iOS ATT prompt
      },
      (result) => {
        if (__DEV__) console.log('[AppsFlyer] SDK initialized:', result)
        _initialized = true
      },
      (error) => {
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
    appsFlyer.setCustomerUserId(userId, (result) => {
      if (__DEV__) console.log('[AppsFlyer] Customer user ID set:', result)
    })
  } catch (e) {
    console.warn('[AppsFlyer] setCustomerUserId failed:', e)
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
      (result) => {
        if (__DEV__) console.log(`[AppsFlyer] Event logged (${eventName}):`, result)
      },
      (error) => {
        console.warn(`[AppsFlyer] Event logging failed (${eventName}):`, error)
      },
    )
  } catch (e) {
    console.warn('[AppsFlyer] logEvent failed:', e)
  }
}
