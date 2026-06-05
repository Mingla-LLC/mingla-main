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
