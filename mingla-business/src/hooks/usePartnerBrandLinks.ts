/**
 * usePartnerBrandLinks — ORCH-1081 React Query hook for the partner's
 * partner_brand_links list. Read-only.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  listPartnerBrandLinks,
  partnerBrandLinksKeys,
  type PartnerBrandLinkWithStatus,
} from "../services/partnerBrandLinksService";

export function usePartnerBrandLinks(): UseQueryResult<
  PartnerBrandLinkWithStatus[],
  Error
> {
  return useQuery<PartnerBrandLinkWithStatus[], Error>({
    queryKey: partnerBrandLinksKeys.list(),
    queryFn: listPartnerBrandLinks,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
