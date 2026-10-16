/**
 * Startup-safe notification preference defaults.
 *
 * `businessNotificationTemplates.ts` carries the full push/in-app copy matrix.
 * Loading that matrix from notification settings made Metro hoist every copy
 * string into the eager shared chunk because the inbox also consumes it from a
 * separate lazy route. Keep the hot-path default rule here and pin it to the
 * full catalog with the #3493 parity test.
 */

import type { BusinessNotificationType } from "./businessNotificationTemplates";

export type BusinessNotificationPreferenceChannel = "push" | "in_app";

export function businessNotificationDefaultOptIn(
  type: BusinessNotificationType,
  channel: BusinessNotificationPreferenceChannel,
): boolean {
  return channel !== "push" || type !== "business.team_member_joined";
}
