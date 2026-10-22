import { Platform } from "react-native";

import { captureWeb } from "./webAnalytics";
import { postHogService } from "../services/postHogService";

type DiscountAnalyticsValue = string | number | boolean;
type DiscountAnalyticsProperties = Readonly<
  Record<string, DiscountAnalyticsValue>
>;

/** #3872 — one PII-free PostHog path for Host native and consented Host web. */
export function captureDiscountEvent(
  event: string,
  properties: DiscountAnalyticsProperties = {},
): void {
  postHogService.capture(event, properties);
  if (Platform.OS === "web") captureWeb(event, properties);
}
