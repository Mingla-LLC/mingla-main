/** Issue #3697 — one shared async boundary for the sizeable Host Ads client. */
export const loadHostAdPlanService = () => import("./hostAdPlanService");
