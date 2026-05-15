/**
 * AppsFlyer integration for Mingla Business (ORCH-0808).
 *
 * Mirrors the consumer-side service at `app-mobile/src/services/appsFlyerService.ts`
 * with two adjustments:
 *   - constants are env-driven (TRANSITIONAL no-op guard when any env is missing)
 *   - appsflyer_devices upsert writes `app: 'business'` so consumer + business
 *     installs for the same Supabase user coexist
 *
 * Public surface — identical to consumer:
 *   - initializeAppsFlyer()        : void — call once at root mount
 *   - setAppsFlyerUserId(userId)   : void — call after SIGNED_IN
 *   - clearAppsFlyerUserId()       : void — call on signOut (Constitution #6)
 *   - registerAppsFlyerDevice(id)  : void — fire-and-forget device row upsert
 *   - logAppsFlyerEvent(name,vals) : void — fire a custom event
 *
 * See: Mingla_Artifacts/specs/SPEC_ORCH-0808_APPSFLYER_MINGLA_BUSINESS.md §3.3
 */

import { Platform } from 'react-native';
import { supabase } from './supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Native-module lazy load (ORCH-0807 Rev 3 emergency unblock 2026-05-12)
//
// `import appsFlyer from 'react-native-appsflyer'` evaluates the native module
// at module-import time. On dev-client / Expo Go builds that don't include
// the AppsFlyer native side, `new NativeEventEmitter()` throws synchronously
// at import (Invariant Violation: "requires a non-null argument") and that
// propagates up through every consumer chain — account.tsx →
// BrandDeleteSheet → useBrands → brandsService → here — crashing the app on
// startup.
//
// The runtime-call paths in this file already guard with `_initialized` +
// per-function try/catch. So the only place we need a safety net is the
// import. Lazy require lets the module load fail gracefully — `appsFlyer`
// stays null, every function early-returns, AppsFlyer becomes a no-op for
// this session. Real release builds with the native module linked are
// unaffected because `require` succeeds there.
// ─────────────────────────────────────────────────────────────────────────────

type AppsFlyerSdk = {
  initSdk: (config: unknown, ok: (r: unknown) => void, fail: (e: unknown) => void) => void;
  setCustomerUserId: (id: string, cb: (r: unknown) => void) => void;
  getAppsFlyerUID: (cb: (err: unknown, uid: string) => void) => void;
  logEvent: (name: string, values: Record<string, unknown>, ok: (r: unknown) => void, fail: (e: unknown) => void) => void;
};

let appsFlyer: AppsFlyerSdk | null = null;
// ORCH-0839-A cleanup: also Platform.OS-guard for web. The existing
// try/catch handles native dev-client missing-module crashes, but
// `react-native-appsflyer` evaluates a native binding at import that
// `expo export -p web` can't tree-shake even inside try/catch. Explicit
// Platform guard short-circuits the require on web entirely.
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-appsflyer') as { default?: AppsFlyerSdk } | AppsFlyerSdk;
    appsFlyer = (mod as { default?: AppsFlyerSdk }).default ?? (mod as AppsFlyerSdk);
  } catch (err) {
    console.warn(
      '[AppsFlyer] Native module unavailable at import — running as no-op. ' +
        'This is expected on Expo Go / dev-client builds without the native ' +
        'side linked; real release builds load normally.',
      err,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants — env-driven (TRANSITIONAL until EAS Secrets are provisioned)
// ─────────────────────────────────────────────────────────────────────────────

const AF_DEV_KEY = process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY;
const AF_IOS_APP_ID = process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID;
const AF_ANDROID_APP_ID = process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID;

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

let _initialized = false;
const registeredDeviceKeys = new Set<string>();

/**
 * Initialize the AppsFlyer SDK. Call once at app startup.
 * Tracks installs, sessions, and attribution automatically after init.
 *
 * No-op if env is missing — TRANSITIONAL guard, exit condition: operator sets
 * EXPO_PUBLIC_APPSFLYER_DEV_KEY + EXPO_PUBLIC_APPSFLYER_IOS_APP_ID +
 * EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID via EAS Secrets.
 */
export function initializeAppsFlyer(): void {
  if (_initialized) return;
  if (!appsFlyer) return; // ORCH-0807 Rev 3 — native module unavailable; no-op.
  if (!AF_DEV_KEY || !AF_IOS_APP_ID || !AF_ANDROID_APP_ID) {
    // Constitution #3 — log once with explicit reason; never silent.
    console.warn(
      '[AppsFlyer] env missing — init skipped. Set EXPO_PUBLIC_APPSFLYER_DEV_KEY + EXPO_PUBLIC_APPSFLYER_IOS_APP_ID + EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID.',
    );
    return;
  }
  try {
    appsFlyer.initSdk(
      {
        devKey: AF_DEV_KEY,
        isDebug: __DEV__,
        appId: Platform.OS === 'ios' ? AF_IOS_APP_ID : undefined,
        onInstallConversionDataListener: false,
        onDeepLinkListener: false,
        // ATT deferred — mirrors consumer ORCH-0349. We never prompt at cold start.
        timeToWaitForATTUserAuthorization: 0,
      },
      (result: unknown) => {
        if (__DEV__) console.log('[AppsFlyer] SDK initialized:', result);
        _initialized = true;
      },
      (error: unknown) => {
        console.warn('[AppsFlyer] SDK initialization failed:', error);
      },
    );
  } catch (e) {
    console.warn('[AppsFlyer] Native module not available:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// User identity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the AppsFlyer customer user ID to the Supabase user UUID.
 * Call immediately after a successful Supabase sign-in.
 */
export function setAppsFlyerUserId(userId: string): void {
  if (!_initialized || !appsFlyer) return;
  try {
    appsFlyer.setCustomerUserId(userId, (result: unknown) => {
      if (__DEV__) console.log('[AppsFlyer] Customer user ID set:', result);
    });
  } catch (e) {
    console.warn('[AppsFlyer] setCustomerUserId failed:', e);
  }
}

/**
 * Clear the AppsFlyer customer user ID. Call on signOut so that subsequent
 * installs / re-signs do not inherit the prior user's attribution context.
 *
 * Constitution #6 — logout clears everything, including third-party identity
 * caches that survive Supabase signOut by default.
 */
export function clearAppsFlyerUserId(): void {
  if (!_initialized || !appsFlyer) return;
  try {
    appsFlyer.setCustomerUserId('', (result: unknown) => {
      if (__DEV__) console.log('[AppsFlyer] Customer user ID cleared:', result);
    });
  } catch (e) {
    console.warn('[AppsFlyer] clearCustomerUserId failed:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Device registration (S2S support)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieve the SDK-generated AppsFlyer UID and upsert it into
 * `appsflyer_devices` (with `app: 'business'`) so edge functions can send S2S
 * events (e.g. first_ticket_sold, first_payout) without the device being online.
 *
 * Fire-and-forget — failures are logged but never block auth flow.
 */
export function registerAppsFlyerDevice(userId: string): void {
  if (!_initialized || !appsFlyer) return;
  try {
    appsFlyer.getAppsFlyerUID(async (err: unknown, uid: string) => {
      if (err || !uid) {
        console.warn('[AppsFlyer] getAppsFlyerUID failed:', err);
        return;
      }

      let currentUserId: string | undefined;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        currentUserId = user?.id;
      } catch {
        currentUserId = undefined;
      }

      if (currentUserId !== userId) {
        if (__DEV__) {
          console.log('[AppsFlyer] Device registration skipped - auth user changed');
        }
        return;
      }

      const platform = Platform.OS as 'ios' | 'android';
      const appId = platform === 'ios' ? AF_IOS_APP_ID : AF_ANDROID_APP_ID;
      const deviceKey = `${userId}:${uid}`;
      if (registeredDeviceKeys.has(deviceKey)) return;

      supabase
        .from('appsflyer_devices')
        .upsert(
          {
            user_id: userId,
            appsflyer_uid: uid,
            platform,
            app_id: appId,
            app: 'business',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,app,appsflyer_uid' },
        )
        .then(({ error }) => {
          if (error) {
            console.warn('[AppsFlyer] Device registration failed:', error.message);
          } else {
            registeredDeviceKeys.add(deviceKey);
            if (__DEV__) {
              console.log(`[AppsFlyer] Device registered: ${platform}/${uid}`);
            }
          }
        });
    });
  } catch (e) {
    console.warn('[AppsFlyer] registerAppsFlyerDevice failed:', e);
  }
}

/**
 * Reset the in-memory dedup cache. Call on signOut so the next signed-in user
 * is registered fresh rather than skipped as "already registered."
 */
export function resetAppsFlyerDeviceCache(): void {
  registeredDeviceKeys.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Event tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log a custom event to AppsFlyer.
 *
 * Usage:
 *   logAppsFlyerEvent('af_complete_registration', { af_registration_method: 'email' })
 *   logAppsFlyerEvent('mingla_brand_created', { brand_id: '<uuid>' })
 *
 * eventValues MUST contain IDs only — no PII (no emails, names, phone, exact
 * prices). Revenue is reported server-side from the Stripe webhook.
 */
export function logAppsFlyerEvent(
  eventName: string,
  eventValues: Record<string, string | number | boolean> = {},
): void {
  if (!_initialized || !appsFlyer) return;
  try {
    appsFlyer.logEvent(
      eventName,
      eventValues,
      (result: unknown) => {
        if (__DEV__) {
          console.log(`[AppsFlyer] Event logged (${eventName}):`, result);
        }
      },
      (error: unknown) => {
        console.warn(`[AppsFlyer] Event logging failed (${eventName}):`, error);
      },
    );
  } catch (e) {
    console.warn('[AppsFlyer] logEvent failed:', e);
  }
}
