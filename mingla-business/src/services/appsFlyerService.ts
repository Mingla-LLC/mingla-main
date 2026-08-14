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

import { Platform } from "react-native";
import { supabase } from "./supabase";
// #1050 — the branded OneLink host is imported from the storeLinks SSOT, never
// hardcoded here (the orch-1342 gate bans a bare `biz.usemingla.com` literal
// outside storeLinks.ts). Its value is `biz.usemingla.com` — the Business app's
// OWN vouching domain; `go.usemingla.com` is CONSUMER-only.
import { BUSINESS_ONELINK_BRANDED_DOMAIN } from "../constants/storeLinks";

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

// ORCH-1318 (§A.2) — the shape AppsFlyer hands the `onDeepLink` callback. Kept
// narrow + all-optional so a malformed native payload can never throw at the
// bridge boundary (see `handleOneLinkPayload`). Mirrors the installed
// `react-native-appsflyer` `UnifiedDeepLinkData` (`index.d.ts:58`) for the
// fields B1 reads; the SDK cast below asserts compatibility.
type OneLinkCallbackResult = {
  deepLinkStatus?: "FOUND" | "NOT_FOUND" | "ERROR" | string;
  isDeferred?: boolean;
  data?: Record<string, unknown>;
};

type AppsFlyerSdk = {
  initSdk: (
    config: unknown,
    ok: (r: unknown) => void,
    fail: (e: unknown) => void,
  ) => void;
  setCustomerUserId: (id: string, cb: (r: unknown) => void) => void;
  getAppsFlyerUID: (cb: (err: unknown, uid: string) => void) => void;
  logEvent: (
    name: string,
    values: Record<string, unknown>,
    ok: (r: unknown) => void,
    fail: (e: unknown) => void,
  ) => void;
  // ORCH-1318 (§A.2) — OneLink deferred deep-linking surface. The narrow type
  // omitted these, so the calls below would not typecheck without the extension.
  onDeepLink: (cb: (res: OneLinkCallbackResult) => void) => () => void;
  setOneLinkCustomDomains: (
    domains: string[],
    ok: (r: unknown) => void,
    fail: (e: unknown) => void,
  ) => void;
  performOnDeepLinking: () => void;
};

let appsFlyer: AppsFlyerSdk | null = null;
const AF_DEV_KEY = process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY;
const AF_IOS_APP_ID = process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID;
const AF_ANDROID_APP_ID = process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID;
const hasAppsFlyerEnv =
  Boolean(AF_DEV_KEY) && Boolean(AF_IOS_APP_ID) && Boolean(AF_ANDROID_APP_ID);
// ORCH-0839-A cleanup: also Platform.OS-guard for web. The existing
// try/catch handles native dev-client missing-module crashes, but
// `react-native-appsflyer` evaluates a native binding at import that
// `expo export -p web` can't tree-shake even inside try/catch. Explicit
// Platform guard short-circuits the require on web entirely. Env guard also
// keeps Android startup from loading optional native SDK code in dev clients
// where AppsFlyer is intentionally disabled.
if (Platform.OS !== "web" && hasAppsFlyerEnv) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-appsflyer") as
      | { default?: AppsFlyerSdk }
      | AppsFlyerSdk;
    appsFlyer =
      (mod as { default?: AppsFlyerSdk }).default ?? (mod as AppsFlyerSdk);
  } catch (err) {
    console.warn(
      "[AppsFlyer] Native module unavailable at import — running as no-op. " +
        "This is expected on Expo Go / dev-client builds without the native " +
        "side linked; real release builds load normally.",
      err,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants — env-driven (TRANSITIONAL until EAS Secrets are provisioned)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────────────────

let _initialized = false;
const registeredDeviceKeys = new Set<string>();
let _pendingAuthenticatedUserId: string | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// ORCH-1318 (§A.2/§B.3/§C.1) — OneLink deferred deep-linking (BUSINESS, B1)
//
// B1 business scope is deliberately minimal: enable the listeners, register
// `onDeepLink` before transmission starts, register the branded OneLink domain,
// and forward a resolved destination to a UI sink. The service NEVER navigates
// (it has no router) and NEVER transmits early — it only resolves the payload.
// Per-entity business content routing is B2 and OUT OF SCOPE here; B1 only
// handles universal-download (no-op landing) + referral (attribution-only).
// ─────────────────────────────────────────────────────────────────────────────

// §C.1 — the branded OneLink subdomain the SDK must treat as a OneLink host.
//
// #1050 — this is the SSOT import BUSINESS_ONELINK_BRANDED_DOMAIN (value
// `biz.usemingla.com`, the Business app's OWN vouching branded domain), used
// directly at the setOneLinkCustomDomains call below. It MUST swap in lockstep
// with app.json: if app.json declares `biz.` but the SDK registers `go.`, a
// verified `biz.usemingla.com/ZSCW` link opens the app and then DEAD-ENDS
// (deepLinkStatus: NOT_FOUND) — the referral/download sink never fires. `go.`
// is CONSUMER-only and must never be registered here.

// §B.1 payload contract (shared with consumer). B1 business only acts on the
// referral discriminator + a piggybacked `af_sub1`; everything else is a no-op
// landing (universal-download links, and content links whose per-entity routing
// is B2). `null` only for a genuinely empty/missing payload.
export type BusinessOneLinkDestination =
  | { kind: "referral"; referralCode: string }
  | { kind: "download" }
  | null;

/**
 * Pure — never throws, never navigates, never transmits. Maps a FOUND OneLink
 * payload (`res.data`, §B.1) to the minimal B1 business destination.
 *
 * - `deep_link_value === 'referral'` → referral (code = `deep_link_sub1`).
 * - ANY payload carrying `af_sub1` → referral (a content/entity link piggybacks
 *   the referral code; B1 persists it for attribution even though the entity
 *   itself is not routed until B2).
 * - anything else (universal-download, or B2 content links) → `download` (no-op).
 */
export function resolveBusinessOneLinkDestination(
  data: Record<string, unknown> | null | undefined,
): BusinessOneLinkDestination {
  if (!data || typeof data !== "object") return null;
  const rawType = data["deep_link_value"];
  const type =
    typeof rawType === "string" ? rawType.trim().toLowerCase() : "";
  const sub1 =
    typeof data["deep_link_sub1"] === "string"
      ? (data["deep_link_sub1"] as string).trim()
      : "";
  const afSub1 =
    typeof data["af_sub1"] === "string"
      ? (data["af_sub1"] as string).trim()
      : "";

  if (type === "referral" && sub1.length > 0) {
    return { kind: "referral", referralCode: sub1 };
  }
  if (afSub1.length > 0) {
    return { kind: "referral", referralCode: afSub1 };
  }
  return { kind: "download" };
}

// §A.4 — sink + buffer + dedup state.
let _deepLinkSubscribed = false;
let _deepLinkSink: ((dest: BusinessOneLinkDestination) => void) | null = null;
let _bufferedDestination: BusinessOneLinkDestination = null;
let _lastHandled: { link: string; at: number } | null = null;

function forwardOneLinkDestination(dest: BusinessOneLinkDestination): void {
  if (!dest) return;
  if (_deepLinkSink) {
    try {
      _deepLinkSink(dest);
    } catch (e) {
      console.warn("[AppsFlyer] OneLink sink threw:", e);
    }
    return;
  }
  // §A.4.3 — the deferred resolution can beat sink registration (resolves
  // faster than the UI mounts). Buffer the last FOUND destination; it flushes
  // once when `subscribeOneLinkDeepLink` runs.
  _bufferedDestination = dest;
}

function handleOneLinkPayload(res: OneLinkCallbackResult): void {
  try {
    if (!res || res.deepLinkStatus !== "FOUND") {
      // §A.4.2 — NOT_FOUND on a normal organic open is expected; log at info in
      // dev only, never a warning storm, never navigate.
      if (__DEV__ && res) {
        console.log(
          "[AppsFlyer] onDeepLink non-FOUND (ignored):",
          res.deepLinkStatus,
        );
      }
      return;
    }
    const data = res.data ?? {};
    // §A.4.1 — dedup a re-emitted identical link within a short window (resume
    // can re-fire). Second identical emission is a no-op.
    const link = typeof data.link === "string" ? (data.link as string) : "";
    const now = Date.now();
    if (
      link.length > 0 &&
      _lastHandled &&
      _lastHandled.link === link &&
      now - _lastHandled.at < 5000
    ) {
      return;
    }
    if (link.length > 0) _lastHandled = { link, at: now };

    const dest = resolveBusinessOneLinkDestination(data);
    forwardOneLinkDestination(dest);
  } catch (e) {
    console.warn("[AppsFlyer] onDeepLink handler failed:", e);
  }
}

// §A.2.3 — register `onDeepLink` BEFORE `initSdk` fires transmission (business
// has no `manualStart`, so init IS the start; a deferred link resolved during
// the first session is dropped if the listener is not registered first).
// Idempotent — a double-subscribe would double-navigate.
function registerOneLinkDeepLink(sdk: AppsFlyerSdk): void {
  if (_deepLinkSubscribed) return;
  try {
    sdk.onDeepLink((res) => handleOneLinkPayload(res));
    _deepLinkSubscribed = true;
  } catch (e) {
    console.warn("[AppsFlyer] onDeepLink registration failed:", e);
  }
}

/**
 * Register the UI-layer sink that receives resolved OneLink destinations.
 *
 * §A.4.3 buffered flush — if a deferred FOUND destination resolved before the
 * UI mounted (buffered above), deliver it exactly once here, then clear it.
 * The service forwards a destination; the caller decides what to do with it —
 * the service never navigates.
 */
export function subscribeOneLinkDeepLink(
  onDestination: (dest: BusinessOneLinkDestination) => void,
): void {
  _deepLinkSink = onDestination;
  if (_bufferedDestination) {
    const buffered = _bufferedDestination;
    _bufferedDestination = null;
    try {
      onDestination(buffered);
    } catch (e) {
      console.warn("[AppsFlyer] OneLink buffered flush threw:", e);
    }
  }
}

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
  if (!hasAppsFlyerEnv) {
    // Constitution #3 — log once with explicit reason; never silent.
    console.warn(
      "[AppsFlyer] env missing — init skipped. Set EXPO_PUBLIC_APPSFLYER_DEV_KEY + EXPO_PUBLIC_APPSFLYER_IOS_APP_ID + EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID.",
    );
    return;
  }
  if (!appsFlyer) return; // ORCH-0807 Rev 3 — native module unavailable; no-op.
  const sdk = appsFlyer;
  try {
    // ORCH-1318 (§A.2.3 / I-ONELINK-NO-TRANSMIT-BEFORE-ATT) — register the
    // OneLink listener BEFORE `initSdk` starts transmission. `initializeAppsFlyer`
    // itself is only called post-ATT (`_layout.tsx`), so this stays behind the
    // ATT gate; registering a listener transmits nothing.
    registerOneLinkDeepLink(sdk);

    // ORCH-1318 (§C.1) — treat the branded subdomain as a OneLink host so the
    // SDK resolves `biz.usemingla.com` links as OneLinks (#1050). Own try/catch
    // so a failure here never blocks `initSdk`.
    try {
      sdk.setOneLinkCustomDomains(
        [BUSINESS_ONELINK_BRANDED_DOMAIN],
        (result: unknown) => {
          if (__DEV__) {
            console.log(
              "[AppsFlyer] OneLink custom domain registered:",
              BUSINESS_ONELINK_BRANDED_DOMAIN,
              result,
            );
          }
        },
        (error: unknown) => {
          console.warn(
            "[AppsFlyer] setOneLinkCustomDomains failed:",
            error,
          );
        },
      );
    } catch (e) {
      console.warn("[AppsFlyer] setOneLinkCustomDomains threw:", e);
    }

    sdk.initSdk(
      {
        devKey: AF_DEV_KEY,
        isDebug: __DEV__,
        appId: Platform.OS === "ios" ? AF_IOS_APP_ID : undefined,
        // ORCH-1318 (§A.2.1) — enable the listeners. Listener-enable only:
        // transmission stays gated by the post-ATT init above.
        onInstallConversionDataListener: true,
        onDeepLinkListener: true,
        // ATT deferred — mirrors consumer ORCH-0349. We never prompt at cold start.
        timeToWaitForATTUserAuthorization: 0,
      },
      (result: unknown) => {
        if (__DEV__) console.log("[AppsFlyer] SDK initialized:", result);
        _initialized = true;
        const pendingUserId = _pendingAuthenticatedUserId;
        _pendingAuthenticatedUserId = null;
        if (pendingUserId) {
          setAppsFlyerUserId(pendingUserId);
          registerAppsFlyerDevice(pendingUserId);
        }
        // ORCH-1318 (§A.3) — Android cold-start: force a deferred `onDeepLink`
        // resolution pass now that transmission has begun. iOS resolves via the
        // AppDelegate hooks the Expo plugin injects — no equivalent call needed.
        if (Platform.OS === "android") {
          try {
            sdk.performOnDeepLinking();
          } catch (e) {
            console.warn("[AppsFlyer] performOnDeepLinking failed:", e);
          }
        }
      },
      (error: unknown) => {
        console.warn("[AppsFlyer] SDK initialization failed:", error);
      },
    );
  } catch (e) {
    console.warn("[AppsFlyer] Native module not available:", e);
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
  if (!_initialized || !appsFlyer) {
    _pendingAuthenticatedUserId = userId;
    return;
  }
  try {
    appsFlyer.setCustomerUserId(userId, (result: unknown) => {
      if (__DEV__) console.log("[AppsFlyer] Customer user ID set:", result);
    });
  } catch (e) {
    console.warn("[AppsFlyer] setCustomerUserId failed:", e);
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
  _pendingAuthenticatedUserId = null;
  if (!_initialized || !appsFlyer) return;
  try {
    appsFlyer.setCustomerUserId("", (result: unknown) => {
      if (__DEV__) console.log("[AppsFlyer] Customer user ID cleared:", result);
    });
  } catch (e) {
    console.warn("[AppsFlyer] clearCustomerUserId failed:", e);
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
  if (!_initialized || !appsFlyer) {
    _pendingAuthenticatedUserId = userId;
    return;
  }
  try {
    appsFlyer.getAppsFlyerUID(async (err: unknown, uid: string) => {
      if (err || !uid) {
        console.warn("[AppsFlyer] getAppsFlyerUID failed:", err);
        return;
      }

      let currentUserId: string | undefined;
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        currentUserId = user?.id;
      } catch {
        currentUserId = undefined;
      }

      if (currentUserId !== userId) {
        if (__DEV__) {
          console.log(
            "[AppsFlyer] Device registration skipped - auth user changed",
          );
        }
        return;
      }

      const platform = Platform.OS as "ios" | "android";
      const appId = platform === "ios" ? AF_IOS_APP_ID : AF_ANDROID_APP_ID;
      const deviceKey = `${userId}:${uid}`;
      if (registeredDeviceKeys.has(deviceKey)) return;

      supabase
        .from("appsflyer_devices")
        .upsert(
          {
            user_id: userId,
            appsflyer_uid: uid,
            platform,
            app_id: appId,
            app: "business",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,app,appsflyer_uid" },
        )
        .then(({ error }) => {
          if (error) {
            console.warn(
              "[AppsFlyer] Device registration failed:",
              error.message,
            );
          } else {
            registeredDeviceKeys.add(deviceKey);
            if (__DEV__) {
              console.log(`[AppsFlyer] Device registered: ${platform}/${uid}`);
            }
          }
        });
    });
  } catch (e) {
    console.warn("[AppsFlyer] registerAppsFlyerDevice failed:", e);
  }
}

/**
 * Reset the in-memory dedup cache. Call on signOut so the next signed-in user
 * is registered fresh rather than skipped as "already registered."
 */
export function resetAppsFlyerDeviceCache(): void {
  _pendingAuthenticatedUserId = null;
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
    console.warn("[AppsFlyer] logEvent failed:", e);
  }
}
