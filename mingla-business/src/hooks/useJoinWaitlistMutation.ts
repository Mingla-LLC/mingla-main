import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import {
  joinWaitlist,
  type JoinWaitlistInput,
  type JoinWaitlistResult,
} from "../services/waitlistService";
import { eventWaitlistKeys } from "./useEventWaitlist";

export const useJoinWaitlistMutation = (): UseMutationResult<
  JoinWaitlistResult,
  Error,
  JoinWaitlistInput
> => {
  const queryClient = useQueryClient();
  return useMutation<JoinWaitlistResult, Error, JoinWaitlistInput>({
    mutationFn: joinWaitlist,
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({
        queryKey: eventWaitlistKeys.detail(input.eventId),
      });
    },
  });
};
