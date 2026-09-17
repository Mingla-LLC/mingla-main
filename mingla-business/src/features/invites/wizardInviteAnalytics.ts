import { Platform } from "react-native";

import { captureWeb } from "../../analytics/webAnalytics";
import { postHogService } from "../../services/postHogService";
import type { WizardOfferingType } from "../../services/offeringInvitePlanService";

export type WizardInviteClientEvent =
  | "wizard_invite_step_viewed"
  | "wizard_invite_plan_saved"
  | "wizard_invite_plan_save_failed"
  | "wizard_invite_plan_stale"
  | "wizard_invite_quote_loaded"
  | "wizard_invite_quote_failed"
  | "wizard_invite_publish_confirmed";

export interface WizardInviteAnalyticsProperties {
  offering_kind: WizardOfferingType;
  selection_revision?: number;
  selected_count?: number;
  can_receive?: number;
  skipped?: number;
  email_count?: number;
  text_count?: number;
  mingla_count?: number;
  text_segments?: number;
  amount_minor?: number;
  error_code?: string;
}

/** Aggregate-only analytics. Never accept offering/person/group IDs or search text. */
export function captureWizardInvite(
  event: WizardInviteClientEvent,
  properties: WizardInviteAnalyticsProperties,
): void {
  const safe = { platform: Platform.OS, ...properties };
  postHogService.capture(event, safe);
  if (Platform.OS === "web") captureWeb(event, safe);
}
