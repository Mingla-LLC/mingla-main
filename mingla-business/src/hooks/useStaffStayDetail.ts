import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { PublicStayDetail } from "@mingla/brand-rendering/stayGuest";

import { useAuth } from "../context/AuthContext";
import { fetchStaffStayDetail } from "../services/staffStayDetailService";

const DISABLED = ["stayStaff", "detail-disabled"] as const;

export function useStaffStayDetail(
  venueId: string | null,
): UseQueryResult<PublicStayDetail | null> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && venueId !== null;

  return useQuery({
    queryKey: enabled && venueId !== null
      ? ["stayStaff", "detail", venueId]
      : DISABLED,
    enabled,
    staleTime: 45_000,
    queryFn: () =>
      venueId === null
        ? Promise.resolve(null)
        : fetchStaffStayDetail(venueId),
  });
}
