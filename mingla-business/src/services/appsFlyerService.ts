/**
 * AppsFlyer integration for Mingla Host (ORCH-0808).
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
import { parseHostAttachResponse, type HostAttachResult } from "./hostAttachResponse";
import { supabase } from "./supabase";
import type { AppsFlyerConsentData } from "./appsFlyerConsent";
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
  // #4238 — optional so a partial native module (or a partial test mock) never
  // throws: every call site checks `typeof … === "function"` first.
  onInstallConversionData?: (
    cb: (res: { status?: string; type?: string; data?: Record<string, unknown> }) => void,
  ) => () => void;
  anonymizeUser?: (shouldAnonymize: boolean, ok?: (r: unknown) => void) => void;
  updateServerUninstallToken?: (token: string, ok?: (r: unknown) => void) => void;
  setUserEmails?: (
    options: { emails: string[]; emailsCryptType: number },
    ok: (r: unknown) => void,
    fail: (e: unknown) => void,
  ) => void;
  // #4238 P2-2 — DMA consent (react-native-appsflyer 6.16.2+).
  setConsentData?: (consent: AppsFlyerConsentData) => void;
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
// #4238 W6-1 / W6-6 / W6-5 / W6-11 — events before init, the privacy choice,
// the uninstall token and hashed email
// ─────────────────────────────────────────────────────────────────────────────

/** Events logged before init are kept (oldest dropped past this) and replayed. */
export const PRE_INIT_EVENT_QUEUE_MAX = 50;
let _preInitEvents: Array<{
  name: string;
  values: Record<string, string | number | boolean>;
}> = [];
let _anonymized: boolean | null = null;
let _privacySubscribed = false;
let _pushTokenWatched = false;
/**
 * W6-5 / #4238 sim rework F3: the latest valid push token (held until init,
 * which in this app is after the ATT answer and starts the SDK) and the token
 * last handed to AppsFlyer, persisted so a cold launch does not re-apply the
 * same token. `undefined` means "not read from storage yet". Opting out forgets
 * it, so opting back in re-applies.
 */
let _heldUninstallToken: string | null = null;
let _lastUninstallToken: string | null | undefined = undefined;
let _uninstallChain: Promise<void> = Promise.resolve();
export const UNINSTALL_TOKEN_SENT_KEY = "@mingla_business_af_uninstall_token_sent";
let _emailSetForUserId: string | null = null;
let _signedInUserId: string | null = null;
/** #4238 P3-R2: this install's AppsFlyer id, once the SDK has returned it. */
let _installUid: string | null = null;

/**
 * AppsFlyer `emailsCryptType` 3 is SHA-256 (the SDK hashes the plain email).
 * Never 2: the 6.x iOS bridge maps every value except 3 to "none" and would
 * send the email in plain text (#4238 Step 0 Z22). setUserEmails is the 6.x
 * plugin API; plugin 7.x replaces it with setUserEmail.
 */
export const APPSFLYER_EMAIL_CRYPT_SHA256 = 3;

/**
 * W6-6 (I-4238-AF-RESPECTS-OPT-OUT-HOST): the in-app Analytics opt-out
 * (analyticsPrefsStore). Lazy so a node test or a store that cannot load reads
 * "not opted out", never throws.
 */
function isAnalyticsOptedOut(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAnalyticsPrefsStore } = require("../store/analyticsPrefsStore") as
      typeof import("../store/analyticsPrefsStore");
    return useAnalyticsPrefsStore.getState().analyticsOptOut === true;
  } catch {
    return false;
  }
}

/**
 * #4238 P2-2 (W6-6, I-4238-AF-DMA-CONSENT-HOST): DMA consent for EU / EEA / UK
 * devices from the same Analytics switch. Called before initSdk (this app
 * starts transmitting at init) and on every change. Never throws.
 */
function applyConsentData(sdk: AppsFlyerSdk | null = appsFlyer): void {
  if (!sdk || typeof sdk.setConsentData !== "function") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const consent = require("./appsFlyerConsent") as typeof import("./appsFlyerConsent");
    sdk.setConsentData(
      consent.appsFlyerConsentFor(isAnalyticsOptedOut(), consent.intlDeviceRegion()),
    );
  } catch (e) {
    console.warn("[AppsFlyer] setConsentData failed:", e);
  }
}

/** Apply the current privacy choice to the SDK: anonymize when opted out. */
function applyPrivacyChoice(): void {
  if (!_initialized || !appsFlyer) return;
  const optedOut = isAnalyticsOptedOut();
  if (_anonymized === optedOut) return;
  const wasOptedOut = _anonymized === true;
  if (typeof appsFlyer.anonymizeUser === "function") {
    try {
      appsFlyer.anonymizeUser(optedOut, () => {
        if (__DEV__) console.log("[AppsFlyer] anonymizeUser:", optedOut);
      });
    } catch (e) {
      console.warn("[AppsFlyer] anonymizeUser failed:", e);
    }
  }
  _anonymized = optedOut;
  if (optedOut) {
    _preInitEvents = [];
    clearAppsFlyerUserEmails();
    forgetSentUninstallToken();
  } else {
    // Re-enabled: the hashed email and the uninstall token go back.
    if (wasOptedOut && _signedInUserId) void syncAppsFlyerUserEmail(_signedInUserId);
    flushUninstallToken();
  }
}

/**
 * #4238 P2-R1: until M-2 adds `appsflyer_devices.tracking_opt_out`, PostgREST
 * rejects a write that names it (PGRST204 on insert/update, 42703 on select).
 */
function isMissingOptOutColumn(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") return true;
  return /tracking_opt_out/.test(error.message ?? "");
}

/** #4238 P3-R2: this install's AppsFlyer id (cached after the first read). */
function withInstallUid(withUid: (uid: string) => void): void {
  if (_installUid) {
    withUid(_installUid);
    return;
  }
  if (!_initialized || !appsFlyer) return;
  try {
    appsFlyer.getAppsFlyerUID((err: unknown, uid: string) => {
      if (err || !uid) return;
      _installUid = uid;
      withUid(uid);
    });
  } catch (e) {
    console.warn("[AppsFlyer] getAppsFlyerUID failed:", e);
  }
}

/**
 * #4238 P2-4 (I-4238-AF-SERVER-RESPECTS-OPT-OUT): tell the server this Host
 * app install changed its Analytics choice, so the first-sale, payout and
 * dispute AppsFlyer posts skip it. Only this install's row (#4238 P3-R2: the
 * host's other devices keep their own choice). Logged, never thrown.
 */
function syncDeviceOptOut(): void {
  const userId = _signedInUserId;
  if (!userId) return;
  withInstallUid((uid) => updateDeviceOptOut(userId, uid));
}

function updateDeviceOptOut(userId: string, uid: string): void {
  try {
    void Promise.resolve(
      supabase
        .from("appsflyer_devices")
        // I-MUTATION-ROWCOUNT-WAIVER: #4238 zero rows is valid (no install registered yet; registration carries the value)
        .update({ app: "business", tracking_opt_out: isAnalyticsOptedOut() })
        .eq("user_id", userId)
        .eq("app", "business")
        .eq("appsflyer_uid", uid),
    ).then(
      (res: { error?: { message?: string } | null } | undefined) => {
        if (res?.error) {
          console.warn("[AppsFlyer] device opt-out sync failed:", res.error.message);
        }
      },
      (e: unknown) => console.warn("[AppsFlyer] device opt-out sync failed:", e),
    );
  } catch (e) {
    console.warn("[AppsFlyer] device opt-out sync unavailable:", e);
  }
}

function subscribePrivacyChoice(): void {
  if (_privacySubscribed) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAnalyticsPrefsStore } = require("../store/analyticsPrefsStore") as
      typeof import("../store/analyticsPrefsStore");
    useAnalyticsPrefsStore.subscribe((state, prev) => {
      if (state.analyticsOptOut !== prev.analyticsOptOut) {
        applyPrivacyChoice();
        applyConsentData();
        syncDeviceOptOut();
      }
    });
    _privacySubscribed = true;
  } catch (e) {
    console.warn("[AppsFlyer] privacy subscription unavailable:", e);
  }
}

/**
 * W6-11: after sign-in, hand AppsFlyer the account email for advanced
 * matching, SHA-256 hashed by the SDK (crypt type 3). Skipped when opted out.
 */
async function syncAppsFlyerUserEmail(userId: string): Promise<void> {
  if (!_initialized || !appsFlyer) return;
  if (typeof appsFlyer.setUserEmails !== "function") return;
  if (isAnalyticsOptedOut()) return;
  if (_emailSetForUserId === userId) return;
  let email: string | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id !== userId) return;
    email = typeof user.email === "string" ? user.email.trim().toLowerCase() : null;
  } catch (e) {
    console.warn("[AppsFlyer] email lookup failed:", e);
    return;
  }
  if (!email || _signedInUserId !== userId) return;
  try {
    appsFlyer.setUserEmails(
      { emails: [email], emailsCryptType: APPSFLYER_EMAIL_CRYPT_SHA256 },
      () => {
        if (__DEV__) console.log("[AppsFlyer] setUserEmails (SHA-256) ok");
      },
      (err: unknown) => {
        console.warn("[AppsFlyer] setUserEmails failed:", err);
      },
    );
    _emailSetForUserId = userId;
  } catch (e) {
    console.warn("[AppsFlyer] setUserEmails threw:", e);
  }
}

/**
 * #4238 sim rework F2: react-native-appsflyer 6.18 rejects an empty list on iOS
 * (RNAppsFlyer.m "ENO ARGUMENTS FOUND OR LIST IS CORRUPTED") and on Android
 * (RNAppsFlyerModule.setUserEmails), so `[]` never cleared anything. A single
 * empty entry is accepted by both and replaces the previous user's hash. Only
 * sent when this run set an email, so a signed-out launch makes no call.
 */
export const APPSFLYER_CLEARED_EMAILS: string[] = [""];

function clearAppsFlyerUserEmails(): void {
  const hadEmail = _emailSetForUserId !== null;
  _emailSetForUserId = null;
  if (!hadEmail || !_initialized || !appsFlyer) return;
  if (typeof appsFlyer.setUserEmails !== "function") return;
  try {
    appsFlyer.setUserEmails(
      { emails: APPSFLYER_CLEARED_EMAILS, emailsCryptType: APPSFLYER_EMAIL_CRYPT_SHA256 },
      () => {},
      (err: unknown) => console.warn("[AppsFlyer] clear emails failed:", err),
    );
  } catch (e) {
    console.warn("[AppsFlyer] clear emails threw:", e);
  }
}

export type UninstallTokenVerdict =
  | { ok: true; token: string }
  | { ok: false; reason: "empty" | "not_apns_hex" | "android_fid" | "not_fcm" };

/**
 * W6-5 (#4238 Step 0 Z14): iOS takes the APNs token as hex (OneSignal v5
 * returns lower-case hex); Android takes the FCM registration token. OneSignal
 * can return a Firebase Installation ID on Android (22 url-safe chars), which
 * cannot measure uninstalls: refused loudly, never sent.
 */
export function classifyUninstallToken(
  token: string | null | undefined,
  platform: string,
): UninstallTokenVerdict {
  const raw = typeof token === "string" ? token.trim() : "";
  if (raw.length === 0) return { ok: false, reason: "empty" };
  if (platform === "ios") {
    const hex = raw.replace(/[<>\s]/g, "").toLowerCase();
    return /^[0-9a-f]{64,}$/.test(hex)
      ? { ok: true, token: hex }
      : { ok: false, reason: "not_apns_hex" };
  }
  if (/^[A-Za-z0-9_-]{1,32}$/.test(raw)) return { ok: false, reason: "android_fid" };
  return raw.length >= 100 ? { ok: true, token: raw } : { ok: false, reason: "not_fcm" };
}

/**
 * W6-5: pass the device push token to AppsFlyer for uninstall measurement,
 * once per token change (across launches). Before init the latest token is held
 * and sent at init (post-ATT; initSdk starts this app's SDK).
 */
export function updateAppsFlyerUninstallToken(token: string | null | undefined): void {
  const verdict = classifyUninstallToken(token, Platform.OS);
  if (!verdict.ok) {
    if (verdict.reason === "android_fid") {
      console.error(
        "[AppsFlyer] uninstall token skipped: OneSignal returned a Firebase Installation ID, not an FCM token. Uninstall measurement is OFF on this device (#4238 W6-5).",
      );
    } else if (verdict.reason !== "empty") {
      console.warn(`[AppsFlyer] uninstall token skipped (${verdict.reason}).`);
    }
    return;
  }
  _heldUninstallToken = verdict.token;
  flushUninstallToken();
}

type UninstallTokenStorage = {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
};
function uninstallTokenStorage(): UninstallTokenStorage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("@react-native-async-storage/async-storage") as {
      default: UninstallTokenStorage;
    }).default;
  } catch {
    return null;
  }
}

/** Serialised so a storage read never lets two sends of one token race. */
function flushUninstallToken(): void {
  _uninstallChain = _uninstallChain.then(sendHeldUninstallToken, sendHeldUninstallToken);
}

async function sendHeldUninstallToken(): Promise<void> {
  const token = _heldUninstallToken;
  const sdk = appsFlyer;
  if (!token || !_initialized || !sdk || isAnalyticsOptedOut()) return;
  if (typeof sdk.updateServerUninstallToken !== "function") return;
  const storage = uninstallTokenStorage();
  if (_lastUninstallToken === undefined) {
    try {
      _lastUninstallToken = (await storage?.getItem(UNINSTALL_TOKEN_SENT_KEY)) ?? null;
    } catch (e) {
      console.warn("[AppsFlyer] uninstall token memory unavailable:", e);
      _lastUninstallToken = null;
    }
  }
  if (token !== _heldUninstallToken || isAnalyticsOptedOut()) return;
  if (token === _lastUninstallToken) return;
  try {
    sdk.updateServerUninstallToken(token, () => {
      if (__DEV__) console.log("[AppsFlyer] updateServerUninstallToken ok");
    });
    _lastUninstallToken = token;
  } catch (e) {
    console.warn("[AppsFlyer] updateServerUninstallToken failed:", e);
    return;
  }
  try {
    await storage?.setItem(UNINSTALL_TOKEN_SENT_KEY, token);
  } catch (e) {
    console.warn("[AppsFlyer] uninstall token memory not saved:", e);
  }
}

/** Opt-out: forget the sent token so opting back in re-applies it. */
function forgetSentUninstallToken(): void {
  _uninstallChain = _uninstallChain.then(async () => {
    _lastUninstallToken = null;
    try {
      await uninstallTokenStorage()?.setItem(UNINSTALL_TOKEN_SENT_KEY, "");
    } catch (e) {
      console.warn("[AppsFlyer] uninstall token memory not cleared:", e);
    }
  });
}

/** W6-5: follow the OneSignal push token (initial value and every change). */
function watchPushTokenForUninstall(): void {
  if (_pushTokenWatched) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { onPushSubscriptionToken } = require("./oneSignalService") as
      typeof import("./oneSignalService");
    if (typeof onPushSubscriptionToken !== "function") return;
    onPushSubscriptionToken(updateAppsFlyerUninstallToken);
    _pushTokenWatched = true;
  } catch (e) {
    console.warn("[AppsFlyer] push token watch unavailable:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// #4238 W4-3 — install attribution is saved
// ─────────────────────────────────────────────────────────────────────────────

/** AsyncStorage key holding the first non-organic install's attribution. */
export const HOST_INSTALL_ATTRIBUTION_KEY = "@mingla_host_install_attribution";

export interface HostInstallAttribution {
  media_source: string | null;
  campaign: string | null;
  af_sub1: string | null;
  af_sub2: string | null;
  af_sub3: string | null;
  surface: "ios" | "android";
  captured_at: string;
}

/**
 * Pure: the fields saved from AppsFlyer install conversion data. Only a first
 * launch with a non-organic install yields a row; organic installs and later
 * launches yield null.
 */
export function installAttributionFromConversionData(
  data: Record<string, unknown> | null | undefined,
  platform: string,
  nowIso: string,
): HostInstallAttribution | null {
  if (!data || typeof data !== "object") return null;
  const first = data["is_first_launch"];
  if (first !== true && first !== "true") return null;
  const status = typeof data["af_status"] === "string" ? (data["af_status"] as string) : "";
  if (status.toLowerCase() !== "non-organic") return null;
  const field = (key: string): string | null => {
    const v = data[key];
    return typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, 200) : null;
  };
  return {
    media_source: field("media_source"),
    campaign: field("campaign"),
    af_sub1: field("af_sub1"),
    af_sub2: field("af_sub2"),
    af_sub3: field("af_sub3"),
    surface: platform === "android" ? "android" : "ios",
    captured_at: nowIso,
  };
}

function saveInstallAttribution(attribution: HostInstallAttribution): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = (require("@react-native-async-storage/async-storage") as {
      default: { getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<void> };
    }).default;
    void AsyncStorage.getItem(HOST_INSTALL_ATTRIBUTION_KEY)
      .then((existing) =>
        existing === null
          ? AsyncStorage.setItem(HOST_INSTALL_ATTRIBUTION_KEY, JSON.stringify(attribution))
          : undefined,
      )
      .catch((e: unknown) => console.warn("[AppsFlyer] install attribution save failed:", e));
  } catch (e) {
    console.warn("[AppsFlyer] install attribution save unavailable:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// #4238 W3-3 + W4-3 — the saved install attribution reaches the server, and
// the server answers whether this is the host's first sign-in
// ─────────────────────────────────────────────────────────────────────────────

// The answer's shape and parser have one owner (hostAttachResponse.ts).
export { parseHostAttachResponse } from "./hostAttachResponse";
export type { HostAttachResult } from "./hostAttachResponse";

async function readSavedInstallAttribution(): Promise<Record<string, string> | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = (require("@react-native-async-storage/async-storage") as {
      default: { getItem: (k: string) => Promise<string | null> };
    }).default;
    const raw = await AsyncStorage.getItem(HOST_INSTALL_ATTRIBUTION_KEY);
    if (raw === null) return null;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const key of ["media_source", "campaign", "af_sub1", "af_sub2", "af_sub3"]) {
      const value = saved[key];
      if (typeof value === "string" && value.length > 0) out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Called once per sign-in (AuthContext). Sends the Host app's saved install
 * attribution (never when the host turned analytics off) to
 * host-attribution-attach, which stores it on the host's match context and
 * answers new_host from the server's own sign-up record. Null on any failure
 * (logged): the caller keeps its fallback. Never throws.
 */
export async function attachHostAttribution(): Promise<HostAttachResult | null> {
  try {
    const optedOut = isAnalyticsOptedOut();
    const installAttribution = optedOut ? null : await readSavedInstallAttribution();
    const { data, error } = await supabase.functions.invoke("host-attribution-attach", {
      body: {
        surface: Platform.OS === "android" ? "android" : "ios",
        tracking_opt_out: optedOut,
        ...(installAttribution ? { install_attribution: installAttribution } : {}),
      },
    });
    if (error) {
      console.warn("[AppsFlyer] host-attribution-attach failed:", error.message ?? error);
      return null;
    }
    return parseHostAttachResponse(data);
  } catch (e) {
    console.warn("[AppsFlyer] host-attribution-attach unavailable:", e);
    return null;
  }
}

function registerInstallConversionData(sdk: AppsFlyerSdk): void {
  if (typeof sdk.onInstallConversionData !== "function") return;
  try {
    sdk.onInstallConversionData((res) => {
      try {
        const row = installAttributionFromConversionData(
          res?.data ?? null,
          Platform.OS,
          new Date().toISOString(),
        );
        if (row) saveInstallAttribution(row);
      } catch (e) {
        console.warn("[AppsFlyer] install conversion handler failed:", e);
      }
    });
  } catch (e) {
    console.warn("[AppsFlyer] onInstallConversionData registration failed:", e);
  }
}

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

// §B.1 payload contract (shared with consumer).
//
// #4238 W4-3 (I-4238-AF-SUB1-NOT-REFERRAL): `af_sub1` carries CAMPAIGN tags on
// paid links, so it is a referral code ONLY when it starts with `ref:` (the
// code is what follows). #4238 W6-8: content links open their screen
// (`content`), carrying a `ref:` referral alongside when present. Unknown
// non-empty `deep_link_value`s land on Home; a link with no value stays the
// universal-download no-op. `null` only for a genuinely empty/missing payload.
export type BusinessOneLinkDestination =
  | { kind: "referral"; referralCode: string }
  | { kind: "content"; target: string; referralCode: string | null }
  | { kind: "download" }
  | null;

/** W4-3: the prefix that marks an `af_sub1` value as a referral code. */
export const AF_SUB1_REFERRAL_PREFIX = "ref:";

const HOME_TARGET = "/(tabs)/home";
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** W4-3: a referral code from `af_sub1`, or null when it is a campaign tag. */
export function referralCodeFromAfSub1(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw.toLowerCase().startsWith(AF_SUB1_REFERRAL_PREFIX)) return null;
  const code = raw.slice(AF_SUB1_REFERRAL_PREFIX.length).trim();
  return code.length > 0 ? code : null;
}

/** W6-8: the Host screen a content OneLink opens (Home when unroutable). */
function contentTargetFor(type: string, sub1: string): string {
  const id = UUID_SHAPE.test(sub1) ? sub1 : null;
  switch (type) {
    case "event":
      return id ? `/event/${id}` : HOME_TARGET;
    case "brand":
      return id ? `/brand/${id}` : HOME_TARGET;
    case "payouts":
      return id ? `/brand/${id}/payments` : HOME_TARGET;
    case "create_event":
      return "/event/create";
    default:
      return HOME_TARGET;
  }
}

/**
 * Pure — never throws, never navigates, never transmits. Maps a FOUND OneLink
 * payload (`res.data`, §B.1) to the business destination.
 *
 * - `deep_link_value === 'referral'` → referral (code = `deep_link_sub1`).
 * - `deep_link_value` of event / brand / payouts / create_event → content
 *   (the event or brand id is `deep_link_sub1`); any other value → Home.
 * - no `deep_link_value` → referral when `af_sub1` is `ref:<code>`, else the
 *   universal-download no-op. A campaign `af_sub1` is never a referral.
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
  const afSub1Referral = referralCodeFromAfSub1(data["af_sub1"]);

  if (type === "referral" && sub1.length > 0) {
    return { kind: "referral", referralCode: sub1 };
  }
  if (type.length > 0 && type !== "referral") {
    return {
      kind: "content",
      target: contentTargetFor(type, sub1),
      referralCode: afSub1Referral,
    };
  }
  if (afSub1Referral) {
    return { kind: "referral", referralCode: afSub1Referral };
  }
  return { kind: "download" };
}

/**
 * W6-8: open a content OneLink's screen. Signed in → navigate now; signed out
 * → stash it for the post-sign-in replay (the push replay key). Never throws.
 */
export async function deliverBusinessOneLinkTarget(
  target: string,
  deps: {
    navigate: (target: string) => void;
    stashForAfterSignIn: (target: string) => Promise<void>;
  },
): Promise<"navigated" | "stashed" | "failed"> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user?.id) {
      deps.navigate(target);
      return "navigated";
    }
    await deps.stashForAfterSignIn(target);
    return "stashed";
  } catch (e) {
    console.warn("[AppsFlyer] OneLink delivery failed:", e);
    return "failed";
  }
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
    // #4238 W4-3 — install conversion data, registered before initSdk like
    // onDeepLink (the SDK drops a first-launch payload with no listener).
    registerInstallConversionData(sdk);
    // #4238 W6-6 / W6-5 — follow the privacy toggle and the push token.
    subscribePrivacyChoice();
    watchPushTokenForUninstall();

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

    // #4238 P2-2: DMA consent is set before initSdk starts transmission.
    applyConsentData(sdk);

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
        // #4238 W6-6 — the privacy choice applies before anything is replayed.
        applyPrivacyChoice();
        // #4238 W6-1 (I-4238-AF-START-NEVER-LOST-HOST) — replay, in order, the
        // events logged before init (none when opted out).
        const queued = _preInitEvents;
        _preInitEvents = [];
        for (const event of queued) logAppsFlyerEvent(event.name, event.values);
        // W6-5: the held uninstall token (initSdk has started the SDK, post-ATT).
        flushUninstallToken();
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
  _signedInUserId = userId;
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
  // #4238 W6-11 — hashed email for advanced matching (skipped when opted out).
  void syncAppsFlyerUserEmail(userId);
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
  _signedInUserId = null;
  // #4238 W6-1 — events queued for the signed-out user are dropped.
  _preInitEvents = [];
  // #4238 W6-11 — sign-out clears the email.
  clearAppsFlyerUserEmails();
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

      _installUid = uid;
      const platform = Platform.OS as "ios" | "android";
      const appId = platform === "ios" ? AF_IOS_APP_ID : AF_ANDROID_APP_ID;
      const deviceKey = `${userId}:${uid}`;
      if (registeredDeviceKeys.has(deviceKey)) return;

      const row = {
        user_id: userId,
        appsflyer_uid: uid,
        platform,
        app_id: appId,
        app: "business",
        updated_at: new Date().toISOString(),
      };
      const upsertDevice = (withOptOut: boolean): void => {
        supabase
          .from("appsflyer_devices")
          .upsert(
            // #4238 P2-4: the server skips AppsFlyer posts for an opted-out install.
            withOptOut ? { ...row, tracking_opt_out: isAnalyticsOptedOut() } : row,
            { onConflict: "user_id,app,appsflyer_uid" },
          )
          .then(({ error }) => {
            if (error && withOptOut && isMissingOptOutColumn(error)) {
              // #4238 P2-R1: the server is older than M-2. Register the
              // device anyway (no opt-out can be stored there yet).
              console.warn(
                "[AppsFlyer] tracking_opt_out not on the server yet; registering without it",
              );
              upsertDevice(false);
            } else if (error) {
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
      };
      upsertDevice(true);
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
  // #4238 W6-6 (I-4238-AF-RESPECTS-OPT-OUT-HOST) — analytics off: nothing logged.
  if (isAnalyticsOptedOut()) return;
  if (!_initialized || !appsFlyer) {
    // #4238 W6-1 — keep it for the init replay (bounded, oldest dropped).
    if (hasAppsFlyerEnv && appsFlyer) {
      _preInitEvents.push({ name: eventName, values: eventValues });
      if (_preInitEvents.length > PRE_INIT_EVENT_QUEUE_MAX) _preInitEvents.shift();
    }
    return;
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// #4238 W6-7 — registration counts once; the sign-in method is right
// ─────────────────────────────────────────────────────────────────────────────

/** Supabase `app_metadata.provider` → the AppsFlyer method value. */
export function appsFlyerAuthMethod(provider: unknown): string {
  const p = typeof provider === "string" ? provider.trim().toLowerCase() : "";
  if (p === "apple" || p === "google" || p === "phone" || p === "email") return p;
  return p.length > 0 ? "other" : "email";
}

const REGISTRATION_SENT_KEY_PREFIX = "@mingla_host_af_registration_sent:";

/**
 * Logs `af_complete_registration` at most once per user on this device (a
 * persisted flag keyed by user id), so a second session before the first one
 * settled cannot count the same account twice. Returns whether it logged.
 */
export async function logAppsFlyerRegistrationOnce(
  userId: string,
  eventValues: Record<string, string | number | boolean>,
): Promise<boolean> {
  const key = `${REGISTRATION_SENT_KEY_PREFIX}${userId}`;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = (require("@react-native-async-storage/async-storage") as {
      default: { getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<void> };
    }).default;
    if ((await AsyncStorage.getItem(key)) !== null) return false;
    await AsyncStorage.setItem(key, new Date().toISOString());
  } catch (e) {
    // Storage unavailable: still count it (better once-per-session than lost).
    console.warn("[AppsFlyer] registration flag unavailable:", e);
  }
  logAppsFlyerEvent("af_complete_registration", eventValues);
  return true;
}
