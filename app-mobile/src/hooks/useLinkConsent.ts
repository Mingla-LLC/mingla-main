import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getPendingLinkConsents,
  respondToLinkConsent,
} from "../services/linkConsentService";
import { savedPeopleKeys } from "./useSavedPeople";
import { friendLinkKeys } from "./useFriendLinks";

export const linkConsentKeys = {
  all: ["link-consent"] as const,
  pending: (userId: string) =>
    [...linkConsentKeys.all, "pending", userId] as const,
};

export function usePendingLinkConsents(userId: string | undefined) {
  return useQuery({
    queryKey: linkConsentKeys.pending(userId ?? ""),
    queryFn: () => getPendingLinkConsents(userId!),
    enabled: !!userId,
    staleTime: 30 * 1000, // 30 seconds — consents are time-sensitive
    retry: false, // Column may not exist if migration hasn't run — don't spam retries
    meta: { persist: false }, // Don't persist to AsyncStorage — pending queries crash hydration
  });
}

export function useRespondLinkConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      linkId,
      action,
    }: {
      linkId: string;
      action: "accept" | "decline";
    }) => respondToLinkConsent(linkId, action),
    onSuccess: () => {
      // Invalidate pending consents (one fewer pending)
      queryClient.invalidateQueries({ queryKey: linkConsentKeys.all });
      // Invalidate saved people (new linked person may have been created)
      queryClient.invalidateQueries({ queryKey: savedPeopleKeys.all });
      // Invalidate friend links (link_status changed)
      queryClient.invalidateQueries({ queryKey: friendLinkKeys.all });
    },
    onError: (error: Error) => {
      console.error('[RespondLinkConsent] Error:', error.message);
    },
  });
}
