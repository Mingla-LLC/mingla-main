/**
 * useScheduleCampaign — mutation: flip draft to scheduled.
 * Constitution #3 — onError surfaces the failure via the caller.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { scheduleSend } from "../../services/marketing/marketingCampaignService";
import { marketingKeys } from "./marketingKeys";
import type { CampaignChannelPayload, MarketingCampaignRow } from "../../types/marketing";

export interface ScheduleCampaignVars {
  campaign_id: string;
  scheduled_for: string;
  name: string;
  channel_payload: CampaignChannelPayload;
}

export function useScheduleCampaign(options: {
  onSuccess?: (row: MarketingCampaignRow) => void;
  onError?: (err: unknown) => void;
}) {
  const queryClient = useQueryClient();
  return useMutation<MarketingCampaignRow, unknown, ScheduleCampaignVars>({
    mutationFn: async (vars) => scheduleSend(vars),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: marketingKeys.campaigns.all });
      if (options.onSuccess !== undefined) options.onSuccess(row);
    },
    onError: (err) => {
      if (options.onError !== undefined) options.onError(err);
    },
  });
}
