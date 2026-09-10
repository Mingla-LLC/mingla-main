import {
  sanitizeSearchMeasurement,
  type SearchEventName,
  type SearchMeasurementProperties,
} from "@mingla/search-measurement";
import { postHogService } from "../services/postHogService";

/**
 * Native Host search outcome. Metro selects searchOutcome.web.ts for web, so
 * neither GA nor posthog-js enters native bundles.
 */
export function captureHostSearchOutcome(
  event: SearchEventName,
  properties: SearchMeasurementProperties,
): void {
  const safe = sanitizeSearchMeasurement(event, properties);
  if (safe === null) return;
  postHogService.capture(safe.event, safe.properties);
}
