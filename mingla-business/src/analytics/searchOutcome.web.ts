import {
  type SearchEventName,
  type SearchMeasurementProperties,
} from "@mingla/search-measurement";
import { captureWebSearchOutcome } from "./webAnalytics";

/** Consented Host web outcomes fan the identical safe payload to both sinks. */
export function captureHostSearchOutcome(
  event: SearchEventName,
  properties: SearchMeasurementProperties,
): void {
  captureWebSearchOutcome(event, properties);
}
