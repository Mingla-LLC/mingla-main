/**
 * #4238 P1-4 / P2-3 (I-4238-AF-RESPECTS-OPT-OUT-EXPLORER): the Explorer Account "share
 * usage data" switch (appStore.analyticsOptOut), for code outside the
 * AppsFlyer service that must honour it (the native checkout request, the
 * RevenueCat AppsFlyer link).
 *
 * The store registers its reader when it is created (appStore.ts), so this
 * module never loads the persisted store itself: a checkout or RevenueCat path
 * running in a harness without the store reads "not opted out" and leaves no
 * store timers behind. Never throws.
 */
let readOptOut: (() => boolean) | null = null;

/** Called once by appStore.ts when the store is created. */
export function registerExplorerAnalyticsOptOutReader(read: () => boolean): void {
  readOptOut = read;
}

export function explorerAnalyticsOptedOut(): boolean {
  try {
    return readOptOut?.() === true;
  } catch {
    return false;
  }
}
