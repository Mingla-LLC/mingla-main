/**
 * #4490 O3B — web build of usePhonePortraitLock: nothing to lock in a browser,
 * and the web boot bundle carries no orientation code. Native:
 * usePhonePortraitLock.ts.
 */
export function usePhonePortraitLock(): void {
  // Browsers rotate as the device does; Host web has no orientation rule.
}
