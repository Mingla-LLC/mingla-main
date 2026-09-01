import { supabase } from "./supabase";

export interface AttendanceClaimLinkResult {
  ok: true;
  kind: "order";
  eventId: string;
  sourceId: string;
  webClaimUrl: string;
  appClaimUrl: string;
}

export class AttendanceClaimLinkError extends Error {
  constructor(
    readonly code:
      | "invalid"
      | "ineligible"
      | "rate_limited"
      | "configuration"
      | "network",
  ) {
    super(code);
  }
}

export const createAttendanceClaimLink = async (
  checkoutSessionId: string,
  buyerStatusToken: string,
): Promise<AttendanceClaimLinkResult> => {
  const { data, error } = await supabase.functions.invoke("attendance-claim-link", {
    body: {
      checkoutSessionId,
      buyerStatusToken,
    },
  });
  if (error) {
    const response = (error as { context?: Response }).context;
    const payload = response
      ? await response.clone().json().catch(() => null) as { error?: string } | null
      : null;
    if (payload?.error === "claim_link_ineligible") throw new AttendanceClaimLinkError("ineligible");
    if (payload?.error === "claim_link_rate_limited") throw new AttendanceClaimLinkError("rate_limited");
    if (payload?.error === "claim_link_invalid") throw new AttendanceClaimLinkError("invalid");
    if (payload?.error === "claim_link_temporarily_unavailable") {
      throw new AttendanceClaimLinkError("configuration");
    }
    throw new AttendanceClaimLinkError("network");
  }
  return data as AttendanceClaimLinkResult;
};
