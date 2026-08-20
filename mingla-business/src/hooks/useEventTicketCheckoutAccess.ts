import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import {
  addSelfToEventTicketCheckoutAccess,
  addUsernameToEventTicketCheckoutAccess,
  type EventTicketCheckoutAccess,
  getEventTicketCheckoutAccess,
  getPublicTicketCheckoutEligibility,
  newTicketCheckoutAccessRequestId,
  removeEventTicketCheckoutAccessMember,
  setEventTicketCheckoutAccessMode,
  type TicketCheckoutAccessMode,
  type TicketCheckoutAccessMutationResult,
  type TicketCheckoutEligibility,
} from "../services/eventTicketCheckoutAccessService";

export const eventTicketCheckoutAccessKeys = {
  all: ["eventTicketCheckoutAccess"] as const,
  event: (eventId: string) =>
    [...eventTicketCheckoutAccessKeys.all, eventId] as const,
  business: (eventId: string) =>
    [...eventTicketCheckoutAccessKeys.event(eventId), "business"] as const,
  eligibility: (eventId: string) =>
    [...eventTicketCheckoutAccessKeys.event(eventId), "eligibility"] as const,
  eligibilityFor: (eventId: string, authScope: string) =>
    [...eventTicketCheckoutAccessKeys.eligibility(eventId), authScope] as const,
};

export const useBusinessEventTicketCheckoutAccess = (
  eventId: string,
): UseQueryResult<EventTicketCheckoutAccess> => {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: eventTicketCheckoutAccessKeys.business(eventId),
    queryFn: () => getEventTicketCheckoutAccess(eventId),
    enabled: isAuthReady && eventId.length > 0,
    staleTime: 0,
    refetchOnMount: "always",
  });
};

export const usePublicTicketCheckoutEligibility = (
  eventId: string,
): UseQueryResult<TicketCheckoutEligibility | null> => {
  const { loading, user } = useAuth();
  const queryClient = useQueryClient();
  const authScope = user?.id ?? "anon";

  useEffect(() => {
    void queryClient.cancelQueries({
      queryKey: eventTicketCheckoutAccessKeys.eligibility(eventId),
    });
    queryClient.removeQueries({
      queryKey: eventTicketCheckoutAccessKeys.eligibility(eventId),
      type: "inactive",
    });
  }, [authScope, eventId, queryClient]);

  return useQuery({
    queryKey: eventTicketCheckoutAccessKeys.eligibilityFor(eventId, authScope),
    queryFn: () => getPublicTicketCheckoutEligibility(eventId),
    enabled: !loading && eventId.length > 0,
    staleTime: 0,
    refetchOnMount: "always",
  });
};

type AccessMutationInput =
  | { kind: "add_self" }
  | { kind: "add_username"; username: string }
  | { kind: "remove"; membershipId: string }
  | { kind: "set_mode"; mode: TicketCheckoutAccessMode };

export const useMutateEventTicketCheckoutAccess = (
  eventId: string,
  configRevision: number,
): UseMutationResult<TicketCheckoutAccessMutationResult, Error, AccessMutationInput> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => {
      const requestId = newTicketCheckoutAccessRequestId();
      switch (input.kind) {
        case "add_self":
          return addSelfToEventTicketCheckoutAccess(eventId, configRevision, requestId);
        case "add_username":
          return addUsernameToEventTicketCheckoutAccess(
            eventId,
            input.username,
            configRevision,
            requestId,
          );
        case "remove":
          return removeEventTicketCheckoutAccessMember(
            eventId,
            input.membershipId,
            configRevision,
            requestId,
          );
        case "set_mode":
          return setEventTicketCheckoutAccessMode(
            eventId,
            input.mode,
            configRevision,
            requestId,
          );
        default: {
          const exhaustive: never = input;
          throw new Error(`unsupported_access_mutation:${String(exhaustive)}`);
        }
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: eventTicketCheckoutAccessKeys.business(eventId),
        }),
        queryClient.invalidateQueries({
          queryKey: eventTicketCheckoutAccessKeys.eligibility(eventId),
        }),
      ]);
    },
  });
};
