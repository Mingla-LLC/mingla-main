/**
 * useCampaignFailureReason — why one failed method did not go out (#4596).
 *
 * The campaign group view carries no failure_reason, and the email/SMS report
 * is not loaded for push, so a failed push method had no reason on screen.
 * This reads the one column for a failed method of any channel. RLS on
 * marketing_campaigns admits the owner and the brand team, as for the list.
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../services/supabase";
import { marketingKeys } from "./marketingKeys";

const STALE_TIME_MS = 30 * 1000;

export async function getCampaignFailureReason(campaignId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .select("failure_reason")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  const reason = (data as { failure_reason?: unknown } | null)?.failure_reason;
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

export function useCampaignFailureReason(campaignId: string | null): string | null {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && campaignId !== null;
  const query = useQuery<string | null>({
    queryKey: enabled
      ? marketingKeys.campaigns.failureReason(campaignId as string)
      : marketingKeys.campaigns.all,
    queryFn: () => getCampaignFailureReason(campaignId as string),
    enabled,
    staleTime: STALE_TIME_MS,
  });
  // A failed read keeps the screen's "Failed {date}" line (the reason is extra).
  return query.data ?? null;
}
