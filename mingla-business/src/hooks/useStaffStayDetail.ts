import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { PublicStayDetail } from "@mingla/brand-rendering/stayGuest";

import { fetchStaffStayDetail } from "../services/staffStayDetailService";

const DISABLED = ["stayStaff", "detail-disabled"] as const;

export function useStaffStayDetail(
  venueId: string | null,
): UseQueryResult<PublicStayDetail | null> {
  return useQuery({
    queryKey: venueId === null ? DISABLED : ["stayStaff", "detail", venueId],
    enabled: venueId !== null,
    staleTime: 45_000,
    queryFn: () =>
      venueId === null
        ? Promise.resolve(null)
        : fetchStaffStayDetail(venueId),
  });
}
