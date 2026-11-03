/**
 * Issue #3697 — one shared async boundary for the sizeable Host Ads client.
 * #4238: it loads the Host Ads chunk (the ads screens re-export this service),
 * so the plan service and the ads routes never become two lazy chunks that
 * share Host ad helpers (Metro would hoist those into the boot chunk).
 */
export const loadHostAdPlanService = () => import("../screens/hostAds/HostAdScreens");
