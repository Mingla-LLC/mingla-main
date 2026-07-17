/**
 * usePartnerBrandLinks — ORCH-1081 React Query hook for the partner's
 * partner_brand_links list. Read-only.
 *
 * ORCH-1384: gains an optional `{ includeCancelled }` opt (OQ-3 — the Brands
 * screen shows cancelled rows greyed + last; every existing caller compiles
 * unchanged and keeps the exclude-cancelled default), plus the owner-side
 * useBrandPartnerLinks(brandId) read (Team screen partner-row identification
 * via the new partner_brand_links_owner_select RLS policy).
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  listBrandPartnerLinks,
  listPartnerBrandLinks,
  partnerBrandLinksKeys,
  type PartnerBrandLinkWithStatus,
} from "../services/partnerBrandLinksService";
import { useAuth } from "../context/AuthContext";

const DISABLED_KEY = ["partner-brand-links-disabled"] as const;

export interface UsePartnerBrandLinksOptions {
  /** ORCH-1384 — include cancelled rows (default false, byte-compatible). */
  includeCancelled?: boolean;
}

export function usePartnerBrandLinks(
  opts?: UsePartnerBrandLinksOptions,
): UseQueryResult<PartnerBrandLinkWithStatus[], Error> {
  const includeCancelled = opts?.includeCancelled === true;
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady;
  return useQuery<PartnerBrandLinkWithStatus[], Error>({
    queryKey: enabled
      ? partnerBrandLinksKeys.list(includeCancelled)
      : DISABLED_KEY,
    queryFn: () => listPartnerBrandLinks({ includeCancelled }),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * ORCH-1384 — owner-side read of a brand's partner links. The Team screen
 * matches member rows' user_id against accepted, non-cancelled links'
 * partner_account_id to badge + gate the owner-initiated disconnect.
 */
export function useBrandPartnerLinks(
  brandId: string | null,
): UseQueryResult<PartnerBrandLinkWithStatus[], Error> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null;
  return useQuery<PartnerBrandLinkWithStatus[], Error>({
    queryKey: enabled
      ? partnerBrandLinksKeys.brand(brandId as string)
      : DISABLED_KEY,
    queryFn: () => listBrandPartnerLinks(brandId as string),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
