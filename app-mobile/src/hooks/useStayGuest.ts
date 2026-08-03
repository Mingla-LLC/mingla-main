import {
  stayGuestKeys,
  type MyStayReservationGroup,
  type PublicStayDetail,
  type StayReservationGroup,
} from "@mingla/brand-rendering/stayGuest";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  fetchMyStayReservations,
  fetchPublicStayDetail,
  stayGuestService,
} from "../services/stayGuestService";

const DISABLED = ["stayGuest", "disabled"] as const;

export function usePublicStayDetail(
  venueId: string | null,
  isStay: boolean,
): UseQueryResult<PublicStayDetail | null> {
  const enabled = isStay && venueId !== null;
  return useQuery({
    queryKey: enabled && venueId !== null
      ? stayGuestKeys.detail(venueId)
      : DISABLED,
    enabled,
    staleTime: 45_000,
    queryFn: () =>
      enabled && venueId !== null
        ? fetchPublicStayDetail(venueId)
        : Promise.resolve(null),
  });
}

export function useStayReservationGroup(
  groupId: string | null,
): UseQueryResult<StayReservationGroup> {
  return useQuery({
    queryKey: groupId !== null ? stayGuestKeys.group(groupId) : DISABLED,
    enabled: groupId !== null,
    queryFn: () => {
      if (groupId === null) throw new Error("stay_group_id_required");
      return stayGuestService.getGroup(groupId);
    },
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "finalizing" ||
          state === "instant_payment_pending" ||
          state === "approved_payment_required"
        ? 3_000
        : false;
    },
  });
}

export function useMyStayReservations(
  userId: string | null,
): UseQueryResult<MyStayReservationGroup[]> {
  return useQuery({
    queryKey: userId !== null ? stayGuestKeys.mine(userId) : DISABLED,
    enabled: userId !== null,
    queryFn: fetchMyStayReservations,
    staleTime: 30_000,
  });
}
