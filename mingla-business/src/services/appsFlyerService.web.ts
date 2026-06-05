export function initializeAppsFlyer(): void {}

export function setAppsFlyerUserId(_userId: string): void {}

export function clearAppsFlyerUserId(): void {}

export function registerAppsFlyerDevice(_userId: string): void {}

export function resetAppsFlyerDeviceCache(): void {}

export function logAppsFlyerEvent(
  _eventName: string,
  _eventValues: Record<string, string | number | boolean> = {},
): void {}
