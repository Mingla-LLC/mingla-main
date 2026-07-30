import type {
  MyStayReservationGroup,
  StayReservationGroup,
} from "@mingla/brand-rendering/stayGuest";
import { stayGuestKeys } from "@mingla/brand-rendering/stayGuestKeys";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { fetchMyStayReservations } from "../services/myStayReservationsService";
import { stayGuestService } from "../services/stayGuestService";

const DISABLED = ["stayGuest", "disabled"] as const;

export function useStayReservationGroup(
  groupId: string | null,
): UseQueryResult<StayReservationGroup> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && groupId !== null;
  return useQuery({
    queryKey: enabled && groupId !== null
      ? stayGuestKeys.group(groupId)
      : DISABLED,
    enabled,
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
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && userId !== null;
  return useQuery({
    queryKey: enabled && userId !== null
      ? stayGuestKeys.mine(userId)
      : DISABLED,
    enabled,
    queryFn: fetchMyStayReservations,
    staleTime: 30_000,
  });
}
