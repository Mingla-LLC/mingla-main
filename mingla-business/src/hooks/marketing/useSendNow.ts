/**
 * useSendNow — direct invocation of marketing-send edge function.
 * Composer writes status='scheduled' + scheduled_for=now() first, then
 * calls this for instant dispatch (skips the 60s cron wait).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { sendNow } from "../../services/marketing/marketingCampaignService";
import { marketingKeys } from "./marketingKeys";

export function useSendNow(options: {
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
}) {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: async (campaignId) => sendNow(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketingKeys.campaigns.all });
      if (options.onSuccess !== undefined) options.onSuccess();
    },
    onError: (err) => {
      if (options.onError !== undefined) options.onError(err);
    },
  });
}
