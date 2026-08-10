import { Platform } from "react-native";
import { postHogService } from "../services/postHogService";
import { captureWeb } from "./webAnalytics";

export type BusinessAnalyticsEntryPoint = "home_tile" | "direct";
export type BusinessAnalyticsPlatform = "ios" | "android" | "web";
export type BusinessAnalyticsRefreshResult = "success" | "partial" | "error";
export type BusinessListingInsightsEntryPoint = "detail_action" | "direct";
export type BusinessListingInsightsType =
  | "event"
  | "trip"
  | "experience"
  | "rsvp";
export type BusinessListingInsightsRefreshResult = "success" | "error";

export const sanitizeBusinessAnalyticsEntryPoint = (
  value: string | string[] | undefined,
): BusinessAnalyticsEntryPoint => (value === "home_tile" ? "home_tile" : "direct");

export const sanitizeBusinessListingInsightsEntryPoint = (
  value: string | string[] | undefined,
): BusinessListingInsightsEntryPoint =>
  value === "detail_action" ? "detail_action" : "direct";

const platform = (): BusinessAnalyticsPlatform => {
  if (Platform.OS === "web") return "web";
  if (Platform.OS === "android") return "android";
  return "ios";
};

export const captureBusinessAnalyticsOpened = (
  entryPoint: BusinessAnalyticsEntryPoint,
  has30dCustomers: boolean,
): void => {
  const properties = {
    entry_point: entryPoint,
    platform: platform(),
    has_30d_customers: has30dCustomers,
  } as const;
  postHogService.capture("business_analytics_opened", properties);
  captureWeb("business_analytics_opened", properties);
};

export const captureBusinessAnalyticsRefreshed = (
  result: BusinessAnalyticsRefreshResult,
): void => {
  const properties = { platform: platform(), result } as const;
  postHogService.capture("business_analytics_refreshed", properties);
  captureWeb("business_analytics_refreshed", properties);
};

export const captureBusinessListingInsightsOpened = (
  listingType: BusinessListingInsightsType,
  entryPoint: BusinessListingInsightsEntryPoint,
  hasCustomers: boolean,
): void => {
  const properties = {
    listing_type: listingType,
    entry_point: entryPoint,
    platform: platform(),
    has_customers: hasCustomers,
  } as const;
  postHogService.capture("business_listing_insights_opened", properties);
  captureWeb("business_listing_insights_opened", properties);
};

export const captureBusinessListingInsightsRefreshed = (
  listingType: BusinessListingInsightsType,
  result: BusinessListingInsightsRefreshResult,
): void => {
  const properties = {
    listing_type: listingType,
    platform: platform(),
    result,
  } as const;
  postHogService.capture("business_listing_insights_refreshed", properties);
  captureWeb("business_listing_insights_refreshed", properties);
};

export const captureBusinessVenueReservationsViewed = (
  hasReservations: boolean,
): void => {
  const properties = { platform: platform(), has_reservations: hasReservations };
  postHogService.capture("business_venue_reservations_viewed", properties);
  captureWeb("business_venue_reservations_viewed", properties);
};

export const captureBusinessVenueReservationsRefreshed = (
  result: BusinessListingInsightsRefreshResult,
): void => {
  const properties = { platform: platform(), result };
  postHogService.capture("business_venue_reservations_refreshed", properties);
  captureWeb("business_venue_reservations_refreshed", properties);
};

export const captureBusinessVenueOrganicInsightsViewed = (
  hasActivity: boolean,
  windowComplete: boolean,
): void => {
  const properties = {
    platform: platform(),
    has_activity: hasActivity,
    window_complete: windowComplete,
  } as const;
  postHogService.capture("business_venue_organic_insights_viewed", properties);
  captureWeb("business_venue_organic_insights_viewed", properties);
};

export const captureBusinessVenueOrganicInsightsRefreshed = (
  result: BusinessAnalyticsRefreshResult,
): void => {
  const properties = { platform: platform(), result } as const;
  postHogService.capture(
    "business_venue_organic_insights_refreshed",
    properties,
  );
  captureWeb("business_venue_organic_insights_refreshed", properties);
};

// ── Issue #1735 G-16 — Mingla Intelligence (growth-tools) events ─────────────
// The approved v2 §6 set for the Insights surfaces — NO events beyond it.
// Every event carries {tool, surface, door, verdict_or_band} + platform().

export type IntelSurface = "insights_site" | "insights_competitor";

const intelProperties = (
  surface: IntelSurface,
  verdictOrBand: string | null,
): {
  tool: "venues";
  surface: IntelSurface;
  door: "hub";
  verdict_or_band: string | null;
  platform: BusinessAnalyticsPlatform;
} => ({
  tool: "venues",
  surface,
  door: "hub",
  verdict_or_band: verdictOrBand,
  platform: platform(),
});

export const captureIntelCardShown = (
  surface: IntelSurface,
  verdictOrBand: string | null,
): void => {
  const properties = intelProperties(surface, verdictOrBand);
  postHogService.capture("intel_card_shown", properties);
  captureWeb("intel_card_shown", properties);
};

export const captureIntelRunStarted = (surface: IntelSurface): void => {
  const properties = intelProperties(surface, null);
  postHogService.capture("intel_run_started", properties);
  captureWeb("intel_run_started", properties);
};

export const captureIntelRunCompleted = (
  surface: IntelSurface,
  verdictOrBand: string | null,
): void => {
  const properties = intelProperties(surface, verdictOrBand);
  postHogService.capture("intel_run_completed", properties);
  captureWeb("intel_run_completed", properties);
};

export const captureIntelRunFailed = (surface: IntelSurface): void => {
  const properties = intelProperties(surface, null);
  postHogService.capture("intel_run_failed", properties);
  captureWeb("intel_run_failed", properties);
};

export const captureIntelReportOpened = (
  surface: IntelSurface,
  verdictOrBand: string | null,
): void => {
  const properties = intelProperties(surface, verdictOrBand);
  postHogService.capture("intel_report_opened", properties);
  captureWeb("intel_report_opened", properties);
};

export const captureIntelCompetitorAdded = (): void => {
  const properties = intelProperties("insights_competitor", null);
  postHogService.capture("intel_competitor_added", properties);
  captureWeb("intel_competitor_added", properties);
};

export const captureIntelCompetitorGraded = (
  verdictOrBand: string | null,
): void => {
  const properties = intelProperties("insights_competitor", verdictOrBand);
  postHogService.capture("intel_competitor_graded", properties);
  captureWeb("intel_competitor_graded", properties);
};
