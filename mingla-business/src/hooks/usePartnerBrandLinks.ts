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
import { useAuth } from "../context/AuthContext";

const DISABLED_KEY = ["partner-brand-links-disabled"] as const;

export function usePartnerBrandLinks(): UseQueryResult<
  PartnerBrandLinkWithStatus[],
  Error
> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady;
  return useQuery<PartnerBrandLinkWithStatus[], Error>({
    queryKey: enabled ? partnerBrandLinksKeys.list() : DISABLED_KEY,
    queryFn: listPartnerBrandLinks,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
