import { Platform } from "react-native";
import { postHogService } from "../../services/postHogService";
import { captureWeb } from "../../analytics/webAnalytics";
export type ContactImportAnalyticsEvent =
  | "contact_import_opened"
  | "file_selected"
  | "mapping_viewed"
  | "preview_succeeded"
  | "preview_failed"
  | "attestation_checked"
  | "execute_started"
  | "execute_completed"
  | "execute_failed"
  | "result_viewed";
export function captureContactImport(
  event: ContactImportAnalyticsEvent,
  properties: Record<string, string | number | boolean> = {},
): void {
  const safe = { ...properties, platform: Platform.OS };
  postHogService.capture(event, safe);
  captureWeb(event, safe);
}
