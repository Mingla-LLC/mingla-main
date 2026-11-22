/**
 * WEB SHIM for oneSignalService — ORCH-1380 [onesignal-web-shim-export-drift].
 *
 * ⚠️ SAME RULE AS appsFlyerService.web.ts, and it was broken here too. Every
 * export of the NATIVE twin (`oneSignalService.ts`) MUST exist here. TypeScript
 * is blind to the gap (`tsc` resolves the NATIVE module; Metro substitutes THIS
 * one), so a missing export is a GREEN typecheck and a live production
 * `TypeError`.
 *
 * What shipped: `syncPushPermissionTag` was missing here and `_layout.tsx:654`
 * called it on EVERY tab background→foreground transition — a live TypeError on
 * every refocus, for every business-web user.
 *
 * CI now enforces the pairing:
 * `.github/scripts/strict-grep/i-1378-web-shim-export-parity.mjs`
 * (I-PROPOSED-1378-WEB-SHIM-EXPORT-PARITY). Add to the native twin → add here in
 * the SAME COMMIT.
 */

export interface OneSignalNotificationData {
  type?: string;
  [key: string]: unknown;
}

export function initializeOneSignal(): void {}

export function isOneSignalReady(): boolean {
  return false;
}

export function loginToOneSignal(_userId: string): void {}

export async function requestPushPermission(): Promise<boolean> {
  return false;
}

// ─── ORCH-1380: the two exports whose ABSENCE threw on every tab refocus ────

/**
 * No-op → `false`. The native twin returns whether the OneSignal SDK is up and
 * able to prompt; on web there is no SDK, so we can never safely prompt.
 * Matches native `canRequestPushPermission(): Promise<boolean>`.
 */
export async function canRequestPushPermission(): Promise<boolean> {
  return false;
}

// #4549 S4: `syncPushPermissionTag` is gone from both twins (the native app no
// longer writes the account-wide permission tag), so it is gone here too.

// ─── #4549 S1: registration state and repair — no SDK on web ──────────────

export type PushPermissionState = "granted" | "denied" | "not_determined";

export interface PushRegistrationState {
  sdkReady: boolean;
  permission: PushPermissionState;
  canPrompt: boolean;
  subscriptionIdPresent: boolean;
  subscriptionId: string | null;
  tokenPresent: boolean;
  optedIn: boolean;
  externalId: string | null;
}

export type PushRepairStep = "relink" | "resubscribe";

/** No SDK on web: never ready. Matches native `whenOneSignalReady`. */
export async function whenOneSignalReady(_timeoutMs: number): Promise<boolean> {
  return false;
}

/** Matches native `mapNativePermission`; pure, so the same answer on web. */
export function mapNativePermission(
  native: number,
  canPrompt: boolean,
): PushPermissionState {
  if (native === 2 || native === 3 || native === 4) return "granted";
  if (native === 1) return canPrompt ? "not_determined" : "denied";
  return "not_determined";
}

/** No SDK on web: the not-ready state. */
export async function readPushRegistrationState(): Promise<PushRegistrationState> {
  return {
    sdkReady: false,
    permission: "not_determined",
    canPrompt: false,
    subscriptionIdPresent: false,
    subscriptionId: null,
    tokenPresent: false,
    optedIn: false,
    externalId: null,
  };
}

/** No SDK on web: nothing to repair. */
export async function repairPushRegistration(
  _userId: string,
  _step: PushRepairStep,
  _isStillCurrent?: () => boolean,
): Promise<boolean> {
  return false;
}

/** No SDK on web: nothing to cancel; returns a no-op cleanup. */
export function onOneSignalLogout(_listener: () => void): () => void {
  return (): void => {};
}

export function logoutOneSignal(): void {}

export function clearNotificationBadge(): void {}

export function onForegroundNotification(
  _callback: (
    data: OneSignalNotificationData,
    prevent: () => void,
    display: () => void,
  ) => void,
): () => void {
  return (): void => {};
}

export function onNotificationClicked(
  _callback: (data: OneSignalNotificationData) => void,
): () => void {
  return (): void => {};
}

// #4238 W6-5 — no push token on web; the listener is never called.
export function onPushSubscriptionToken(
  _listener: (token: string | null) => void,
): void {}
