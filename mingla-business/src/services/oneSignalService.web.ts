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

/**
 * No-op → resolves. The native twin reads the OS permission and syncs it to a
 * OneSignal tag; with no SDK on web there is no permission state to read and no
 * tag to sync. Matches native `syncPushPermissionTag(): Promise<void>`.
 *
 * THIS is the one `_layout.tsx:654` calls on every tab refocus — its absence was
 * the live TypeError.
 */
export async function syncPushPermissionTag(): Promise<void> {}

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
