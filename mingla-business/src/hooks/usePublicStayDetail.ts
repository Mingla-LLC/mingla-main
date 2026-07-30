import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { PublicStayDetail } from "@mingla/brand-rendering/stayGuest";
import { stayGuestKeys } from "@mingla/brand-rendering/stayGuestKeys";

import { fetchPublicStayDetail } from "../services/publicStayDetailService";

const DISABLED = ["stayGuest", "public-disabled"] as const;

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
