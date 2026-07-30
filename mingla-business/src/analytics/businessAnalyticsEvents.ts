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
