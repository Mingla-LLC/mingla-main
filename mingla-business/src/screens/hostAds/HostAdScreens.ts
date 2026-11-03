/**
 * #4238 — the one on-intent chunk for Host Ads (web async routes).
 *
 * Metro hoists any module that two lazy chunks share into the eager
 * `__common` chunk every visitor downloads. The Ads list, builder and detail
 * routes, and the plan service Ari's ad card loads, all share the Host ad
 * words, money format, lifecycle and builder rules. Keeping all of them behind
 * this single module keeps those helpers out of the boot payload: each ads
 * route and `loadHostAdPlanService` import this file, so web makes one lazy
 * chunk for Host Ads.
 */
export { default as HostAdListScreen } from "./HostAdListScreen";
export { default as HostAdCreateScreen } from "./HostAdCreateScreen";
export { default as HostAdDetailScreen } from "./HostAdDetailScreen";
export * from "../../services/hostAdPlanService";
