import { Platform } from "react-native";

import { postHogService } from "../services/postHogService";
import type { BusinessAnalyticsPlatform } from "./businessAnalyticsEvents";
import { captureWeb } from "./webAnalytics";

type IntelSurface = "insights_site";

const platform = (): BusinessAnalyticsPlatform => {
  if (Platform.OS === "web") return "web";
  if (Platform.OS === "android") return "android";
  return "ios";
};

const intelProperties = (surface: IntelSurface, verdictOrBand: string | null) => ({
  tool: "venues" as const,
  surface,
  door: "hub" as const,
  verdict_or_band: verdictOrBand,
  platform: platform(),
});

export const captureIntelCardShown = (surface: IntelSurface, verdictOrBand: string | null): void => {
  const properties = intelProperties(surface, verdictOrBand);
  postHogService.capture("intel_card_shown", properties);
  captureWeb("intel_card_shown", properties);
};

export const captureIntelRunStarted = (surface: IntelSurface): void => {
  const properties = intelProperties(surface, null);
  postHogService.capture("intel_run_started", properties);
  captureWeb("intel_run_started", properties);
};

export const captureIntelRunCompleted = (surface: IntelSurface, verdictOrBand: string | null): void => {
  const properties = intelProperties(surface, verdictOrBand);
  postHogService.capture("intel_run_completed", properties);
  captureWeb("intel_run_completed", properties);
};

export const captureIntelRunFailed = (surface: IntelSurface): void => {
  const properties = intelProperties(surface, null);
  postHogService.capture("intel_run_failed", properties);
  captureWeb("intel_run_failed", properties);
};

export const captureIntelReportOpened = (surface: IntelSurface, verdictOrBand: string | null): void => {
  const properties = intelProperties(surface, verdictOrBand);
  postHogService.capture("intel_report_opened", properties);
  captureWeb("intel_report_opened", properties);
};
