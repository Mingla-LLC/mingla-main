import { Platform } from "react-native";

import { postHogService } from "../services/postHogService";
import type { BusinessAnalyticsPlatform } from "./businessAnalyticsEvents";
import { captureWeb } from "./webAnalytics";

const platform = (): BusinessAnalyticsPlatform => {
  if (Platform.OS === "web") return "web";
  if (Platform.OS === "android") return "android";
  return "ios";
};

export type CompetitorIntelligenceEvent =
  | "competitor_source_added" | "competitor_source_edited"
  | "competitor_refresh_due" | "competitor_refresh_started"
  | "competitor_refresh_succeeded" | "competitor_refresh_partial"
  | "competitor_refresh_failed" | "competitor_refresh_skipped_unchanged"
  | "competitor_refresh_budget_deferred" | "competitor_brief_opened"
  | "competitor_evidence_opened" | "competitor_recommendation_saved"
  | "competitor_recommendation_started" | "competitor_recommendation_dismissed"
  | "competitor_usefulness_submitted" | "competitor_capability_seen";

type CompetitorAnalyticsProperties = Partial<{
  brand_id: string; venue_id: string; watch_id: string; source_kind: string;
  status: string; source_count: number; schema_version: number; trigger: string;
  latency_bucket: string; cost_unit_bucket: string;
}>;

/** Issue #2725 privacy boundary: the type structurally excludes content/URLs/PII. */
export const captureCompetitorIntelligenceEvent = (
  event: CompetitorIntelligenceEvent,
  properties: CompetitorAnalyticsProperties,
): void => {
  const safe = { ...properties, platform: platform() } as const;
  postHogService.capture(event, safe);
  captureWeb(event, safe);
};

/** Preserve the #1735 event while its only remaining caller stays lazy. */
export const captureIntelCompetitorAdded = (): void => {
  const properties = {
    tool: "venues" as const,
    surface: "insights_competitor" as const,
    door: "hub" as const,
    verdict_or_band: null,
    platform: platform(),
  };
  postHogService.capture("intel_competitor_added", properties);
  captureWeb("intel_competitor_added", properties);
};
