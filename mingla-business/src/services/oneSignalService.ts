/**
 * OneSignal integration for Mingla Host.
 *
 * ORCH-0808-FOLLOWUP installed identity-only (init + login + logout).
 * META-ORCH-1074 Sub-B completes the receive path:
 *   - `optIn()` at login (register the device for push delivery), mirroring
 *     the consumer ORCH-0407 pattern. optIn() ≠ the OS permission dialog —
 *     it is the server-side subscription. OneSignal docs:
 *     https://documentation.onesignal.com/docs/aliases-external-id
 *     https://documentation.onesignal.com/docs/permission-requests
 *   - `requestPushPermission()` — the OS-level prompt (Android 13+
 *     POST_NOTIFICATIONS + iOS), fired at a moment of demonstrated value
 *     (NOT on boot — see usePushPermissionMoment).
 *   - `onForegroundNotification` / `onNotificationClicked` listeners
 *     (SDK v5 requires an explicit display() for foreground banners).
 *   - `clearNotificationBadge()` — reset the iOS app-icon badge on
 *     mark-all-read (Sub-C).
 *
 * All push surface is Platform.OS/`_enabled`-guarded: web bundles never
 * import the native module (web export stays buildable — I-PROPOSED-X).
 *
 * Manifest/env-driven: no-op (with a single warning) if
 * EXPO_PUBLIC_ONESIGNAL_APP_ID is missing.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";

// #3720: EAS Update resolves app.config.js into the served manifest, so `extra`
// is the runtime-safe authority for an OTA. Keep the static process.env fallback
// for native builds and local development, but never make an OTA depend only on
// a compile-time substitution that can disappear when an EAS variable has the
// wrong visibility.
const manifestOneSignalAppId = Constants.expoConfig?.extra
  ?.EXPO_PUBLIC_ONESIGNAL_APP_ID;
const ONESIGNAL_APP_ID =
  typeof manifestOneSignalAppId === "string" &&
  manifestOneSignalAppId.length > 0
    ? manifestOneSignalAppId
    : process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID;

// Defer react-native-onesignal require so web bundles don't blow up at
// module-load. The package imports native modules that fail to resolve
// under `expo export -p web`. Web bundles intentionally skip push.
// Invariant: mingla-business web export tolerates native-only deps via
// Platform.OS guard (paired with I-PROPOSED-X web-export deprecation).
let OneSignal: typeof import("react-native-onesignal").OneSignal | null = null;
let LogLevel: typeof import("react-native-onesignal").LogLevel | null = null;
if (Platform.OS !== "web" && ONESIGNAL_APP_ID) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-onesignal");
    OneSignal = mod.OneSignal;
    LogLevel = mod.LogLevel;
  } catch (err) {
    console.warn("[OneSignal] native module unavailable; push disabled:", err);
  }
}

let _initialized = false;
let _loginComplete = false;
const _enabled =
  typeof ONESIGNAL_APP_ID === "string" &&
  ONESIGNAL_APP_ID.length > 0 &&
  OneSignal !== null;

// #4549 S1: one promise that settles when initializeOneSignal() succeeds, so a
// caller can wait for the SDK instead of returning silently when it is not up.
let _resolveReady: ((ready: boolean) => void) | null = null;
const _readyPromise: Promise<boolean> = new Promise<boolean>((resolve) => {
  _resolveReady = resolve;
});

// #4549 S0: on Android the OneSignal SDK throws "Must call 'initWithContext'
// before use" (IllegalStateException, OneSignal-Android 5.10.2 OneSignalImp
// waitForInit) for ANY Notifications/User call made before initialize(). Inside
// a native-module method that is an uncaught native exception, i.e. a crash,
// and a JS try/catch cannot see it. The SDK was never linked on Android before
// #4549, so nothing here had to care. Listener attachments that happen before
// the deferred initializeOneSignal() are therefore queued on Android and run
// right after initialize succeeds. iOS keeps its early attach (its bridge
// initializes with a nil app id so launch clicks are captured).
const _mustWaitForInit = Platform.OS === "android";
const _afterInit: Array<() => void> = [];

function runAfterInit(task: () => void): void {
  if (_initialized || !_mustWaitForInit) {
    task();
    return;
  }
  _afterInit.push(task);
}

function flushAfterInit(): void {
  for (const task of _afterInit.splice(0, _afterInit.length)) {
    try {
      task();
    } catch (e) {
      console.warn("[OneSignal] deferred listener attach failed:", e);
    }
  }
}

// #4549 S4: the account-wide `push_os_permission` tag is removed once per
// install. Nothing sends on it and it was wrong for accounts with several
// phones; the per-device truth is host_push_devices.device_permission.
const PERMISSION_TAG_KEY = "push_os_permission";
const PERMISSION_TAG_REMOVED_FLAG = "mingla-business.pushPermissionTagRemoved.v1";

/**
 * Initialize the OneSignal SDK. Call once at app startup before any other
 * OneSignal method. Safe to call again — subsequent calls are no-ops.
 */
export function initializeOneSignal(): void {
  if (_initialized) return;
  if (!_enabled) {
    console.warn(
      "[OneSignal] env missing — SDK disabled. Set EXPO_PUBLIC_ONESIGNAL_APP_ID as an EAS Sensitive or Plain variable so native builds and OTAs can inline it.",
    );
    return;
  }
  try {
    OneSignal!.Debug.setLogLevel(__DEV__ ? LogLevel!.Verbose : LogLevel!.Warn);
    OneSignal!.initialize(ONESIGNAL_APP_ID!);
    _initialized = true;
    // #4238 W6-5 — hand the push token to listeners registered before init.
    attachPushTokenListeners();
    // #3720: the SDK's native bridge can surface a notification click during
    // cold startup. Keep the capture attached independently of React/auth so a
    // tap cannot be lost between native launch and the root layout subscribing.
    ensureNativeNotificationClickCapture();
    // #4549 S0: listeners asked for before init (Android only) attach now.
    flushAfterInit();
    if (__DEV__) console.log("[OneSignal] initialized");
    _resolveReady?.(true);
    // #4549 S4: clear the stale account-wide permission tag once per install.
    void removePermissionTagOnce();
  } catch (e) {
    console.warn("[OneSignal] init failed:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// #4238 W6-5 — the device push token, for AppsFlyer uninstall measurement
// ─────────────────────────────────────────────────────────────────────────────

type PushTokenListener = (token: string | null) => void;
const _pushTokenListeners: PushTokenListener[] = [];
let _pushTokenAttached = false;

function emitPushToken(token: unknown): void {
  const value = typeof token === "string" && token.length > 0 ? token : null;
  for (const listener of _pushTokenListeners) {
    try {
      listener(value);
    } catch (e) {
      console.warn("[OneSignal] push token listener threw:", e);
    }
  }
}

/**
 * OneSignal v5 `User.pushSubscription`: the current token (APNs hex on iOS,
 * FCM on Android) once, then every change. Guarded so a partial native module
 * never throws.
 */
function attachPushTokenListeners(): void {
  if (_pushTokenAttached || !_initialized || _pushTokenListeners.length === 0) {
    return;
  }
  const sub = OneSignal?.User?.pushSubscription as
    | {
        getTokenAsync?: () => Promise<string | null>;
        addEventListener?: (
          event: "change",
          cb: (e: { current?: { token?: string | null } }) => void,
        ) => void;
      }
    | undefined;
  if (!sub) return;
  _pushTokenAttached = true;
  try {
    if (typeof sub.getTokenAsync === "function") {
      void sub.getTokenAsync().then(emitPushToken).catch((e: unknown) => {
        console.warn("[OneSignal] getTokenAsync failed:", e);
      });
    }
    if (typeof sub.addEventListener === "function") {
      sub.addEventListener("change", (e) => emitPushToken(e?.current?.token));
    }
  } catch (e) {
    console.warn("[OneSignal] push token watch failed:", e);
  }
}

/** #4238 W6-5: receive the push token now (when ready) and on every change. */
export function onPushSubscriptionToken(listener: PushTokenListener): void {
  _pushTokenListeners.push(listener);
  if (_pushTokenAttached) {
    const sub = OneSignal?.User?.pushSubscription as
      | { getTokenAsync?: () => Promise<string | null> }
      | undefined;
    if (typeof sub?.getTokenAsync === "function") {
      void sub.getTokenAsync().then((t) => {
        try {
          listener(typeof t === "string" && t.length > 0 ? t : null);
        } catch (e) {
          console.warn("[OneSignal] push token listener threw:", e);
        }
      }).catch(() => {});
    }
    return;
  }
  attachPushTokenListeners();
}

/** Returns true if the SDK has been successfully initialized. */
export function isOneSignalReady(): boolean {
  return _initialized;
}

/**
 * Link this device to a Supabase user AND register it for push delivery.
 * Fire-and-forget. Idempotent — safe to call multiple times for the same id.
 *
 * META-ORCH-1074 Sub-B: optIn() is now called here (consumer ORCH-0407 parity).
 * Without optIn(), the device is identified but NOT subscribed — OneSignal
 * returns invalid_aliases on send. optIn() registers the subscription
 * immediately (server-side); the OS permission dialog stays deferred to
 * `requestPushPermission()` at the value moment. These are separate concerns:
 *   - optIn() = "register this device for push delivery"
 *     (https://documentation.onesignal.com/docs/aliases-external-id)
 *   - requestPermission() = "let the OS show banners"
 *     (https://documentation.onesignal.com/docs/permission-requests)
 */
export function loginToOneSignal(userId: string): void {
  if (!_initialized) return;
  try {
    OneSignal!.login(userId);
    // optIn() is async on the SDK but fire-and-forget here (consumer parity).
    void OneSignal!.User.pushSubscription.optIn();
    _loginComplete = true;
    if (__DEV__) console.log("[OneSignal] logged in + optIn:", userId);
  } catch (e) {
    console.warn("[OneSignal] login failed:", e);
  }
}

/**
 * Request OS-level notification permission (Android 13+ POST_NOTIFICATIONS +
 * iOS prompt). Call AFTER the user has context for why they want
 * notifications (the value moment — see usePushPermissionMoment). Do NOT
 * call on app boot. Returns whether permission was granted.
 *
 * optIn() is already called at login — this only handles the OS dialog.
 * https://documentation.onesignal.com/docs/permission-requests
 *
 * ORCH-1250 (consumer ORCH-1244 parity, Apple Guideline 4.5.4): push must be
 * optional + consent-based. We pass `fallbackToSettings: false` so a user who
 * already DECLINED is NOT steered into the iOS Settings app to flip
 * notifications on — the native "Open Settings" dialog (title "Open Settings",
 * "You currently have notifications turned off…") is exactly the false popup
 * this ORCH kills. `false` respects a prior decline; the first OS dialog still
 * shows (it already carries a real "Don't Allow"). Callers gate this behind the
 * one-shot AsyncStorage guard in usePushPermissionMoment so the dialog only
 * appears once, on a never-asked device.
 */
export async function requestPushPermission(): Promise<boolean> {
  if (!_initialized) return false;
  try {
    // ORCH-1250: fallbackToSettings = false (was true). `true` steered a
    // previously-declining user into the iOS Settings app — the textbook 4.5.4
    // "push feels mandatory" / false "notifications off" trigger.
    const granted = await OneSignal!.Notifications.requestPermission(false);
    if (__DEV__) console.log("[OneSignal] permission result:", granted);
    return granted;
  } catch (e) {
    console.warn("[OneSignal] requestPushPermission failed:", e);
    return false;
  }
}

/**
 * ORCH-1250 (consumer ORCH-1244 parity, Apple Guideline 4.5.4): true only when
 * the OS can STILL be asked for push permission — i.e. the device has not been
 * prompted yet. Once the user has answered (allow OR deny), this returns false
 * and callers must NOT re-surface the OS dialog.
 *
 * Wraps OneSignal v5 `Notifications.canRequestPermission(): Promise<boolean>`.
 * Lives here so the OneSignal import stays isolated to this service; callers use
 * THIS, never OneSignal directly. Self-guards on `_initialized` and never throws
 * — returns false if the SDK isn't up (we cannot safely prompt before init).
 */
export async function canRequestPushPermission(): Promise<boolean> {
  if (!_initialized) return false;
  try {
    return await OneSignal!.Notifications.canRequestPermission();
  } catch (e) {
    console.warn("[OneSignal] canRequestPushPermission failed:", e);
    return false;
  }
}

/**
 * #4549 S4: remove the account-wide `push_os_permission` tag once per install.
 * ORCH-1250 wrote it from every phone of an account, so its value was whatever
 * the last phone saw; no send, segment or in-app message reads it. AsyncStorage
 * is loaded on use (never at module scope). Never throws.
 */
async function removePermissionTagOnce(): Promise<void> {
  if (!_initialized || OneSignal === null) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const storage = require("@react-native-async-storage/async-storage")
      .default as {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<void>;
    };
    if ((await storage.getItem(PERMISSION_TAG_REMOVED_FLAG)) === "1") return;
    OneSignal.User.removeTag(PERMISSION_TAG_KEY);
    await storage.setItem(PERMISSION_TAG_REMOVED_FLAG, "1");
  } catch (e) {
    console.warn("[OneSignal] permission tag removal failed:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// #4549 S1 — registration state and repair (only pushRegistrationHealth calls
// these; every SDK call stays in this file)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves `true` as soon as initializeOneSignal() has succeeded, `false` on
 * timeout or when push is disabled in this build. No polling. Never throws.
 */
export function whenOneSignalReady(timeoutMs: number): Promise<boolean> {
  if (_initialized) return Promise.resolve(true);
  if (!_enabled) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
    void _readyPromise.then((ready) => {
      clearTimeout(timer);
      resolve(ready);
    });
  });
}

export type PushPermissionState = "granted" | "denied" | "not_determined";

export interface PushRegistrationState {
  sdkReady: boolean;
  permission: PushPermissionState;
  canPrompt: boolean;
  subscriptionIdPresent: boolean;
  /** Kept in memory and sent only to Mingla's own server. */
  subscriptionId: string | null;
  tokenPresent: boolean;
  optedIn: boolean;
  externalId: string | null;
}

const NOT_READY_STATE: PushRegistrationState = {
  sdkReady: false,
  permission: "not_determined",
  canPrompt: false,
  subscriptionIdPresent: false,
  subscriptionId: null,
  tokenPresent: false,
  optedIn: false,
  externalId: null,
};

/**
 * react-native-onesignal 5.5.15 `OSNotificationPermission`: NotDetermined 0,
 * Denied 1, Authorized 2, Provisional 3, Ephemeral 4. Android's native bridge
 * only ever answers 2 (granted) or 1, so "1 while the OS can still ask" is a
 * device that was never asked.
 */
export function mapNativePermission(
  native: number,
  canPrompt: boolean,
): PushPermissionState {
  if (native === 2 || native === 3 || native === 4) return "granted";
  if (native === 1) return canPrompt ? "not_determined" : "denied";
  return "not_determined";
}

async function settle<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (e) {
    console.warn("[OneSignal] registration read failed:", e);
    return fallback;
  }
}

/** What this device can see about its own push setup. Never throws. */
export async function readPushRegistrationState(): Promise<PushRegistrationState> {
  if (!_initialized || OneSignal === null) return { ...NOT_READY_STATE };
  const sdk = OneSignal;
  const canPrompt = await settle(
    () => sdk.Notifications.canRequestPermission(),
    false,
  );
  const native = await settle(
    () => sdk.Notifications.permissionNative() as Promise<number>,
    0,
  );
  const subscriptionId = await settle(
    () => sdk.User.pushSubscription.getIdAsync(),
    null,
  );
  const token = await settle(
    () => sdk.User.pushSubscription.getTokenAsync(),
    null,
  );
  const optedIn = await settle(
    () => sdk.User.pushSubscription.getOptedInAsync(),
    false,
  );
  const externalId = await settle(() => sdk.User.getExternalId(), null);
  const id = typeof subscriptionId === "string" && subscriptionId.length > 0
    ? subscriptionId
    : null;
  return {
    sdkReady: true,
    permission: mapNativePermission(native, canPrompt),
    canPrompt,
    subscriptionIdPresent: id !== null,
    subscriptionId: id,
    tokenPresent: typeof token === "string" && token.length > 0,
    optedIn: optedIn === true,
    externalId:
      typeof externalId === "string" && externalId.length > 0
        ? externalId
        : null,
  };
}

export type PushRepairStep = "relink" | "resubscribe";

const RESUBSCRIBE_PAUSE_MS = 1000;

/**
 * One repair step. `relink` = login(userId) then optIn(); `resubscribe` =
 * optOut(), wait 1 s, optIn(), then login(userId). Returns false when the SDK
 * is not up or a call threw. Never throws.
 */
export async function repairPushRegistration(
  userId: string,
  step: PushRepairStep,
  isStillCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (!_initialized || OneSignal === null) return false;
  const sdk = OneSignal;
  // #4549 P1-1: the caller's identity check runs again right before every SDK
  // call that links or subscribes, so a sign-out (or another account signing
  // in) in between can never link this phone to the previous account.
  if (!isStillCurrent()) return false;
  try {
    switch (step) {
      case "relink":
        sdk.login(userId);
        sdk.User.pushSubscription.optIn();
        break;
      case "resubscribe":
        sdk.User.pushSubscription.optOut();
        await new Promise<void>((resolve) =>
          setTimeout(resolve, RESUBSCRIBE_PAUSE_MS),
        );
        if (!isStillCurrent()) return false;
        sdk.User.pushSubscription.optIn();
        sdk.login(userId);
        break;
      default: {
        const unreachable: never = step;
        return unreachable;
      }
    }
    _loginComplete = true;
    return true;
  } catch (e) {
    console.warn("[OneSignal] repair step failed:", step, e);
    return false;
  }
}

// #4549 P1-1: sign-out listeners. logoutOneSignal() is the one sign-out
// funnel every AuthContext path already calls; it tells listeners first and
// synchronously, even when the SDK is not up yet (the exact window of the
// race), so pending push checks are cancelled before anything else runs.
const _logoutListeners = new Set<() => void>();

export function onOneSignalLogout(listener: () => void): () => void {
  _logoutListeners.add(listener);
  return (): void => {
    _logoutListeners.delete(listener);
  };
}

/**
 * Unlink the device from the current user. Call on signOut so the next
 * signed-in user is not attributed to the prior user's OneSignal alias.
 *
 * Constitution #6 — logout clears everything including third-party identity
 * caches that survive Supabase signOut by default.
 */
export function logoutOneSignal(): void {
  for (const listener of _logoutListeners) {
    try {
      listener();
    } catch (e) {
      console.warn("[OneSignal] logout listener threw:", e);
    }
  }
  if (!_initialized) return;
  _loginComplete = false;
  try {
    OneSignal!.logout();
    if (__DEV__) console.log("[OneSignal] logged out");
  } catch (e) {
    console.warn("[OneSignal] logout failed:", e);
  }
}

/**
 * Clear all OneSignal notifications + reset the iOS app-icon badge to 0.
 * Guards: SDK initialized + login complete; wrapped to keep native ObjC
 * exceptions off the TurboModule bridge (consumer parity).
 */
export function clearNotificationBadge(): void {
  if (!_initialized || !_loginComplete) return;
  try {
    OneSignal!.Notifications.clearAll();
  } catch (e) {
    console.warn("[OneSignal] clearAll failed:", e);
  }
}

export interface OneSignalNotificationData {
  type?: string;
  [key: string]: unknown;
}

type NotificationClickCallback = (data: OneSignalNotificationData) => void;

// #3720: a cold push tap can reach the native bridge before the root layout's
// effect has mounted. OneSignal 5.4.5 deliberately supports cold-start click
// capture, but the previous `_initialized` guard returned a permanent no-op
// listener because SDK initialization was deferred until after interactions.
// Own one app-lifetime native listener here, buffer at most the latest tap until
// React is ready, and fan out to current subscribers. The pending tap is taken
// before callback invocation so it can be replayed at most once.
const _notificationClickSubscribers = new Set<NotificationClickCallback>();
let _pendingNotificationClick: OneSignalNotificationData | null = null;
let _nativeNotificationClickCaptureAttached = false;

const _nativeNotificationClickHandler = (event: {
  notification: { additionalData?: unknown };
}): void => {
  const data = (event.notification.additionalData ??
    {}) as OneSignalNotificationData;
  if (_notificationClickSubscribers.size === 0) {
    _pendingNotificationClick = data;
    return;
  }
  for (const subscriber of _notificationClickSubscribers) {
    try {
      subscriber(data);
    } catch (error) {
      console.warn("[OneSignal] notification click subscriber failed:", error);
    }
  }
};

function ensureNativeNotificationClickCapture(): void {
  if (OneSignal === null || _nativeNotificationClickCaptureAttached) return;
  // #4549 S0: never touch the Android SDK before initialize() (crash);
  // initializeOneSignal() calls this again once the SDK is up.
  if (_mustWaitForInit && !_initialized) return;
  try {
    OneSignal.Notifications.addEventListener(
      "click",
      _nativeNotificationClickHandler as never,
    );
    _nativeNotificationClickCaptureAttached = true;
  } catch (error) {
    // A platform that requires initialize() first gets one retry from
    // initializeOneSignal(). Until then, do not lie that capture is attached.
    console.warn("[OneSignal] early notification click capture failed:", error);
  }
}

// Register during module evaluation, before the Expo root renders. On iOS the
// OneSignal bridge initializes with a nil app id specifically so launch-click
// listeners can attach this early; initializeOneSignal() supplies the real id.
ensureNativeNotificationClickCapture();

/**
 * Register a callback for a push arriving while the app is foregrounded.
 * SDK v5 requires an explicit `display()` to show the banner. The callback
 * gets `(data, prevent, display)`. Returns a cleanup function.
 */
export function onForegroundNotification(
  callback: (
    data: OneSignalNotificationData,
    prevent: () => void,
    display: () => void,
  ) => void,
): () => void {
  if (OneSignal === null) {
    return (): void => {};
  }
  // SDK event shapes are loosely typed; narrow at the boundary.
  const handler = (event: {
    getNotification: () => {
      additionalData?: unknown;
      title?: string;
      display: () => void;
    };
    preventDefault: () => void;
  }): void => {
    const notification = event.getNotification();
    const data = (notification.additionalData ?? {}) as OneSignalNotificationData;
    callback(
      data,
      () => event.preventDefault(),
      () => notification.display(),
    );
  };
  const sdk = OneSignal;
  let attached = false;
  let removed = false;
  // #4549 S0: on Android this waits for initialize() (see runAfterInit).
  runAfterInit(() => {
    if (removed) return;
    sdk.Notifications.addEventListener("foregroundWillDisplay", handler as never);
    attached = true;
  });
  return (): void => {
    removed = true;
    if (!attached) return;
    sdk.Notifications.removeEventListener(
      "foregroundWillDisplay",
      handler as never,
    );
  };
}

/**
 * Register a callback for when the user taps a notification (tray / lock
 * screen / banner). The callback receives the notification `data` payload.
 * Returns a cleanup function.
 */
export function onNotificationClicked(
  callback: (data: OneSignalNotificationData) => void,
): () => void {
  if (OneSignal === null) {
    return (): void => {};
  }

  ensureNativeNotificationClickCapture();
  _notificationClickSubscribers.add(callback);

  const pending = _pendingNotificationClick;
  if (pending !== null) {
    _pendingNotificationClick = null;
    try {
      callback(pending);
    } catch (error) {
      console.warn(
        "[OneSignal] pending notification click replay failed:",
        error,
      );
    }
  }

  return (): void => {
    _notificationClickSubscribers.delete(callback);
  };
}
