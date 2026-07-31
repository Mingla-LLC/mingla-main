import { constantTimeEqual } from "../_shared/sourceRefundAttentionToken.ts";

export function isRsvpNotifyServiceRequest(
  authorization: string | null,
  serviceRoleKey: string,
): boolean {
  return serviceRoleKey.length > 0 && constantTimeEqual(
    authorization ?? "",
    `Bearer ${serviceRoleKey}`,
  );
}
