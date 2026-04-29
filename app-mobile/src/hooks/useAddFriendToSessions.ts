/**
 * useAddFriendToSessions — ORCH-0666.
 *
 * React Query mutation hook wrapping `addFriendsToSessions`. Refreshes the
 * session list manually on success because boardsSessions is React state,
 * not React Query (CF-3 — investigation observation; tech debt out of
 * ORCH-0666 scope).
 */
import { useMutation } from '@tanstack/react-query';
import {
  addFriendsToSessions,
  type AddFriendsToSessionsParams,
  type AddFriendsToSessionsReturn,
} from '../services/sessionMembershipService';

export interface UseAddFriendToSessionsOptions {
  /** Called on the manual refresh-trigger after success. Wire to whatever
   *  refreshes boardsSessions (typically the exported `refreshAllSessions`
   *  from app/index.tsx). */
  onMutationSettled?: () => void;
}

export function useAddFriendToSessions(opts?: UseAddFriendToSessionsOptions) {
  return useMutation<AddFriendsToSessionsReturn, Error, AddFriendsToSessionsParams>({
    mutationFn: addFriendsToSessions,
    onSettled: () => {
      opts?.onMutationSettled?.();
    },
  });
}
