import {
  sanitizeSearchMeasurement,
  type SearchEventName,
  type SearchMeasurementProperties,
} from "@mingla/search-measurement";
import { postHogService } from "./postHogService";

/**
 * Search-acquisition outcomes for Explorer. The shared sanitizer is the data
 * boundary: failed validation means nothing leaves the device.
 */
export function captureExplorerSearchOutcome(
  event: SearchEventName,
  properties: SearchMeasurementProperties,
): void {
  const safe = sanitizeSearchMeasurement(event, properties);
  if (safe === null) return;
  postHogService.capture(safe.event, safe.properties);
}
