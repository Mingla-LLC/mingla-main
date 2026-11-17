/**
 * #4238 wave 2 — Host ad results charts: one colour per ad app, reused from
 * the analytics hues in the design system (no new hue family; each >= 3:1 on
 * the dark card). Colour is never the only signal: every bar also carries the
 * app name. Kept beside the charts so the tokens load with the ad results
 * screen, not in the boot chunk.
 */
import { color, trafficAnalytics } from "../../../../constants/designSystem";

export const hostAdCharts = {
  // #4420: the same analytics hues, read from the trafficAnalytics content
  // palette in designSystem.ts (no literal here).
  platform: {
    meta: trafficAnalytics.sources.own_links,
    snapchat: trafficAnalytics.sources.search,
    tiktok: trafficAnalytics.tapMeter,
    google: trafficAnalytics.sources.social,
    reddit: trafficAnalytics.sources.mingla_ads,
  },
  spend: color.text1,
  results: trafficAnalytics.positiveDelta,
  costPerResult: trafficAnalytics.sources.mingla_ads,
} as const;
