import { Platform } from "react-native";
import { postHogService } from "../services/postHogService";
import { captureWeb } from "./webAnalytics";

export type BusinessAnalyticsEntryPoint = "home_tile" | "direct";
export type BusinessAnalyticsPlatform = "ios" | "android" | "web";
export type BusinessAnalyticsRefreshResult = "success" | "partial" | "error";

export const sanitizeBusinessAnalyticsEntryPoint = (
  value: string | string[] | undefined,
): BusinessAnalyticsEntryPoint => (value === "home_tile" ? "home_tile" : "direct");

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
