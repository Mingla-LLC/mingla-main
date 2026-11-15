/**
 * #4238 P1-4 / P2-3 (I-4238-AF-RESPECTS-OPT-OUT): the Explorer Account "share
 * usage data" switch (appStore.analyticsOptOut), for code outside the
 * AppsFlyer service that must honour it (the native checkout request, the
 * RevenueCat AppsFlyer link).
 *
 * The store is required lazily: a harness that never loads it reads "not
 * opted out", and this never throws.
 */
export function explorerAnalyticsOptedOut(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAppStore } = require("../store/appStore") as {
      useAppStore: { getState: () => { analyticsOptOut?: boolean } };
    };
    return useAppStore.getState().analyticsOptOut === true;
  } catch {
    return false;
  }
}
