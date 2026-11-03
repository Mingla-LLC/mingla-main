/**
 * #4238 wave 2 — Host ad results charts: one colour per ad app, reused from
 * the analytics hues in the design system (no new hue family; each >= 3:1 on
 * the dark card). Colour is never the only signal: every bar also carries the
 * app name. Kept beside the charts so the tokens load with the ad results
 * screen, not in the boot chunk.
 */
import { accent, trafficAnalytics } from "../../../../constants/designSystem";

export const hostAdCharts = {
  platform: {
    meta: "#7aa7ff",
    snapchat: "#ffd2a8",
    tiktok: "#5fd4d0",
    google: "#b49cff",
    reddit: "#f6a15f",
  },
  spend: accent.warm,
  results: trafficAnalytics.positiveDelta,
  costPerResult: trafficAnalytics.sources.mingla_ads,
} as const;
