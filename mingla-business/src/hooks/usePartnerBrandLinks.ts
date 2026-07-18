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

// useBrandPartnerLinks (owner-side, Team-only) moved to ./useBrandPartnerLinks
// (ORCH-1384 bundle-budget split — keeps the Team-only read out of this shared,
// eager hook module and thus out of the web boot __common chunk).
