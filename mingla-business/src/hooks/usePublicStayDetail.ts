import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  stayGuestKeys,
  type PublicStayDetail,
} from "@mingla/brand-rendering/stayGuest";

import { fetchPublicStayDetail } from "../services/stayGuestService";

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
