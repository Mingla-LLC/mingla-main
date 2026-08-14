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
 * Env-driven: no-op (with single warn) if EXPO_PUBLIC_ONESIGNAL_APP_ID missing.
 */

import { Platform } from "react-native";

const ONESIGNAL_APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID;

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

/**
 * Initialize the OneSignal SDK. Call once at app startup before any other
 * OneSignal method. Safe to call again — subsequent calls are no-ops.
 */
export function initializeOneSignal(): void {
  if (_initialized) return;
  if (!_enabled) {
    console.warn(
      "[OneSignal] env missing — SDK disabled. Set EXPO_PUBLIC_ONESIGNAL_APP_ID as an EAS Secret to enable.",
    );
    return;
  }
  try {
    OneSignal!.Debug.setLogLevel(__DEV__ ? LogLevel!.Verbose : LogLevel!.Warn);
    OneSignal!.initialize(ONESIGNAL_APP_ID!);
    _initialized = true;
    if (__DEV__) console.log("[OneSignal] initialized");
    // ORCH-1250 (consumer ORCH-1243 parity): seed the OS-permission tag as soon
    // as the SDK is up so the launch In-App Message audience can read TRUE OS
    // permission, not OneSignal's async subscription state. Fire-and-forget;
    // self-guards on _initialized.
    void syncPushPermissionTag();
  } catch (e) {
    console.warn("[OneSignal] init failed:", e);
  }
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
    // ORCH-1250 (consumer ORCH-1243 parity): keep the OS-permission tag fresh
    // once identity + subscription are established (the tag is now attached to
    // the logged-in user). Fire-and-forget; self-guards on _initialized.
    void syncPushPermissionTag();
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
    // ORCH-1250 (consumer ORCH-1243 parity): a fresh grant/deny from the OS
    // dialog must update the tag immediately so the In-App Message audience
    // reconciles right away.
    await syncPushPermissionTag();
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
 * ORCH-1250 (consumer ORCH-1243 parity): mirror the device's TRUE OS
 * notification permission into a OneSignal tag.
 *
 * TAG CONTRACT:
 *   key   = `push_os_permission`
 *   value ∈ { `granted`, `denied` }
 *
 * Consumed by the launch "turn on notifications" In-App Message audience. The
 * dashboard message must target this TAG (show when `push_os_permission !=
 * granted`) instead of OneSignal's subscription state: OneSignal v5 registers
 * the push subscription ASYNCHRONOUSLY, so at launch the audience can see a
 * device as "not subscribed" even when iOS permission is GRANTED → the false
 * "notifications are off" / "Open Settings" popup. The OS permission read below
 * is synchronous truth, so the tag is reliable.
 *
 * Kept fresh by calling at init, login, after the permission dialog, and on app
 * foreground (so returning from iOS Settings reconciles the tag). Self-guards on
 * `_initialized` and never throws.
 */
export async function syncPushPermissionTag(): Promise<void> {
  if (!_initialized || OneSignal === null) return;
  try {
    // OneSignal v5 (react-native-onesignal) — TRUE OS permission read:
    //   Notifications.getPermissionAsync(): Promise<boolean>
    const granted = await OneSignal.Notifications.getPermissionAsync();
    // addTag(key, value): void — reliable, synchronous-truth tag.
    OneSignal.User.addTag(
      "push_os_permission",
      granted ? "granted" : "denied",
    );
    if (__DEV__)
      console.log("[OneSignal] os-permission tag synced:", granted);
  } catch (e) {
    console.warn("[OneSignal] syncPushPermissionTag failed:", e);
  }
}

/**
 * Unlink the device from the current user. Call on signOut so the next
 * signed-in user is not attributed to the prior user's OneSignal alias.
 *
 * Constitution #6 — logout clears everything including third-party identity
 * caches that survive Supabase signOut by default.
 */
export function logoutOneSignal(): void {
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
  if (!_initialized || OneSignal === null) {
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
  OneSignal.Notifications.addEventListener(
    "foregroundWillDisplay",
    handler as never,
  );
  return (): void => {
    OneSignal?.Notifications.removeEventListener(
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
  if (!_initialized || OneSignal === null) {
    return (): void => {};
  }
  const handler = (event: {
    notification: { additionalData?: unknown };
  }): void => {
    const data = (event.notification.additionalData ??
      {}) as OneSignalNotificationData;
    callback(data);
  };
  OneSignal.Notifications.addEventListener("click", handler as never);
  return (): void => {
    OneSignal?.Notifications.removeEventListener("click", handler as never);
  };
}
