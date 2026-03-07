import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as phoneInviteService from "../services/phoneInviteService";
import { friendLinkKeys } from "./useFriendLinks";
import { useAuthSimple } from "./useAuthSimple";

export function useSendPhoneInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (phone_e164: string) =>
      phoneInviteService.sendPhoneInvite(phone_e164),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: friendLinkKeys.all,
      });
    },
  });
}

export function usePendingPhoneInvites() {
  const { user } = useAuthSimple();
  return useQuery({
    queryKey: [...friendLinkKeys.all, "phone-invites", user?.id ?? ""],
    queryFn: () => phoneInviteService.getPendingPhoneInvites(user!.id),
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  });
}
