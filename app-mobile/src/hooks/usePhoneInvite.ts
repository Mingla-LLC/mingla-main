import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as phoneInviteService from "../services/phoneInviteService";
import { friendLinkKeys } from "./useFriendLinks";
import { useAppStore } from "../store/appStore";

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
    onError: (error: Error) => {
      console.error('[SendPhoneInvite] Error:', error.message);
    },
  });
}

export function usePendingPhoneInvites() {
  const user = useAppStore((state) => state.user);
  return useQuery({
    queryKey: [...friendLinkKeys.all, "phone-invites", user?.id ?? ""],
    queryFn: () => phoneInviteService.getPendingPhoneInvites(user!.id),
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  });
}
